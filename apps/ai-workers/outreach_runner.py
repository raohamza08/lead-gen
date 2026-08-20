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
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}

    async def announce_start(agent) -> None:
        if not org_id:
            return
        await api_client.record_agent_started(org_id, lead_id, agent.name, agent.responsibility)

    async def stream(record) -> None:
        # Both steps ("review" then "linkedin") can each spend a Claude CLI
        # call, so stream them live rather than dumping both only once the
        # pipeline finishes.
        if not org_id:
            return
        await api_client.record_agent_runs(
            org_id,
            None,
            [
                {
                    "agent": record.agent, "status": record.status, "durationMs": record.duration_ms,
                    "attempts": record.attempts, "error": record.error, "notes": record.notes,
                    "leadId": lead_id,
                }
            ],
        )

    orchestrator = build("linkedin_draft", seed_keys=("lead",))
    ctx = AgentContext(
        run_id=lead_id, org_id=org_id or "", data={"lead": lead_detail, "org_context": org_context},
    )
    result = await orchestrator.run(ctx, on_step=stream, on_start=announce_start)

    messages = ctx.get("linkedin_messages")
    if messages:
        await api_client.submit_linkedin_draft(lead_id, messages)
        logger.info("LinkedIn draft submitted for lead %s", lead_id)
    else:
        logger.error(
            "LinkedIn drafting pipeline produced nothing for lead %s: stopped at %s (%s)",
            lead_id, result.stopped_at, result.stop_reason,
        )


async def run_optimisation(
    org_id: str, performance: list, outcomes: dict, email_samples: dict | None = None,
) -> dict:
    """Synchronous by design (unlike the two background-task entry points
    above): the caller is a dashboard button waiting to render the result, not
    a fire-and-forget sequencer hop.

    `email_samples` is optional (not in seed_keys) — LearningAgent treats it
    as optional context (see MIN_EMAIL_SAMPLE there), so an org with too
    little email history still gets ordinary recommendations, just no
    emailImprovements.
    """
    orchestrator = build("optimisation", seed_keys=("performance", "outcomes"))
    org_context = {"promptOverrides": await api_client.get_prompt_overrides(org_id)}
    ctx = AgentContext(
        run_id=org_id,
        org_id=org_id,
        data={
            "performance": performance,
            "outcomes": outcomes,
            "email_samples": email_samples or {},
            "org_context": org_context,
        },
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
        "emailImprovements": ctx.get("email_improvements") or [],
        "completed": result.completed,
        "stoppedAt": result.stopped_at,
        "stopReason": result.stop_reason,
        "notes": [n for r in result.records for n in r.notes],
    }
