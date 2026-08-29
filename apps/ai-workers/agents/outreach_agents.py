"""
Outreach agents: review merge, email drafting, LinkedIn messaging, scheduling.

These operate on a lead that already exists, so they take `lead` (the full lead
record from the API) rather than `candidate` (a discovery result). Keeping the
two names distinct is deliberate — an agent written against the wrong one fails
the orchestrator's contract check at construction instead of producing subtly
wrong output at runtime.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from claude_agent import cli_client
from gemini_agent.context_builder import build_context, fetch_website_excerpt
from gemini_agent.drafting import append_signature, draft_and_validate
from shared.prompts import load_prompt

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.outreach")

#: Sequence waits, in business days, per the 5-email sequence (Part:
#: 5-email sequence, 2026-08-12) — 3-4 business days between every step.
#: The actual wait is computed by SequencerService (apps/api), which is the
#: real scheduling authority; this dict is what SchedulerAgent reports for
#: the dashboard's timeline display, kept in sync with it by convention.
STAGE_WAIT_DAYS: dict[str, int] = {
    "EMAIL_1_SENT": 3,
    "EMAIL_2_SENT": 3,
    "EMAIL_3_SENT": 3,
    "EMAIL_4_SENT": 3,
    "WAITING_EMAIL_2": 0,
    "WAITING_EMAIL_3": 0,
    "WAITING_EMAIL_4": 0,
    "WAITING_EMAIL_5": 0,
}


class ReviewAgent(Agent):
    """Merges the human reviewer's notes with what the AI found.

    The reviewer is the authority. Where a human contradicts an AI finding the
    human wins outright — they have context the model cannot see (a phone call,
    a prior relationship), and quietly averaging the two would produce an email
    that matches neither and undermine the reason a review step exists.
    """

    name = "review"
    responsibility = "Merges human review notes with AI findings into one outreach context."
    requires = ("lead",)
    provides = ("review_merged",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        lead = ctx.get("lead")
        note = lead.get("reviewNote") or {}

        # Reviewer value first, AI value only as fallback.
        def prefer(human_key: str, ai_key: str) -> str | None:
            return note.get(human_key) or lead.get(ai_key)

        merged = {
            "painPoints": prefer("painPoints", "painPoints"),
            "businessProblems": note.get("businessProblems"),
            "opportunities": prefer("opportunities", "aiOpportunities"),
            "automationOpportunities": prefer("automationOpportunities", "automationOpportunities"),
            "crmIssues": note.get("crmIssues"),
            "salesIssues": note.get("salesIssues"),
            "marketingIssues": note.get("marketingIssues"),
            "operationalIssues": note.get("operationalIssues"),
            "websiteIssues": note.get("websiteIssues") or lead.get("uxIssues"),
            "suggestedService": note.get("suggestedService"),
            "suggestedOffer": note.get("suggestedOffer"),
            "suggestedCaseStudy": note.get("suggestedCaseStudy"),
            "suggestedHook": note.get("suggestedHook"),
            "urgencyLevel": note.get("urgencyLevel"),
            "notes": note.get("notes"),
            # Recorded so the email agent can say whether a human has actually
            # looked at this lead, rather than inferring it from field presence.
            "humanReviewed": bool(note),
        }
        merged = {k: v for k, v in merged.items() if v not in (None, "")}

        if not note:
            # Not a failure: outreach can proceed on AI findings alone. Flagged
            # so it is visible in the dashboard which leads went out unreviewed.
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"review_merged": merged},
                notes=["no human review yet — proceeding on AI findings only"],
            )

        return AgentResult(status=AgentStatus.OK, data={"review_merged": merged})


class EmailAgent(Agent):
    """Drafts one email of the 5-email sequence for the lead's current step."""

    name = "email"
    responsibility = "Generates one email of the 5-email sequence (Problem Trigger through Breakup)."
    requires = ("lead", "review_merged", "sequence_step")
    provides = ("email_draft",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        lead = ctx.get("lead")
        merged = ctx.get("review_merged") or {}
        org_context = ctx.get("org_context") or {}
        step = ctx.get("sequence_step")

        excerpt = await fetch_website_excerpt(lead.get("website"))
        context = build_context(lead, excerpt, ctx.get("case_study"))

        # build_context already derives `reviewer_notes` straight from the raw
        # reviewNote, bypassing ReviewAgent entirely. Overlaying the merged
        # output here (which prefers the human's value, falling back to the
        # AI's) onto the SAME sub-dict the drafting prompt actually reads is
        # what gives ReviewAgent's merge real effect — without this, running
        # it changes nothing downstream regardless of what it produces.
        notes_map = {
            "pain_points": "painPoints",
            "business_problems": "businessProblems",
            "website_issues": "websiteIssues",
            "suggested_offer": "suggestedOffer",
            "suggested_hook": "suggestedHook",
            "urgency_level": "urgencyLevel",
        }
        reviewer_notes = context.setdefault("reviewer_notes", {})
        for prompt_key, merged_key in notes_map.items():
            if merged.get(merged_key):
                reviewer_notes[prompt_key] = merged[merged_key]

        draft, notes, needs_review = await draft_and_validate(context, org_context, step)
        if not draft:
            return AgentResult(status=AgentStatus.FAILED, error="drafting produced no output", notes=notes)

        draft["body_html"] = append_signature(draft["body_html"])
        draft["needsReview"] = needs_review
        if needs_review:
            # Surfaced on the /sequences approval card, not just in agent-run
            # telemetry — the person approving it needs to see *why* without
            # having to go dig through a separate history view.
            draft.setdefault("rationale", {})["reviewNotes"] = notes

        return AgentResult(
            status=AgentStatus.DEGRADED if notes else AgentStatus.OK,
            data={"email_draft": draft},
            notes=notes,
        )


class LinkedInAgent(Agent):
    """Writes LinkedIn connection and follow-up copy for a human to send.

    It produces TEXT ONLY and never touches LinkedIn. Automating connections or
    messages violates LinkedIn's terms and risks the account being restricted,
    which would cost far more than the time it saves. The human sends; the agent
    only removes the blank page.
    """

    name = "linkedin"
    responsibility = "Drafts LinkedIn connection requests and follow-ups for a human to send."
    requires = ("lead", "review_merged")
    provides = ("linkedin_messages",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        lead = ctx.get("lead")
        merged = ctx.get("review_merged") or {}

        if not lead.get("contactName"):
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"linkedin_messages": {}},
                notes=["no named contact — nothing to personalise a request around"],
            )

        prompt = (
            f"{load_prompt('linkedin', ctx.get('org_context'))}\n\n"
            f"Contact: {lead.get('contactName')} ({lead.get('jobTitle') or 'unknown role'})\n"
            f"Company: {lead.get('companyName')} — {lead.get('industry') or 'unknown industry'}\n"
            f"What we know: {json.dumps(merged)[:1500]}"
        )

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"linkedin_messages": {}},
                error=str(err),
                notes=["LinkedIn copy not generated"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"linkedin_messages": {}},
                notes=["unparseable output"],
            )

        # Enforced here rather than trusted: LinkedIn rejects an over-length note
        # outright, and a truncation the user discovers at send time is worse
        # than one applied now.
        note = (data.get("connectionNote") or "")[:300]
        data["connectionNote"] = note
        notes = ["connection note truncated to LinkedIn's 300-char limit"] if len(
            data.get("connectionNote") or ""
        ) < len(envelope.get("result", "")) and len(note) == 300 else []

        return AgentResult(status=AgentStatus.OK, data={"linkedin_messages": data}, notes=notes)


