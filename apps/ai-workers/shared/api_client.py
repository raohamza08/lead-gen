"""
Thin client back into the NestJS core API (Part B1: AI workers never write to
Sheets/ClickUp/DB directly — everything goes through the Lead/Sequencer API so
every external write is auditable and rate-limited in one place, Part D1).
"""
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


async def update_extraction_run(run_id: str, patch: dict) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.patch(f"/extraction-runs/{run_id}", json=patch, headers=_headers())
        resp.raise_for_status()


async def get_lead_detail(lead_id: str, org_id: str | None = None) -> dict:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.get(f"/leads/{lead_id}/internal", params={"orgId": org_id}, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def submit_email_draft(lead_id: str, subject: str, body_html: str, rationale: dict) -> None:
    async with httpx.AsyncClient(base_url=settings.api_base_url, timeout=30) as client:
        resp = await client.post(
            f"/leads/{lead_id}/draft-email",
            json={"subject": subject, "bodyHtml": body_html, "rationale": rationale},
            headers=_headers(),
        )
        resp.raise_for_status()
