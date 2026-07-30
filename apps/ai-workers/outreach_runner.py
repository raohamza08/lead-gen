"""
Entry points for the two agents that had no live caller at all: LinkedIn copy
generation (triggered on demand from a lead's detail page, never
automatically — LinkedIn outreach itself stays human-driven, ToS/ban risk)
and the cross-lead optimisation pipeline (analytics + learning), triggered on
demand from the Analytics dashboard rather than on a schedule, since it costs
a Claude CLI call and its output is a recommendation a human reviews, not
something that needs to be fresh every minute.
"""
import logging

from shared import api_client
from agents import AgentContext, build

logger = logging.getLogger("outreach_runner")


async def run_linkedin_draft(lead_id: str, org_id: str | None = None) -> None:
    lead_detail = await api_client.get_lead_detail(lead_id, org_id)
    lead = lead_detail["lead"] if "lead" in lead_detail else lead_detail
    org_id = org_id or lead.get("orgId")

    orchestrator = build("linkedin_draft", seed_keys=("lead",))
    ctx = AgentContext(run_id=lead_id, org_id=org_id or "", data={"lead": lead_detail})
    result = await orchestrator.run(ctx)

    messages = ctx.get("linkedin_messages")
    if messages:
        await api_client.submit_linkedin_draft(lead_id, messages)
        logger.info("LinkedIn draft submitted for lead %s", lead_id)
    else:
        logger.error(
            "LinkedIn drafting pipeline produced nothing for lead %s: stopped at %s (%s)",
            lead_id, result.stopped_at, result.stop_reason,
        )

    if org_id:
        await api_client.record_agent_runs(
            org_id,
            None,
            [
                {
                    "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                    "attempts": r.attempts, "error": r.error, "notes": r.notes, "leadId": lead_id,
                }
                for r in result.records
            ],
        )


async def run_optimisation(org_id: str, performance: list, outcomes: dict) -> dict:
    """Synchronous by design (unlike the two background-task entry points
    above): the caller is a dashboard button waiting to render the result, not
    a fire-and-forget sequencer hop."""
    orchestrator = build("optimisation", seed_keys=("performance", "outcomes"))
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={"performance": performance, "outcomes": outcomes},
    )
    result = await orchestrator.run(ctx)

    await api_client.record_agent_runs(
        org_id,
        None,
        [
            {
                "agent": r.agent, "status": r.status, "durationMs": r.duration_ms,
                "attempts": r.attempts, "error": r.error, "notes": r.notes,
            }
            for r in result.records
        ],
    )

    return {
        "insights": ctx.get("insights") or {},
        "recommendations": ctx.get("recommendations") or {},
        "completed": result.completed,
        "stoppedAt": result.stopped_at,
        "stopReason": result.stop_reason,
        "notes": [n for r in result.records for n in r.notes],
    }