class SchedulerAgent(Agent):
    """Computes when the next sequence action is due.

    Timing only — it never sends. The API's BullMQ sequencer owns delivery and
    cancellation, because a delayed job must survive this worker restarting, and
    an in-process timer would not.
    """

    name = "scheduler"
    responsibility = "Determines follow-up timing and the next action due date."
    requires = ("lead",)
    provides = ("schedule",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        lead = ctx.get("lead")
        stage = (lead.get("pipelineState") or {}).get("stage") or "READY_FOR_OUTREACH"

        # A reply ends the sequence. Continuing to follow up after someone has
        # answered is the fastest way to lose a warm lead.
        if stage in ("REPLIED", "MEETING_BOOKED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"):
            return AgentResult(
                status=AgentStatus.OK,
                data={"schedule": {"nextActionAt": None, "reason": f"sequence complete at {stage}"}},
            )

        wait_days = STAGE_WAIT_DAYS.get(stage)
        if wait_days is None:
            return AgentResult(
                status=AgentStatus.OK,
                data={"schedule": {"nextActionAt": None, "reason": f"no wait defined for {stage}"}},
            )

        due = datetime.now(timezone.utc) + timedelta(days=wait_days)
        # Weekend sends get buried under Monday's inbox, so push to Monday.
        while due.weekday() >= 5:
            due += timedelta(days=1)

        return AgentResult(
            status=AgentStatus.OK,
            data={
                "schedule": {
                    "nextActionAt": due.isoformat(),
                    "waitDays": wait_days,
                    "reason": f"{wait_days}d wait after {stage}, skipping weekends",
                }
            },
        )
