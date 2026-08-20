"""
AI worker control plane (Part B1/B3). Exposes the entry points the NestJS
API calls into: kick off a bounded lead-extraction run (Claude agent) and
request a draft for one email of the 5-email sequence. Both handlers return
immediately and do the real work in a background task — the API's HTTP call
to us is fire-and-forget by design, with progress/results reported back via
callbacks into the NestJS API (shared/api_client.py).
"""
import logging

from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

from agents import PIPELINES, describe_fleet
from claude_agent.runner import request_cancel as request_extraction_cancel
from claude_agent.runner import run_in_background as run_extraction_in_background
from claude_agent.runner import run_manual_enrichment_in_background
from gemini_agent.runner import run_email_draft
from outreach_runner import run_linkedin_draft, run_optimisation

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
    step: int
    orgId: str | None = None
    orgContext: dict | None = None
    caseStudy: dict | None = None


class LinkedinDraftRequest(BaseModel):
    leadId: str
    orgId: str | None = None


class ManualEnrichmentRequest(BaseModel):
    leadId: str
    orgId: str
    orgContext: dict | None = None


class OptimisationRequest(BaseModel):
    orgId: str
    performance: list = []
    outcomes: dict = {}
    emailSamples: dict = {}


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


@app.post("/lead-gen/runs/{run_id}/cancel")
async def cancel_extraction_run(run_id: str):
    # Cooperative: the loop only checks this between candidates, so a run
    # already mid-CLI-call finishes that one candidate before stopping. Also
    # only takes effect if this worker process is the one running it — the
    # tracking is in-memory, so a request against a run started before the
    # last restart reports found=False rather than hanging.
    found = request_extraction_cancel(run_id)
    return {"runId": run_id, "found": found}


@app.post("/personalization/draft")
async def start_personalization(req: PersonalizationRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(
        run_email_draft, req.leadId, req.step, req.orgId, req.orgContext, req.caseStudy,
    )
    return {"accepted": True, "leadId": req.leadId, "step": req.step}


@app.post("/linkedin/draft")
async def start_linkedin_draft(req: LinkedinDraftRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_linkedin_draft, req.leadId, req.orgId)
    return {"accepted": True, "leadId": req.leadId}


@app.post("/lead-gen/enrich")
async def start_manual_enrichment(req: ManualEnrichmentRequest, background_tasks: BackgroundTasks):
    """Runs the manual_lead_enrichment pipeline against a lead that already
    exists — triggered once automatically when a manual lead is created
    (LeadsService.createManual), and on demand from the lead's detail page."""
    background_tasks.add_task(run_manual_enrichment_in_background, req.leadId, req.orgId, req.orgContext)
    return {"accepted": True, "leadId": req.leadId}


@app.post("/optimisation/run")
async def start_optimisation(req: OptimisationRequest):
    # Not backgrounded: the caller is a dashboard button waiting on the result,
    # and a single Claude CLI call is well within an HTTP request's timeout.
    return await run_optimisation(req.orgId, req.performance, req.outcomes, req.emailSamples)
