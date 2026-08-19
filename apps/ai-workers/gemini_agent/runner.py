"""
Orchestrates one email of the 5-email sequence for one lead (Part: 5-email
sequence, 2026-08-12).

Runs the same `email_only` pipeline (review -> email -> scheduler) the
registry declares, rather than calling drafting directly — those registered
agents previously existed but nothing ever invoked them, so the "email" row
in the fleet roster was permanently idle regardless of how much
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


async def run_email_draft(
    lead_id: str,
    step: int,
    org_id: str | None = None,
    org_context: dict | None = None,
    case_study: dict | None = None,
) -> None:
    org_context = org_context or DEFAULT_ORG_CONTEXT
    lead_detail = await api_client.get_lead_detail(lead_id, org_id)
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail
    org_id = org_id or lead.get("orgId")

    async def announce_start(agent) -> None:
        if not org_id:
            return
        await api_client.record_agent_started(org_id, lead_id, agent.name, agent.responsibility)

    async def stream(record) -> None:
        # Sent the moment each of review/email/scheduler finishes rather than
        # batched at the end, so a lead sitting in a WAITING_EMAIL_N stage
        # shows real progress on its agent timeline instead of nothing for
        # however long the draft takes. Mirrors record_agent_runs' own
        # swallow-on-failure rule: losing one progress update must not abort
        # the run.
        if not org_id:
            return
        await api_client.record_agent_runs(
            org_id,
            None,
            [
                {
                    "agent": record.agent,
                    "status": record.status,
                    "durationMs": record.duration_ms,
                    "attempts": record.attempts,
                    "error": record.error,
                    "notes": record.notes,
                    "leadId": lead_id,
                }
            ],
        )

    orchestrator = build("email_only", seed_keys=("lead", "org_context", "case_study", "sequence_step"))
    ctx = AgentContext(
        run_id=lead_id,
        org_id=org_id or "",
        data={
            "lead": lead_detail,
            "org_context": org_context,
            # Only Email 3 ("Proof") reads this — see EmailAgent/drafting.py.
            # Passed in from NestJS's SequencerService, which already runs
            # this exact CaseStudy lookup (org + lead industry).
            "case_study": case_study,
            "sequence_step": step,
        },
    )
    result = await orchestrator.run(ctx, on_step=stream, on_start=announce_start)

    draft = ctx.get("email_draft")
    if draft:
        await api_client.submit_email_draft(
            lead_id, step, draft["subject"], draft["body_html"],
            draft.get("rationale") or {}, draft.get("needsReview", False),
        )
        logger.info("Email %d draft submitted for lead %s", step, lead_id)
    else:
        logger.error(
            "Email %d drafting pipeline produced no draft for lead %s: stopped at %s (%s)",
            step, lead_id, result.stopped_at, result.stop_reason,
        )
