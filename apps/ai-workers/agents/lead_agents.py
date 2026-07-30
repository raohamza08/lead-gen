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

    def __init__(self, *, reject_unqualified: bool = True) -> None:
        # Discovery candidates aren't persisted yet, so failing verification
        # can end the pipeline outright (see below). A manual lead is already
        # a Lead row a human created deliberately — rejecting it the same way
        # would mean it silently never gets enriched. Registered under a
        # second registry key ("lead_verification_soft") for the manual
        # pipeline; see registry.py.
        self.reject_unqualified = reject_unqualified

    async def execute(self, ctx: AgentContext) -> AgentResult:
        verification = await verify_candidate(ctx.get("candidate"))

        if not verification.get("qualifies") and self.reject_unqualified:
            # A rejected candidate is a normal, expected outcome — most are.
            # FATAL ends this candidate's pipeline without polluting the lead
            # table, which is exactly the "only verified leads" requirement.
            return AgentResult(
                status=AgentStatus.FATAL,
                data={"verification": verification},
                error="candidate failed verification",
                notes=["rejected before persistence — never counted as a lead"],
            )

        if not verification.get("qualifies"):
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"verification": verification},
                notes=["one or more contact details could not be verified"],
            )

        return AgentResult(status=AgentStatus.OK, data={"verification": verification})


class AiOpportunityAgent(Agent):
    """Identifies what to actually sell this company, and what it is worth.

    Deliberately separate from LeadScoringAgent. This agent answers "what is the
    opportunity here"; scoring answers "how good a lead is this". Fusing them
    lets a high score justify a vague opportunity and vice versa, and makes a
    wrong answer impossible to attribute to one or the other.
    """

    name = "ai_opportunity"
    responsibility = "Identifies manual workflows, automation ideas, ROI and estimated deal size."
    requires = ("candidate",)
    provides = ("opportunities",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = ctx.get("candidate")
        intel = ctx.get("company_intelligence") or {}
        audit = ctx.get("website_audit") or {}

        context_json = json.dumps(
            {
                "company": candidate.get("companyName"),
                "industry": candidate.get("industry"),
                "employees": candidate.get("employeeCount"),
                "description": candidate.get("businessDescription"),
                "intelligence": intel,
                "websiteAudit": audit,
            },
            default=str,
        )[:6000]

        services = (ctx.get("org_context") or {}).get("services", "AI automation services")

        prompt = f"""Identify the concrete opportunities to sell {services} to this company.

{context_json}

Base every opportunity on something in the data above. An opportunity you cannot
tie to an observed fact is a guess, and a guess in a first email is obvious to
the reader — omit it instead.

Be specific: "automate the manual quote-to-invoice handoff across their three
systems" is usable; "improve efficiency with AI" is not.

Respond with ONLY JSON, no prose or code fences:
{{
  "manualWorkflows": string[],
  "operationalBottlenecks": string[],
  "topAiOpportunities": [
    {{"opportunity": string, "expectedRoi": string, "estimatedImpact": string,
      "complexity": "LOW"|"MEDIUM"|"HIGH", "evidence": string}}
  ],
  "crmImprovements": string[],
  "automationOpportunities": string[],
  "saasOpportunities": string[],
  "painPoints": string,
  "suggestedServices": string[],
  "estimatedDealSize": number,
  "projectComplexity": "LOW"|"MEDIUM"|"HIGH"
}}"""

        try:
            envelope = await cli_client.query(prompt)
        except cli_client.ClaudeCliUnavailable as err:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"opportunities": {}},
                error=str(err),
                notes=["lead retained without opportunity analysis"],
            )

        data = cli_client.extract_json(envelope.get("result", "")) or {}
        if not data:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"opportunities": {}},
                notes=["opportunity analysis returned unparseable output"],
            )
        return AgentResult(status=AgentStatus.OK, data={"opportunities": data})


class LeadScoringAgent(Agent):
    """Scores the lead on the six-dimension rubric and produces the priority score.

    Runs last on purpose: it scores against everything the earlier agents
    established, so a lead whose research or audit degraded is scored on what
    was actually verified rather than on optimistic assumptions.
    """

    name = "lead_scoring"
    responsibility = "Scores business fit, AI opportunity, intent, budget, tech gap and DM access."
    requires = ("candidate", "verification")
    provides = ("scores",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        # Everything the earlier agents produced is folded in, so the scorer
        # judges sourced facts rather than the one-line description discovery
        # returned.
        candidate = dict(ctx.get("candidate"))
        for key in ("company_intelligence", "website_audit", "buyer_intelligence", "opportunities"):
            value = ctx.get(key)
            if value:
                candidate[key] = value

        scores = await score_candidate(candidate, ctx.get("org_context") or {})
        if not scores:
            return AgentResult(status=AgentStatus.FAILED, error="scorer returned nothing")

        heuristic = "HEURISTIC FALLBACK" in json.dumps(scores)
        return AgentResult(
            status=AgentStatus.DEGRADED if heuristic else AgentStatus.OK,
            data={"scores": scores},
            notes=["scored heuristically — Claude CLI unavailable"] if heuristic else [],
        )
