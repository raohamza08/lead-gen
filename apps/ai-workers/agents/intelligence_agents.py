"""
The intelligence agents: company research, website audit, buyer research.

Each answers one question about a company, and each is separately re-runnable —
a website audit that fails does not cost the buyer research that already
succeeded. That independence is the whole reason these are separate agents
rather than one "enrich" step.

All three degrade rather than fail: a lead missing its SWOT is a poorer lead,
not an unusable one, and discarding a verified company because an optional
enrichment call failed would waste the quota already spent finding it.
"""
from __future__ import annotations

import logging

from claude_agent import cli_client

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.intelligence")


async def _ask_json(prompt: str) -> tuple[dict | None, str | None]:
    """One CLI turn returning parsed JSON, or (None, reason)."""
    try:
        envelope = await cli_client.query(prompt)
    except cli_client.ClaudeCliUnavailable as err:
        return None, str(err)
    parsed = cli_client.extract_json(envelope.get("result", ""))
    return (parsed, None) if parsed else (None, "unparseable model output")


class CompanyIntelligenceAgent(Agent):
    """Analyses the company itself, before any outreach is considered."""

    name = "company_intelligence"
    responsibility = "Company overview, SWOT, competitors, growth signals, digital maturity."
    requires = ("candidate",)
    provides = ("company_intelligence",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = ctx.get("candidate")
        website = candidate.get("website")
        if not website:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"company_intelligence": {}},
                notes=["no website to analyse"],
            )

        prompt = f"""Analyse this company for a B2B sales conversation. Fetch its website
and search for recent public information about it.

Company: {candidate.get('companyName')}
Website: {website}

Report only what you can source. A fabricated competitor, funding round or news
item destroys credibility the moment a prospect reads it back to you, so leave a
field null rather than guessing.

Scores are 0-100 and must be justified by what you actually observed:
- digitalMaturityScore: how digitally developed their operation is
- aiReadinessScore: how prepared they are to adopt AI (data, systems, appetite)
- automationOpportunityScore: how much repetitive work is visibly automatable

Respond with ONLY JSON, no prose or code fences:
{{
  "executiveSummary": string,
  "products": string[], "services": string[],
  "businessModel": string|null,
  "revenueSignals": string|null,
  "growthIndicators": string[],
  "competitors": string[],
  "techStack": string[], "crm": string|null,
  "marketingStack": string[],
  "recentNews": string[], "hiringActivity": string|null,
  "swot": {{"strengths": string[], "weaknesses": string[],
            "opportunities": string[], "threats": string[]}},
  "digitalMaturityScore": int, "aiReadinessScore": int,
  "automationOpportunityScore": int,
  "sources": string[]
}}"""

        data, err = await _ask_json(prompt)
        if data is None:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"company_intelligence": {}},
                error=err,
                notes=["lead retained without company intelligence"],
            )
        return AgentResult(status=AgentStatus.OK, data={"company_intelligence": data})


class WebsiteAuditAgent(Agent):
    """Audits the public website.

    Separate from company intelligence because it produces *evidence a
    salesperson can quote* — a measurable, checkable defect on a page the
    prospect owns. That is a different kind of output from a business summary,
    and it is the single most credible way to open a cold email.
    """

    name = "website_audit"
    responsibility = "Audits design, UX, mobile, SEO, speed, accessibility, conversion and security."
    requires = ("candidate",)
    provides = ("website_audit",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        website = ctx.get("candidate").get("website")
        if not website:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"website_audit": {}},
                notes=["no website to audit"],
            )

        prompt = f"""Audit this website: {website}

Fetch the site and judge each dimension from what is actually there. Every issue
you list may be quoted back to the company in a sales email, so it must be
specific and true — "no visible pricing page" is usable, "could be improved" is
not, and anything you cannot verify must be omitted.

Scores are 0-100, where 100 is excellent.

Respond with ONLY JSON, no prose or code fences:
{{
  "websiteScore": int,
  "designScore": int, "uxScore": int, "mobileScore": int,
  "seoScore": int, "speedScore": int, "accessibilityScore": int,
  "conversionScore": int, "securityScore": int, "contentScore": int,
  "uxIssues": string[], "seoIssues": string[],
  "conversionIssues": string[], "securityIssues": string[],
  "improvementSuggestions": string[],
  "recommendedServices": string[],
  "platform": string|null,
  "hasLiveChat": boolean, "hasOnlineBooking": boolean,
  "hasCustomerPortal": boolean, "hasEcommerce": boolean
}}"""

        data, err = await _ask_json(prompt)
        if data is None:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"website_audit": {}},
                error=err,
                notes=["lead retained without website audit"],
            )
        return AgentResult(status=AgentStatus.OK, data={"website_audit": data})


class BuyerIntelligenceAgent(Agent):
    """Researches the decision maker, not the company."""

    name = "buyer_intelligence"
    responsibility = "Builds the buyer persona and scores authority and engagement."
    requires = ("candidate",)
    provides = ("buyer_intelligence",)

    async def execute(self, ctx: AgentContext) -> AgentResult:
        candidate = ctx.get("candidate")
        contact = candidate.get("contactName")
        company = candidate.get("companyName")

        # Without a named contact there is no person to research. Skipping is
        # correct and cheap; asking the model to invent one is neither.
        if not contact:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"buyer_intelligence": {"authorityScore": 0, "engagementScore": 0}},
                notes=["no named contact — buyer research skipped"],
            )

        prompt = f"""Research this decision maker for a B2B sales approach.

Name: {contact}
Title: {candidate.get('jobTitle') or 'unknown'}
Company: {company}
Company site: {candidate.get('website') or 'unknown'}
LinkedIn: {candidate.get('contactLinkedinUrl') or 'unknown'}

Report only what you can source publicly. Never invent career history or
activity — a wrong detail in a first email is worse than no detail.

Scores are 0-100:
- authorityScore: how much budget authority this person plausibly holds
- engagementScore: how reachable and responsive they appear (public activity,
  visible contact routes). Low confidence must produce a low score, not a guess.

Respond with ONLY JSON, no prose or code fences:
{{
  "buyerPersona": string,
  "seniority": string|null,
  "department": string|null,
  "careerHighlights": string[],
  "recentActivity": string[],
  "authorityScore": int,
  "engagementScore": int,
  "bestApproach": string,
  "sources": string[]
}}"""

        data, err = await _ask_json(prompt)
        if data is None:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"buyer_intelligence": {"authorityScore": 0, "engagementScore": 0}},
                error=err,
                notes=["lead retained without buyer research"],
            )
        return AgentResult(status=AgentStatus.OK, data={"buyer_intelligence": data})
