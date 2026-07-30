"""
The AI's own counterpart to human review.

Separate from ReviewAgent in outreach_agents.py, which merges a human's
review note with AI findings for the outreach agents to read — this one
produces the note itself, independent of any human input, so a reviewer gets
a populated starting point (agree, correct, or override) instead of a blank
form and the raw agent output scattered across a dozen fields.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.review")


class AgentReviewAgent(Agent):
    """Fills in the same fields a human reviewer would, from what the
    intelligence/opportunity/scoring agents already established.

    Reads only what earlier agents produced — the same discipline as every
    other agent in this fleet: a field this synthesises must trace back to an
    observed fact, not to the model inventing something plausible to fill a
    blank.
    """

    name = "agent_review"
    responsibility = "AI-authored review note — same fields a human reviewer fills in, from what the agents found."
    requires = ("candidate", "scores")
    provides = ("agent_review",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = ctx.get("candidate")
        intel = ctx.get("company_intelligence") or {}
        audit = ctx.get("website_audit") or {}
        buyer = ctx.get("buyer_intelligence") or {}
        opportunities = ctx.get("opportunities") or {}
        scores = ctx.get("scores") or {}

        context_json = json.dumps(
            {
                "company": candidate.get("companyName"),
                "industry": candidate.get("industry"),
                "website": candidate.get("website"),
                "companyIntelligence": intel,
                "websiteAudit": audit,
                "buyerIntelligence": buyer,
                "opportunities": opportunities,
                "scores": scores,
            },
            default=str,
        )[:8000]

        prompt = f"""You are filling in a sales lead's review note — the same form a human
reviewer completes before this lead is contacted. Base every field ONLY on the
research below; a claim you cannot trace back to it is a guess, and a guess a
salesperson repeats to the prospect destroys credibility on contact. Leave a
field null rather than inventing something plausible.

{context_json}

Respond with ONLY JSON, no prose or code fences:
{{
  "websiteIssues": string|null,
  "businessProblems": string|null,
  "opportunities": string|null,
  "automationOpportunities": string|null,
  "crmIssues": string|null,
  "salesIssues": string|null,
  "marketingIssues": string|null,
  "operationalIssues": string|null,
  "suggestedService": string|null,
  "suggestedOffer": string|null,
  "suggestedCaseStudy": string|null,
  "suggestedHook": string|null,
  "painPoints": string|null,
  "urgencyLevel": "LOW"|"MEDIUM"|"HIGH"|null,
  "expectedValue": number|null,
  "notes": string|null
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"agent_review": {}},
                error=str(err),
                notes=["AI review not generated"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        data = {k: v for k, v in data.items() if v not in (None, "")}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"agent_review": {}},
                notes=["AI review returned unparseable output"],
            )
        return AgentResult(status=AgentStatus.OK, data={"agent_review": data})
