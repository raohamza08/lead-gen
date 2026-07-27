"""Orchestrates the Gemini Personalization Agent for one lead (Part B3/D2)."""
import logging

from shared import api_client
from .context_builder import build_context, fetch_website_excerpt
from .drafting import draft_email
from .critique import critique_draft

logger = logging.getLogger("gemini_agent.runner")

DEFAULT_ORG_CONTEXT = {
    "name": "our company",
    "services": "AI automation and lead-generation systems",
    "tone_of_voice": "direct, warm, no jargon",
}


async def run_personalization(lead_id: str, org_id: str | None = None, org_context: dict | None = None) -> None:
    org_context = org_context or DEFAULT_ORG_CONTEXT
    lead_detail = await api_client.get_lead_detail(lead_id, org_id)
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail

    website_excerpt = await fetch_website_excerpt(lead.get("website"))
    # TODO(Part D2): match against the CaseStudy table by industry/problem
    # similarity via embeddings instead of leaving this unset.
    case_study = None

    context = build_context(lead_detail, website_excerpt, case_study)
    draft = await draft_email(context, org_context)

    critique = await critique_draft(context, draft)
    if not critique.get("pass"):
        logger.warning("Email 3 draft for lead %s failed self-critique: %s — retrying once", lead_id, critique.get("issues"))
        draft = await draft_email(context, org_context)
        critique = await critique_draft(context, draft)
        if not critique.get("pass"):
            logger.error("Email 3 draft for lead %s still fails self-critique after retry: %s", lead_id, critique.get("issues"))
            # Falls through and submits anyway with issues logged — a human
            # reviewer sees it in the approval queue rather than it vanishing
            # silently (Part D2: Gemini never sends directly).

    await api_client.submit_email_draft(lead_id, draft["subject"], draft["body_html"], draft["rationale"])
    logger.info("Email 3 draft submitted for lead %s", lead_id)
