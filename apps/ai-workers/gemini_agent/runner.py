"""
Orchestrates the Gemini Personalization Agent for one lead (Part B3/D2).

Runs the same `email_only` pipeline (review -> email -> scheduler) the
registry declares, rather than calling drafting/critique directly — those
registered agents previously existed but nothing ever invoked them, so the
"email" row in the fleet roster was permanently idle regardless of how much
personalization actually ran through this ad-hoc path.
"""
import logging

from shared import api_client
from agents import AgentContext, build

logger = logging.getLogger("gemini_agent.runner")

DEFAULT_ORG_CONTEXT = {
    "name": "our company",
    "services": "AI automation and lead-generation systems",
    "tone_of_voice": "direct, warm, no jargon, no em dashes",
}


async def run_personalization(lead_id: str, org_id: str | None = None, org_context: dict | None = None) -> None:
    org_context = org_context or DEFAULT_ORG_CONTEXT
    lead_detail = await api_client.get_lead_detail(lead_id, org_id)
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail
    org_id = org_id or lead.get("orgId")

    orchestrator = build("email_only", seed_keys=("lead", "org_context", "case_study"))
    ctx = AgentContext(
        run_id=lead_id,
        org_id=org_id or "",
        data={
            "lead": lead_detail,
            "org_context": org_context,
            # TODO(Part D2): match against the CaseStudy table by industry/problem
            # similarity via embeddings instead of leaving this unset.
            "case_study": None,
        },
    )
    result = await orchestrator.run(ctx)

    draft = ctx.get("email_draft")
    if draft:
        await api_client.submit_email_draft(lead_id, draft["subject"], draft["body_html"], draft.get("rationale") or {})
        logger.info("Email 3 draft submitted for lead %s", lead_id)
    else:
        logger.error(
            "Email 3 drafting pipeline produced no draft for lead %s: stopped at %s (%s)",
            lead_id, result.stopped_at, result.stop_reason,
        )

    # Mirrors claude_agent/runner.py's telemetry flush: failures here must
    # never raise back into the FastAPI background task, since losing a
    # dashboard row is trivial and this is already the terminal step.
    if org_id:
        await api_client.record_agent_runs(
            org_id,
            None,
            [
                {
                    "agent": r.agent,
                    "status": r.status,
                    "durationMs": r.duration_ms,
                    "attempts": r.attempts,
                    "error": r.error,
                    "notes": r.notes,
                    "leadId": lead_id,
                }
                for r in result.records
            ],
        )
