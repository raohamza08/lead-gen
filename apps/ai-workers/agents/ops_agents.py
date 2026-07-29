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
    provides = ("recommendations",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        outcomes = ctx.get("outcomes") or {}
        performance = ctx.get("performance") or []

        decided = (outcomes.get("won", 0) or 0) + (outcomes.get("lost", 0) or 0)
        if decided < MIN_SAMPLE:
            return AgentResult(
                status=AgentStatus.SKIPPED,
                data={"recommendations": {}},
                notes=[
                    f"only {decided} decided deals; learning from fewer than {MIN_SAMPLE} "
                    f"would fit noise and narrow the targeting on no evidence"
                ],
            )

        prompt = f"""Recommend improvements to this outbound system based on real outcomes.

CAMPAIGN PERFORMANCE:
{json.dumps(performance, default=str)[:4000]}

OUTCOMES:
{json.dumps(outcomes, default=str)[:3000]}

Every recommendation must cite the outcome data that supports it. A
recommendation you cannot justify from this data is a guess, and acting on it
would narrow the targeting for no reason.

State a confidence level per recommendation, and say plainly where the sample is
too small to conclude anything.

Respond with ONLY JSON, no prose or code fences:
{{
  "icpRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "filterRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "messagingRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "offerRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "timingRecommendations": [{{"change": string, "evidence": string, "confidence": "LOW"|"MEDIUM"|"HIGH"}}],
  "stopDoing": string[],
  "sampleSizeWarning": string|null
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED, data={"recommendations": {}}, error=str(err)
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"recommendations": {}},
                notes=["unparseable output"],
            )

        return AgentResult(
            status=AgentStatus.OK,
            data={"recommendations": data},
            notes=["recommendations require human approval before taking effect"],
        )
