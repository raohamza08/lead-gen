"""
Thin client back into the NestJS core API (Part B1: AI workers never write to
Sheets/ClickUp/DB directly — everything goes through the Lead/Sequencer API so
every external write is auditable and rate-limited in one place, Part D1).
"""
import logging

import httpx
from config import settings


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "x-internal-token": settings.internal_service_token,
    }


async def get_prompt_overrides(org_id: str) -> dict:
    """Org-saved agent-prompt overrides from Settings (Part: agent prompts),
    keyed by agent name — merged into `org_context["promptOverrides"]` at the
    top of each pipeline entry point so a run doesn't need every caller to
    remember to thread it through. Never raises: a missing org_id, a network
    blip, or the org simply never having customised anything all just mean
    "no overrides", not a reason to fail a pipeline that would otherwise run
    fine on shipped defaults."""
    if not org_id:
        return {}
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=10) as client:
            resp = await client.get(
                "/settings/organization/prompt-overrides", params={"orgId": org_id}, headers=_headers()
            )
            resp.raise_for_status()
            return resp.json() or {}
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").warning(
            "could not fetch prompt overrides for org %s: %s", org_id, err
        )
        return {}


async def create_lead(org_id: str, lead_payload: dict) -> dict:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.post("/leads", json={"orgId": org_id, **lead_payload}, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def record_agent_runs(org_id: str, run_id: str | None, records: list[dict]) -> None:
    """Ship agent telemetry to the API.

    Batched, because one extraction run produces seven records per candidate —
    at 100 leads/day that would be 700 round trips the worker spends waiting
    instead of finding leads.

    Failures are swallowed deliberately: telemetry must never be able to fail a
    run that otherwise succeeded. Losing a dashboard row is trivial; losing a
    verified lead because the metrics endpoint was briefly down is not.
    """
    if not records:
        return
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
            resp = await client.post(
                "/agent-runs",
                json={"orgId": org_id, "runId": run_id, "records": records},
                headers=_headers(),
            )
            resp.raise_for_status()
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").warning("agent telemetry not recorded: %s", err)


async def record_agent_started(org_id: str, lead_id: str | None, agent: str, responsibility: str) -> None:
    """Fire-and-forget signal that an agent has begun work on a lead — purely
    for the dashboard's live "X is working on this now" indicator, nothing is
    persisted for it. Swallowed on failure for the same reason as
    record_agent_runs: losing a progress ping must never touch a real run.
    """
    if not lead_id:
        return
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=10) as client:
            resp = await client.post(
                "/agent-runs/started",
                json={"orgId": org_id, "leadId": lead_id, "agent": agent, "responsibility": responsibility},
                headers=_headers(),
            )
            resp.raise_for_status()
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").warning("agent-started ping not recorded: %s", err)


async def update_extraction_run(run_id: str, patch: dict) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.patch(f"/extraction-runs/{run_id}", json=patch, headers=_headers())
        resp.raise_for_status()


async def apply_enrichment(lead_id: str, org_id: str, patch: dict) -> None:
    """Writes the manual-lead enrichment pipeline's results onto a lead that
    already exists — the update counterpart to create_lead above."""
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.patch(
            f"/leads/{lead_id}/enrichment",
            json={"orgId": org_id, **patch},
            headers=_headers(),
        )
        resp.raise_for_status()


async def get_lead_detail(lead_id: str, org_id: str | None = None) -> dict:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.get(f"/leads/{lead_id}/internal", params={"orgId": org_id}, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def submit_email_draft(
    lead_id: str, step: int, subject: str, body_html: str, rationale: dict, needs_review: bool = False,
) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.post(
            f"/leads/{lead_id}/draft-email",
            json={
                "sequenceStep": step,
                "subject": subject,
                "bodyHtml": body_html,
                "rationale": rationale,
                "needsReview": needs_review,
            },
            headers=_headers(),
        )
        resp.raise_for_status()


async def report_email_draft_failed(lead_id: str, step: int, reason: str) -> None:
    """Counterpart to submit_email_draft for when drafting produced no
    usable output at all (Claude CLI error/timeout, or a lint failure that
    survived the retry — see gemini_agent/runner.py). Before this existed,
    that path only logged locally: no EmailMessage row, no notification, and
    the lead was left sitting at its current stage indistinguishable from one
    still waiting its turn (confirmed 2026-08-31: a rate-limit burst silently
    stranded 96 leads at READY_FOR_OUTREACH for two days).

    Swallowed on failure like the other telemetry-shaped calls here — a
    reporting error must not be allowed to raise past the caller and mask the
    original drafting failure with a different traceback.
    """
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
            resp = await client.post(
                f"/leads/{lead_id}/draft-email/failed",
                json={"sequenceStep": step, "reason": reason[:500]},
                headers=_headers(),
            )
            resp.raise_for_status()
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").error(
            "could not report drafting failure for lead %s step %s: %s", lead_id, step, err
        )


