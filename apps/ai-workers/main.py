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
from outreach_runner import run_case_study_review, run_linkedin_draft, run_optimisation
from shared.prompts import default_prompt

#: Every agent whose prompt is a plain, editable instructions block — the
#: roster the Settings "Agent prompts" page lists. Deliberately not every
#: name in registry.py: `review` and `scheduler` are pure deterministic
#: Python (no model call, nothing to edit), and `email` is split into six
#: rows here (one per sequence step plus the shared voice rules) since those
#: are genuinely different text a human would want to edit independently,
#: even though they're all one agent in the pipeline sense.
PROMPTABLE_AGENTS: dict[str, str] = {
    "lead_discovery": "Finds verified companies matching the configured filters.",
    "ai_opportunity": "Identifies manual workflows, automation ideas, ROI and estimated deal size.",
    "lead_scoring": "Scores business fit, AI opportunity, intent, budget, tech gap and DM access.",
    "company_intelligence": "Company overview, SWOT, competitors, growth signals, digital maturity.",
    "website_audit": "Audits design, UX, mobile, SEO, speed, accessibility, conversion and security.",
    "buyer_intelligence": "Builds the buyer persona and scores authority and engagement.",
    "linkedin": "Drafts LinkedIn connection requests and follow-ups for a human to send.",
    "analytics": "Interprets campaign performance and flags what is and isn't working.",
    "learning": "Learns which niches, offers and messages perform, and proposes improvements.",
    "agent_review": "AI-authored review note — same fields a human reviewer fills in, from what the agents found.",
    "email_step_1": "Email 1 of 5 — Problem Trigger.",
    "email_step_2": "Email 2 of 5 — Industry Insight.",
    "email_step_3": "Email 3 of 5 — Proof.",
    "email_step_4": "Email 4 of 5 — Soft Offer.",
    "email_step_5": "Email 5 of 5 — Breakup.",
    "email_voice_rules": "Shared tone/style rules applied to every email in the sequence.",
    "case_study_review": "Reviews a submitted case study for real niche fit and email-ready wording, never inventing a number.",
}

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


class CaseStudyReviewRequest(BaseModel):
    orgId: str
    title: str | None = None
    rawStory: str
    submittedIndustry: str


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


@app.get("/agents/prompts")
async def list_agent_prompts():
    """Shipped default prompt text for every editable agent — what Settings'
    "Agent prompts" page shows and what "Restore default" reverts to. Org
    overrides are NestJS's concern (Organization.settings), not this
    process's — this endpoint only ever answers "what did we ship"."""
    return {
        name: {"responsibility": responsibility, "defaultPrompt": default_prompt(name)}
        for name, responsibility in PROMPTABLE_AGENTS.items()
    }


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


@app.post("/case-study/review")
async def review_case_study(req: CaseStudyReviewRequest):
    # Not backgrounded, same reasoning as optimisation above — Settings is
    # waiting on this to show the finalised case study.
    return await run_case_study_review(req.orgId, req.title, req.rawStory, req.submittedIndustry)
