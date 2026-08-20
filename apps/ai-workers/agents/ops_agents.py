"""
Operational agents: analytics interpretation and the learning loop.

These are the only agents that look across many leads rather than at one. They
turn outcome data into recommendations a human decides whether to act on — the
system proposes, it never silently rewrites its own targeting, because a
feedback loop that edits its own inputs unattended can drift a long way before
anyone notices.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.ops")

#: Below this many completed outcomes, differences between segments are noise.
#: Recommending an ICP change off three leads would be actively harmful.
MIN_SAMPLE = 20


class AnalyticsAgent(Agent):
    """Interprets campaign performance and says what is actually working."""

    name = "analytics"
    responsibility = "Interprets campaign performance and flags what is and isn't working."
    requires = ("performance",)
    provides = ("insights",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        performance = ctx.get("performance") or []
        total_leads = sum(c.get("leads", 0) for c in performance)

        if total_leads < MIN_SAMPLE:
            return AgentResult(
                status=AgentStatus.SKIPPED,
                data={"insights": {}},
                notes=[
                    f"only {total_leads} leads across all campaigns; "
                    f"below the {MIN_SAMPLE} needed for a difference to mean anything"
                ],
            )

        prompt = f"""Interpret this outbound campaign performance data.

{json.dumps(performance, default=str)[:6000]}

Say what is working and what is not, and be honest about sample size: a campaign
with 4 leads and a 50% reply rate has told you nothing. Where the data does not
support a conclusion, say so rather than manufacturing one.

Rank by meeting rate, not lead volume — the campaign with the most leads is
usually just the oldest.

Respond with ONLY JSON, no prose or code fences:
{{
  "summary": string,
  "bestCampaigns": [{{"name": string, "why": string}}],
  "underperforming": [{{"name": string, "why": string, "suggestedFix": string}}],
  "bestNiches": string[],
  "bestCountries": string[],
  "bestOffers": string[],
  "warnings": string[],
  "confidence": "LOW"|"MEDIUM"|"HIGH"
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(status=AgentStatus.DEGRADED, data={"insights": {}}, error=str(err))

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED, data={"insights": {}}, notes=["unparseable output"]
            )
        return AgentResult(status=AgentStatus.OK, data={"insights": data})


class LearningAgent(Agent):
    """Recommends changes to targeting and messaging based on real outcomes.

    Recommendations only — nothing is applied automatically. A loop that edits
    its own ICP and messaging unattended compounds its own mistakes: one bad
    inference narrows the targeting, which produces worse data, which justifies
    narrowing further. A human approving each change breaks that cycle.
    """

    name = "learning"
    responsibility = "Learns which niches, offers and messages perform, and proposes improvements."
    requires = ("performance", "outcomes")
    provides = ("recommendations", "email_improvements")

    #: Below this many email samples, a copy-level pattern is as likely to be
    #: noise as signal — same reasoning as MIN_SAMPLE, applied to the much
    #: earlier-funnel open/reply signal instead of won/lost deals, since a
    #: young org can have plenty of sent email before it has 20 decided deals.
    MIN_EMAIL_SAMPLE = 3

    async def execute(self, ctx: AgentContext) -> AgentResult:
        outcomes = ctx.get("outcomes") or {}
        performance = ctx.get("performance") or []
        email_samples = ctx.get("email_samples") or {}
        opened_no_reply = email_samples.get("openedNoReply") or []
        replied = email_samples.get("replied") or []

        decided = (outcomes.get("won", 0) or 0) + (outcomes.get("lost", 0) or 0)
        has_deal_sample = decided >= MIN_SAMPLE
        has_email_sample = (len(opened_no_reply) + len(replied)) >= self.MIN_EMAIL_SAMPLE

        if not has_deal_sample and not has_email_sample:
            return AgentResult(
                status=AgentStatus.SKIPPED,
                data={"recommendations": {}, "email_improvements": []},
                notes=[
                    f"only {decided} decided deals and {len(opened_no_reply) + len(replied)} "
                    f"tracked email samples; below the {MIN_SAMPLE}-deal / "
                    f"{self.MIN_EMAIL_SAMPLE}-email threshold needed for either to mean anything"
                ],
            )

        # Sections built conditionally: a section with no qualifying sample is
        # omitted from the prompt entirely rather than sent empty, so the model
        # is never tempted to fill a gap it was only shown because the code
        # asked for it.
        sections = []
        if has_deal_sample:
            sections.append(f"CAMPAIGN PERFORMANCE:\n{json.dumps(performance, default=str)[:4000]}")
            sections.append(f"OUTCOMES:\n{json.dumps(outcomes, default=str)[:3000]}")
        if has_email_sample:
            sections.append(
                "OPENED BUT NEVER REPLIED (subject + first ~600 chars, most recent 15):\n"
                + json.dumps(opened_no_reply, default=str)[:6000]
            )
            sections.append(
                "REPLIED TO (subject + first ~600 chars, most recent 15) — what's already working:\n"
                + json.dumps(replied, default=str)[:6000]
            )

        prompt = f"""Recommend improvements to this outbound system based on real outcomes.

{chr(10).join(f"{i+1}. {s}" for i, s in enumerate(sections))}

Every recommendation must cite the data above that supports it. A
recommendation you cannot justify from this data is a guess, and acting on it
would narrow the targeting for no reason. State a confidence level per
recommendation, and say plainly where a section above is missing or the
sample is too small to conclude anything from it.

{"For emailImprovements specifically: compare the opened-but-never-replied "
 "examples against the replied ones — what does the opening line, subject, or "
 "ask do differently in the ones that got a reply? A pattern must appear "
 "across multiple examples, not a guess from one email. If a section above "
 "was omitted, return an empty emailImprovements list rather than inventing "
 "one from nothing." if has_email_sample else ""}

Respond with ONLY JSON, no prose or code fences:
{{
  "icpRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "filterRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "messagingRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "offerRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "timingRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "stopDoing": string[],
  "sampleSizeWarning": string|null,
  "emailImprovements": [{{"title": string, "observation": string, "suggestion": string, "evidence": string}}]
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"recommendations": {}, "email_improvements": []},
                error=str(err),
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"recommendations": {}, "email_improvements": []},
                notes=["unparseable output"],
            )

        email_improvements = data.pop("emailImprovements", []) or []
        return AgentResult(
            status=AgentStatus.OK,
            data={"recommendations": data, "email_improvements": email_improvements},
            notes=["recommendations require human approval before taking effect"],
        )