async def start_execution(
    org_id: str, lead_id: str, agent: str, payload: dict | None = None,
) -> str | None:
    """Acquires the retry/lock row for one (lead, agent) pair before an agent
    that gates a lead's next stage begins (Part: reliability overhaul,
    2026-08-31) — see NestJS's AgentExecutionService. `payload` should carry
    exactly the extra fields AgentDispatchQueue needs to redispatch this
    agent (e.g. email_draft's step/orgContext/caseStudy) — the retry sweep
    replays it verbatim, so it must match AgentDispatchWorker's dispatchBody
    for this agent kind.

    Returns None (never raises) on a 409 (already running — a retry landed
    while a previous attempt was still in flight) or any other failure
    (core API briefly unreachable). Either way the caller should skip running
    rather than risk a duplicate concurrent execution of the same agent.
    """
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=15) as client:
            resp = await client.post(
                "/agent-executions/start",
                json={"orgId": org_id, "leadId": lead_id, "agent": agent, "payload": payload or {}},
                headers=_headers(),
            )
            if resp.status_code == 409:
                logging.getLogger("shared.api_client").info(
                    "%s already running for lead %s — skipping duplicate attempt", agent, lead_id,
                )
                return None
            resp.raise_for_status()
            return resp.json()["executionId"]
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").error(
            "could not start execution %s for lead %s: %s", agent, lead_id, err
        )
        return None


async def report_execution_success(org_id: str, lead_id: str, agent: str, execution_id: str) -> None:
    """Counterpart to start_execution for a successful run. Swallowed on
    failure like the other telemetry-shaped calls here."""
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=15) as client:
            resp = await client.post(
                "/agent-executions/succeed",
                json={"orgId": org_id, "leadId": lead_id, "agent": agent, "executionId": execution_id},
                headers=_headers(),
            )
            resp.raise_for_status()
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").error(
            "could not report success for %s on lead %s: %s", agent, lead_id, err
        )


async def report_execution_failed(
    org_id: str,
    lead_id: str,
    agent: str,
    execution_id: str,
    error_detail: str,
    retryable: bool = True,
    skip_notification: bool = False,
) -> None:
    """Counterpart to start_execution for a failed run — records the failure
    and, if retryable, schedules an automatic retry roughly every hour with
    progressively increasing backoff (Part: reliability overhaul,
    2026-08-31; generalizes commit ae6d24e's fix for email drafting to every
    agent). Swallowed on failure like every other telemetry-shaped call
    here: losing this report must not raise past the caller and mask the
    original error with a different traceback."""
    try:
        async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=15) as client:
            resp = await client.post(
                "/agent-executions/fail",
                json={
                    "orgId": org_id,
                    "leadId": lead_id,
                    "agent": agent,
                    "executionId": execution_id,
                    "errorDetail": error_detail[:4000],
                    "retryable": retryable,
                    "skipNotification": skip_notification,
                },
                headers=_headers(),
            )
            resp.raise_for_status()
    except Exception as err:  # noqa: BLE001
        logging.getLogger("shared.api_client").error(
            "could not report failure for %s on lead %s: %s", agent, lead_id, err
        )


async def submit_linkedin_draft(lead_id: str, messages: dict) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.patch(
            f"/leads/{lead_id}/linkedin-draft",
            json={"messages": messages},
            headers=_headers(),
        )
        resp.raise_for_status()
