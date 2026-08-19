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


async def submit_linkedin_draft(lead_id: str, messages: dict) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.patch(
            f"/leads/{lead_id}/linkedin-draft",
            json={"messages": messages},
            headers=_headers(),
        )
        resp.raise_for_status()
