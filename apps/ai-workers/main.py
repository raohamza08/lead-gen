"""
AI worker control plane (Part B1/B3). Exposes the two entry points the NestJS
API calls into: kick off a bounded lead-extraction run (Claude agent) and
request an Email #3 draft (Gemini agent). Both handlers return immediately and
do the real work in a background task — the API's HTTP call to us is
fire-and-forget by design (Part C1/D2 sequence diagrams), with progress/results
reported back via callbacks into the NestJS API (shared/api_client.py).
"""
import logging

from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

from agents import PIPELINES, describe_fleet
from claude_agent.runner import run_in_background as run_extraction_in_background
from gemini_agent.runner import run_personalization

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Lead-Gen AI Workers")


class ExtractionRunRequest(BaseModel):
    runId: str
    filter: dict
    # Human-readable targeting criteria rendered by the API from the shared
    # filter taxonomy. Optional so an older caller (or a direct curl) still
    # works — search_tools falls back to describing the raw filter dict.
    searchBrief: str | None = None
    orgContext: dict | None = None


class PersonalizationRequest(BaseModel):
    leadId: str
    orgId: str | None = None
    orgContext: dict | None = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/agents")
async def list_agents():
    """The agent roster, for the dashboard's AI Performance panel.

    Reads from the registry rather than a hand-maintained list, so an agent
    added to the fleet appears here without a second edit that could be
    forgotten.
    """
    return {"agents": describe_fleet(), "pipelines": {k: list(v) for k, v in PIPELINES.items()}}


@app.post("/lead-gen/runs")
async def start_extraction_run(req: ExtractionRunRequest, background_tasks: BackgroundTasks):
    niche_filter = {**req.filter, "orgId": req.filter.get("orgId"), "searchBrief": req.searchBrief}
    background_tasks.add_task(run_extraction_in_background, req.runId, niche_filter, req.orgContext)
    return {"accepted": True, "runId": req.runId}


@app.post("/personalization/draft")
async def start_personalization(req: PersonalizationRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_personalization, req.leadId, req.orgId, req.orgContext)
    return {"accepted": True, "leadId": req.leadId}
