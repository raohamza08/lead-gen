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
from shared.prompts import load_prompt

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

        prompt = (
            f"{load_prompt('company_intelligence', ctx.get('org_context'))}\n\n"
            f"Company: {candidate.get('companyName')}\nWebsite: {website}"
        )

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

        prompt = f"{load_prompt('website_audit', ctx.get('org_context'))}\n\nWebsite: {website}"

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

        prompt = (
            f"{load_prompt('buyer_intelligence', ctx.get('org_context'))}\n\n"
            f"Name: {contact}\nTitle: {candidate.get('jobTitle') or 'unknown'}\n"
            f"Company: {company}\nCompany site: {candidate.get('website') or 'unknown'}\n"
            f"LinkedIn: {candidate.get('contactLinkedinUrl') or 'unknown'}"
        )

        data, err = await _ask_json(prompt)
        if data is None:
            return AgentResult(
                status=AgentStatus.DEGRADED,
                data={"buyer_intelligence": {"authorityScore": 0, "engagementScore": 0}},
                error=err,
                notes=["lead retained without buyer research"],
            )
        return AgentResult(status=AgentStatus.OK, data={"buyer_intelligence": data})
