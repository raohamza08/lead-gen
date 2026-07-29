"""
The per-lead agent chain: discovery -> verification -> research -> opportunity.

Each agent wraps capability that already existed but was previously fused into
one procedural runner. Splitting them is not cosmetic: it means a lead that
fails enrichment still keeps its verified contact data, a research failure no
longer discards a good candidate, and each step's cost and failure rate is
visible separately in the dashboard.
"""
from __future__ import annotations

import json
import logging

from claude_agent import cli_client
from claude_agent.scorer import score_candidate
from claude_agent.search_tools import find_candidate
from claude_agent.verifier import verify_candidate

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.lead")


class LeadDiscoveryAgent(Agent):
    name = "lead_discovery"
    responsibility = "Finds verified companies matching the configured filters."
    requires = ("niche_filter",)
    provides = ("candidate",)
    # Nothing downstream has anything to work on without a candidate.
    critical = True

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = await find_candidate(
            ctx.get("niche_filter"),
            ctx.get("attempt", 0),
            ctx.get("already_found") or [],
        )
        if candidate is None:
            # Not an error: the niche is saturated for this run. The extraction
            # loop reads this to stop cleanly rather than burning its remaining
            # attempts.
            return AgentResult(
                status=AgentStatus.FATAL,
                error="no further candidates matched the filter",
                notes=["niche exhausted for this run"],
            )
        return AgentResult(status=AgentStatus.OK, data={"candidate": candidate})


class LeadVerificationAgent(Agent):
    name = "lead_verification"
    responsibility = "Validates website, LinkedIn and email; rejects unqualified candidates."
    requires = ("candidate",)
    provides = ("verification",)
    critical = True

    async def execute(self, ctx: AgentContext) -> AgentResult:
        verification = await verify_candidate(ctx.get("candidate"))

        if not verification.get("qualifies"):
            # A rejected candidate is a normal, expected outcome — most are.
            # FATAL ends this candidate's pipeline without polluting the lead
            # table, which is exactly the "only verified leads" requirement.
            return AgentResult(
                status=AgentStatus.FATAL,
                data={"verification": verification},
                error="candidate failed verification",
                notes=["rejected before persistence — never counted as a lead"],
            )

        return AgentResult(status=AgentStatus.OK, data={"verification": verification})


class ResearchAgent(Agent):
    """Studies the company itself, separately from scoring it.

    Kept apart from OpportunityAgent on purpose: research establishes *facts*
    (what they sell, who they compete with, what they're hiring for) while the
    opportunity agent forms *judgements* on top of those facts. Fusing them
    produces confident-sounding opportunities with nothing underneath, and makes
    a wrong answer impossible to attribute.
    """

    name = "research"
    responsibility = "Studies the company's website, business model, competitors and growth signals."
    requires = ("candidate",)
    provides = ("research",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = ctx.get("candidate")
        company = candidate.get("companyName")
        website = candidate.get("website")

        if not website:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"research": {}},
                notes=["no website to research"],
            )

        prompt = f"""Research the company below for a B2B sales conversation. Fetch its
website and search for recent public information.

Company: {company}
Website: {website}

Report only what you can actually source. Leave a field null rather than
guessing — a fabricated competitor or funding round destroys credibility the
moment a prospect reads it.

Respond with ONLY JSON, no prose or code fences:
{{
  "businessSummary": string,
  "productsServices": string[],
  "competitors": string[],
  "growthSignals": string[],
  "hiringActivity": string|null,
  "fundingStatus": string|null,
  "recentNews": string[],
  "techStack": string[],
  "websitePlatform": string|null,
  "currentCrm": string|null,
  "aiUsage": string|null,
  "sources": string[]
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            # Research is valuable but not load-bearing: the lead is still real
            # and contactable without it, just less personalised.
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"research": {}},
                error=str(err),
                notes=["research skipped; lead retained without enrichment"],
            )

        research = cli_client.extract_json(envelope.get("result", "")) or {}
        if not research:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"research": {}},
                notes=["research returned unparseable output"],
            )

        return AgentResult(status=AgentStatus.OK, data={"research": research})


class OpportunityAgent(Agent):
    """Turns research plus candidate data into scores, pain points and an offer."""

    name = "opportunity"
    responsibility = "Identifies pain points, automation opportunities and the suggested offer."
    requires = ("candidate", "verification")
    provides = ("scores",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = dict(ctx.get("candidate"))
        research = ctx.get("research") or {}

        # Fold research into what the scorer sees, so its judgements rest on
        # sourced facts rather than the one-line description discovery produced.
        if research:
            candidate["research"] = research

        scores = await score_candidate(candidate, ctx.get("org_context") or {})

        if not scores:
            return AgentResult(status=AgentStatus.FAILED, error="scorer returned nothing")

        heuristic = "HEURISTIC FALLBACK" in json.dumps(scores)
        return AgentResult(
            status=AgentStatus.DEGRADED if heuristic else AgentStatus.OK,
            data={"scores": scores},
            notes=["scored heuristically — Claude CLI unavailable"] if heuristic else [],
        )
