"""
Entry points for agents with no scheduled/pipeline caller — each triggered
on demand by a specific human action rather than automatically: LinkedIn copy
generation (from a lead's detail page — LinkedIn outreach itself stays
human-driven, ToS/ban risk), the cross-lead optimisation pipeline (analytics +
learning, from the Analytics dashboard, since it costs a Claude CLI call and
its output is a recommendation a human reviews, not something that needs to
be fresh every minute), and case-study review (from Settings, the moment an
operator submits one).
"""
import logging

from shared import api_client
from agents import AgentContext, build

logger = logging.getLogger("outreach_runner")


async def run_linkedin_draft(lead_id: str, org_id: str | None = None) -> None:
    lead_detail = await api_client.get_lead_detail(lead_id, org_id)
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail
    org_id = org_id or lead.get("orgId")

    execution_id = await api_client.start_execution(org_id, lead_id, "linkedin_draft") if org_id else None
    if org_id and execution_id is None:
        return

    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}

    async def announce_start(agent) -> None:
        if not org_id:
            return
        await api_client.record_agent_started(org_id, lead_id, agent.name, agent.responsibility)

    async def stream(record) -> None:
        # Both steps ("review" then "linkedin") can each spend a Claude CLI
        # call, so stream them live rather than dumping both only once the
        # pipeline finishes.
        if not org_id:
            return
        await api_client.record_agent_runs(
            org_id,
            None,
            [
                {
                    "agent": record.agent, "status": record.status, "durationMs": record.duration_ms,
                    "attempts": record.attempts, "error": record.error, "notes": record.notes,
                    "leadId": lead_id,
                }
            ],
        )

    orchestrator = build("linkedin_draft", seed_keys=("lead",))
    ctx = AgentContext(
        run_id=lead_id, org_id=org_id or "", data={"lead": lead_detail, "org_context": org_context},
    )
    result = await orchestrator.run(ctx, on_step=stream, on_start=announce_start)

    messages = ctx.get("linkedin_messages")
    if messages:
        await api_client.submit_linkedin_draft(lead_id, messages)
        logger.info("LinkedIn draft submitted for lead %s", lead_id)
        if org_id and execution_id:
            await api_client.report_execution_success(org_id, lead_id, "linkedin_draft", execution_id)
    else:
        reason = f"stopped at {result.stopped_at} ({result.stop_reason})"
        logger.error("LinkedIn drafting pipeline produced nothing for lead %s: %s", lead_id, reason)
        if org_id and execution_id:
            # FATAL means the precondition for success is absent (e.g. no
            # contact name to personalize against) — retrying won't help;
            # anything else (a Claude CLI rate limit/timeout) is transient.
            retryable = not (result.records and result.records[-1].status == "FATAL")
            await api_client.report_execution_failed(
                org_id, lead_id, "linkedin_draft", execution_id, reason, retryable=retryable,
            )


async def run_optimisation(
    org_id: str, performance: list, outcomes: dict, email_samples: dict | None = None,
) -> dict:
    """Synchronous by design (unlike the two background-task entry points
    above): the caller is a dashboard button waiting to render the result, not
    a fire-and-forget sequencer hop.

    `email_samples` is optional (not in seed_keys) — LearningAgent treats it
    as optional context (see MIN_EMAIL_SAMPLE there), so an org with too
    little email history still gets ordinary recommendations, just no
    emailImprovements.
    """
    orchestrator = build("optimisation", seed_keys=("performance", "outcomes"))
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={
            "performance": performance,
            "outcomes": outcomes,
            "email_samples": email_samples or {},
            "org_context": org_context,
        },
    )
    result = await orchestrator.run(ctx)

    await api_client.record_agent_runs(
        org_id,
        None,
        [
            {
                "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                "attempts": r.attempts, "error": r.error, "notes": r.notes,
            }
            for r in result.records
        ],
    )

    return {
        "insights": ctx.get("insights") or {},
        "recommendations": ctx.get("recommendations") or {},
        "emailImprovements": ctx.get("email_improvements") or [],
        "completed": result.completed,
        "stoppedAt": result.stopped_at,
        "stopReason": result.stop_reason,
        "notes": [n for r in result.records for n in r.notes],
    }


async def run_case_study_review(
    org_id: str, title: str | None, raw_story: str, submitted_industry: str,
) -> dict:
    """Synchronous, same reasoning as run_optimisation above: the caller is
    someone sitting on the Settings page waiting to see their case study
    listed, not a background job."""
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}
    orchestrator = build("case_study_review", seed_keys=("case_study_input", "org_context"))
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={
            "case_study_input": {
                "title": title, "rawStory": raw_story, "submittedIndustry": submitted_industry,
            },
            "org_context": org_context,
        },
    )
    result = await orchestrator.run(ctx)

    await api_client.record_agent_runs(
        org_id,
        None,
        [
            {
                "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                "attempts": r.attempts, "error": r.error, "notes": r.notes,
            }
            for r in result.records
        ],
    )

    review = ctx.get("case_study_result") or {}
    return {
        "usable": bool(review.get("usable", bool(review))),
        "title": review.get("title") or title or "",
        "summary": review.get("summary") or "",
        "metrics": review.get("metrics") or {},
        "industry": review.get("industry") or submitted_industry,
        "reviewNotes": review.get("reviewNotes") or "",
        "completed": result.completed,
        "stopReason": result.stop_reason,
    }


async def run_email_lead_classification(
    org_id: str, from_name: str | None, from_email: str, subject: str, body_text: str,
) -> dict:
    """Synchronous, same reasoning as run_case_study_review above: the caller
    is EmailHubSyncWorker waiting on a single Claude CLI call before it can
    write suggestedCategory onto the message it just persisted — a fire-and-
    forget dispatch from the caller's side, not a background job on this
    side."""
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}
    orchestrator = build("email_lead_classifier", seed_keys=("email_input", "org_context"))
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={
            "email_input": {
                "fromName": from_name, "fromEmail": from_email,
                "subject": subject, "bodyText": body_text,
            },
            "org_context": org_context,
        },
    )
    result = await orchestrator.run(ctx)

    await api_client.record_agent_runs(
        org_id,
        None,
        [
            {
                "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                "attempts": r.attempts, "error": r.error, "notes": r.notes,
            }
            for r in result.records
        ],
    )

    classification = ctx.get("email_lead_result") or {}
    return {
        "isCandidate": bool(classification.get("isCandidate", False)),
        "reason": classification.get("reason") or "",
        "completed": result.completed,
        "stopReason": result.stop_reason,
    }


async def run_social_content(org_id: str, content_input: dict) -> dict:
    """Synchronous, same reasoning as run_case_study_review: the caller is
    either the composer (an operator waiting to see a draft appear) or an
    automation's CREATE_DRAFT action, which itself blocks on this before
    creating the SocialPost row."""
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}
    orchestrator = build("social_content", seed_keys=("social_content_input", "org_context"))
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={"social_content_input": content_input, "org_context": org_context},
    )
    result = await orchestrator.run(ctx)

    await api_client.record_agent_runs(
        org_id,
        None,
        [
            {
                "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                "attempts": r.attempts, "error": r.error, "notes": r.notes,
            }
            for r in result.records
        ],
    )

    generated = ctx.get("social_content_result") or {}
    return {
        "content": generated.get("content") or "",
        "hashtags": generated.get("hashtags") or [],
        "completed": result.completed,
        "stopReason": result.stop_reason,
    }
