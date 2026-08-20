"""
The bounded extraction loop (Part B3/C1). Stops on whichever comes first:
verified == daily_target, attempts == max_attempts, or elapsed == max_runtime —
never loops forever against a thin/saturated niche.
"""
import asyncio
import logging
import time

from config import settings
from shared import api_client
from agents import AgentContext, build, build_for_filter

logger = logging.getLogger("claude_agent.runner")

# One entry per in-flight extraction run, keyed by run_id. The loop in
# run_extraction only checks this between candidates — there's no cheap way to
# interrupt a candidate already mid-CLI-call (subprocess.run is synchronous,
# dispatched to a worker thread), so "stop" means "finish the current
# candidate, start no more," not an instant kill.
_cancel_events: dict[str, asyncio.Event] = {}


def request_cancel(run_id: str) -> bool:
    """Called from the /lead-gen/runs/{id}/cancel endpoint. Returns False if
    the run isn't tracked here — already finished, or this worker process
    restarted since it started (in-memory only, doesn't survive a restart)."""
    event = _cancel_events.get(run_id)
    if event is None:
        return False
    event.set()
    return True


async def run_extraction(run_id: str, niche_filter: dict, org_context: dict | None = None) -> None:
    org_id = niche_filter["orgId"]
    daily_target = niche_filter.get("dailyTarget", 100)
    # Fetched once per run, not per candidate — this pipeline runs the same
    # prompt-bearing agents (discovery, opportunity, intelligence, scoring)
    # up to `daily_target` times, and the override set doesn't change mid-run.
    org_context = dict(org_context or {})
    org_context["promptOverrides"] = await api_client.get_prompt_overrides(org_id)

    cancel_event = asyncio.Event()
    _cancel_events[run_id] = cancel_event

    verified = 0
    duplicates = 0
    rejected = 0
    attempts = 0
    started_at = time.monotonic()
    already_found: list[str] = []
    search_failed: str | None = None
    agent_records: list = []

    # 40/40/20 high/medium/experimental. LOW is the experimental band: those are
    # the leads outside the obvious profile, and finding out which of them
    # convert is the only way the targeting improves.
    priority_counts = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    priority_targets = {
        "HIGH": round(daily_target * 0.4),
        "MEDIUM": round(daily_target * 0.4),
        "LOW": daily_target - round(daily_target * 0.4) * 2,
    }

    async def report_progress() -> None:
        # Fired once per candidate attempt while the loop is RUNNING, so the
        # dashboard's "Run now" button can show real progress instead of going
        # quiet for however long the run takes. Swallowed on failure —
        # unlike the final call below, a blip here must never abort an
        # otherwise-healthy run over a missed progress ping.
        try:
            await api_client.update_extraction_run(
                run_id,
                {
                    "leadsFound": attempts,
                    "leadsVerified": verified,
                    "duplicatesSkipped": duplicates,
                    "status": "RUNNING",
                    "priorityMix": priority_counts,
                },
            )
        except Exception as err:  # noqa: BLE001
            logger.warning("run %s: progress ping not recorded: %s", run_id, err)

    # Built once per run, not per candidate: construction validates that every
    # agent's requirements are satisfied by something earlier in the chain, and
    # paying that check 40 times would be waste.
    orchestrator = build_for_filter(
        niche_filter,
        seed_keys=("niche_filter", "org_context", "attempt", "already_found"),
    )
    logger.info(
        "run %s: pipeline = %s",
        run_id, " -> ".join(a.name for a in orchestrator.agents),
    )

    while (
        verified < daily_target
        and attempts < settings.max_search_attempts
        and (time.monotonic() - started_at) < settings.max_runtime_seconds
        and not cancel_event.is_set()
    ):
        attempts += 1

        # One candidate through the agent chain: discovery -> verification ->
        # research -> opportunity. The orchestrator owns retries, failure
        # classification and per-agent timing, so this loop only decides what to
        # do with a finished pipeline.
        ctx = AgentContext(
            run_id=run_id,
            org_id=org_id,
            data={
                "niche_filter": niche_filter,
                "org_context": org_context,
                "attempt": attempts - 1,
                "already_found": already_found,
            },
        )
        pipeline_result = await orchestrator.run(ctx)
        agent_records.extend(pipeline_result.records)

        candidate = ctx.get("candidate")
        if candidate and candidate.get("companyName"):
            already_found.append(candidate["companyName"])

        if not pipeline_result.completed:
            stopped, reason = pipeline_result.stopped_at, pipeline_result.stop_reason or ""

            # Discovery stopping means the niche is exhausted for this run —
            # a clean finish, not a failure.
            if stopped == "lead_discovery":
                logger.info("run %s: no more candidates after %d attempts", run_id, attempts)
                break

            # Verification rejecting a candidate is the common case and simply
            # means try the next one.
            if stopped == "lead_verification":
                rejected += 1
                await report_progress()
                continue

            # Anything else genuinely broke; record it rather than reporting a
            # clean "niche saturated" finish.
            search_failed = f"{stopped}: {reason}"
            logger.error("run %s: pipeline failed at %s: %s", run_id, stopped, reason)
            break

        verification = ctx.get("verification") or {}
        scores = ctx.get("scores") or {}
        intel = ctx.get("company_intelligence") or {}
        audit = ctx.get("website_audit") or {}
        buyer = ctx.get("buyer_intelligence") or {}
        opportunities = ctx.get("opportunities") or {}

        # Start the lead at the stage it has genuinely reached. Every lead
        # persisted here already passed the verification agent, and most also
        # completed research — starting them all at NEW_LEAD would misreport the
        # funnel and force them through transitions that already happened.
        initial_stage = "RESEARCH_COMPLETED" if intel else "VERIFIED"

        result = await api_client.create_lead(
            org_id,
            {
                **_map_candidate_fields(candidate),
                **_map_intelligence_fields(intel, audit, buyer, opportunities),
                **verification,
                **_map_score_fields(scores),
                **_map_agent_scores(intel, buyer, opportunities),
                "runId": run_id,
                "filterId": niche_filter.get("id"),
                "initialStage": initial_stage,
            },
        )

        # Attribute this candidate's whole agent trail to the lead it produced,
        # so the dashboard can show "which agents touched this lead" rather
        # than only an org-wide aggregate. A duplicate has no new lead id to
        # attach to, so its records stay attributable only at the org level.
        lead_id = result.get("leadId")
        if lead_id:
            for record in pipeline_result.records:
                record.lead_id = lead_id

        # Track the priority mix. The spec requires 40/40/20 high/medium/
        # experimental so the funnel keeps an exploration budget: chasing only
        # high-priority leads narrows targeting until the niche is exhausted and
        # nothing new is ever learned about what converts.
        band = (scores.get("priority") or "MEDIUM").upper()
        band = band if band in priority_counts else "MEDIUM"

        if result.get("status") == "duplicate":
            duplicates += 1
        else:
            priority_counts[band] += 1
            verified += 1

        await report_progress()

    # Flushed once at the end rather than per candidate: the records are only
    # read by dashboards, so batching them costs nothing and saves one HTTP
    # round trip per agent per candidate.
    await api_client.record_agent_runs(
        org_id,
        run_id,
        [
            {
                "agent": r.agent,
                "status": r.status,
                "durationMs": r.duration_ms,
                "attempts": r.attempts,
                "error": r.error,
                "notes": r.notes,
                "leadId": r.lead_id,
            }
            for r in agent_records
        ],
    )

    if search_failed:
        status = "FAILED"
    elif cancel_event.is_set():
        status = "CANCELLED"
    elif verified >= daily_target:
        status = "COMPLETED"
    else:
        status = "COMPLETED_SHORT_OF_TARGET"

    await api_client.update_extraction_run(
        run_id,
        {
            "leadsFound": attempts,
            "leadsVerified": verified,
            "duplicatesSkipped": duplicates,
            "status": status,
            "priorityMix": priority_counts,
            "finishedAt": _now_iso(),
            **({"error": search_failed} if search_failed else {}),
        },
    )
    logger.info(
        "run %s finished: %s (%d/%d verified, %d duplicates, %d rejected, %d attempts) "
        "priority mix high=%d/%d medium=%d/%d experimental=%d/%d",
        run_id, status, verified, daily_target, duplicates, rejected, attempts,
        priority_counts["HIGH"], priority_targets["HIGH"],
        priority_counts["MEDIUM"], priority_targets["MEDIUM"],
        priority_counts["LOW"], priority_targets["LOW"],
    )


def _join(values) -> str | None:
    """Model output is a list here and a string there depending on the prompt;
    normalise to the single text column the lead stores."""
    if not values:
        return None
    if isinstance(values, str):
        return values
    return "; ".join(str(v) for v in values if v)


def _map_intelligence_fields(intel: dict, audit: dict, buyer: dict, opps: dict) -> dict:
    """Agent outputs onto lead columns.

    Empty values are stripped rather than written, so a degraded agent leaves
    the existing field alone instead of overwriting good data with null.
    """
    mapped = {
        "businessDescription": intel.get("executiveSummary"),
        "currentCrm": intel.get("crm"),
        "techStack": intel.get("techStack") or [],
        "growthSignals": intel.get("growthIndicators") or [],
        "swotAnalysis": intel.get("swot") or {},
        "competitors": intel.get("competitors") or [],
        "recentNews": intel.get("recentNews") or [],

        "websitePlatform": audit.get("platform"),
        "uxIssues": _join(audit.get("uxIssues")),
        "seoIssues": _join(audit.get("seoIssues")),

        "buyerPersona": buyer.get("buyerPersona"),

        "painPoints": opps.get("painPoints") or _join(opps.get("manualWorkflows")),
        "aiOpportunities": _join(
            [o.get("opportunity") for o in (opps.get("topAiOpportunities") or []) if isinstance(o, dict)]
        ),
        "automationOpportunities": _join(opps.get("automationOpportunities")),
    }
    return {k: v for k, v in mapped.items() if v not in (None, [], "", {})}


def _map_candidate_fields(candidate: dict) -> dict:
    return {
        "companyName": candidate["companyName"],
        # The only automated discovery method today is a public web search —
        # see LeadSourceLayer's doc comment (packages/types) for why there is
        # no "dark web" value to set here.
        "sourceLayer": "SURFACE_WEB",
        "website": candidate.get("website"),
        "linkedinUrl": candidate.get("linkedinUrl"),
        "contactName": candidate.get("contactName"),
        "jobTitle": candidate.get("jobTitle"),
        "email": candidate.get("email"),
        "personalEmail": candidate.get("personalEmail"),
        "phone": candidate.get("phone"),
        "industry": candidate.get("industry"),
        "subNiche": candidate.get("subIndustry"),
        "country": candidate.get("country"),
        "city": candidate.get("city"),
        "employeeCount": candidate.get("employeeCount"),
        "businessDescription": candidate.get("businessDescription"),
        # The contact's own profile, kept separate from the company page above.
        "contactLinkedinUrl": candidate.get("contactLinkedinUrl"),
        "estimatedRevenue": candidate.get("estimatedRevenue"),
        "currentCrm": candidate.get("currentCrm"),
        "websitePlatform": candidate.get("websitePlatform"),
        "automationTools": candidate.get("automationTools") or [],
        "aiUsage": candidate.get("aiUsage"),
        "techStack": candidate.get("techStack") or [],
        "growthSignals": candidate.get("growthSignals") or [],
        # What the finder actually observed, so a reviewer can audit the claim
        # rather than taking the score on trust.
        "researchEvidence": candidate.get("evidence"),
    }


def _map_score_fields(scores: dict) -> dict:
    return {
        "leadScore": scores.get("lead_score"),
        "confidenceScore": scores.get("confidence_score"),
        "aiOpportunityScore": scores.get("ai_opportunity_score"),
        "automationScore": scores.get("automation_score"),
        "crmReadinessScore": scores.get("crm_readiness_score"),
        "websiteQualityScore": scores.get("website_quality_score"),
        "businessFitScore": scores.get("business_fit_score"),
        "buyingIntentScore": scores.get("buying_intent_score"),
        "budgetScore": scores.get("budget_score"),
        "technologyGapScore": scores.get("technology_gap_score"),
        "decisionMakerAccessScore": scores.get("decision_maker_access_score"),
        "leadPriorityScore": scores.get("lead_priority_score"),
        "fitReason": scores.get("fit_reason"),
        "suggestedServices": scores.get("suggested_services"),
        "expectedValue": scores.get("expected_value"),
        "priority": scores.get("priority"),
        # Business intelligence produced during scoring. Lands on the lead so a
        # reviewer edits it rather than authoring it from scratch.
        "painPoints": scores.get("pain_points"),
        "aiOpportunities": scores.get("ai_opportunities"),
        "automationOpportunities": scores.get("automation_opportunities"),
    }


def _map_agent_scores(intel: dict, buyer: dict, opps: dict) -> dict:
    """Scores produced by the intelligence agents rather than the scorer."""
    mapped = {
        "digitalMaturityScore": intel.get("digitalMaturityScore"),
        "aiReadinessScore": intel.get("aiReadinessScore"),
        "automationOpportunityScore": intel.get("automationOpportunityScore"),
        "authorityScore": buyer.get("authorityScore"),
        "engagementScore": buyer.get("engagementScore"),
        "projectComplexity": opps.get("projectComplexity"),
    }
    return {k: v for k, v in mapped.items() if v is not None}


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def run_in_background(run_id: str, niche_filter: dict, org_context: dict | None = None) -> None:
    try:
        await run_extraction(run_id, niche_filter, org_context)
    except Exception:
        logger.exception("run %s failed", run_id)
        await api_client.update_extraction_run(run_id, {"status": "FAILED", "finishedAt": _now_iso()})
    finally:
        # Registered at the top of run_extraction; cleared here (its one
        # exit point, success or failure) rather than at the bottom of that
        # function, so an exception raised mid-run can't leak the entry.
        _cancel_events.pop(run_id, None)


def _lead_to_candidate(lead: dict) -> dict:
    """Reshapes a persisted Lead back into the `candidate` shape the
    lead/intelligence agents expect — the mirror image of
    _map_candidate_fields above, which goes the other way for a
    freshly-discovered one."""
    return {
        "companyName": lead.get("companyName"),
        "website": lead.get("website"),
        "linkedinUrl": lead.get("linkedinUrl"),
        "contactName": lead.get("contactName"),
        "jobTitle": lead.get("jobTitle"),
        "email": lead.get("email"),
        "personalEmail": lead.get("personalEmail"),
        "phone": lead.get("phone"),
        "industry": lead.get("industry"),
        "subIndustry": lead.get("subNiche"),
        "country": lead.get("country"),
        "city": lead.get("city"),
        "employeeCount": lead.get("employeeCount"),
        "businessDescription": lead.get("businessDescription"),
        "contactLinkedinUrl": lead.get("contactLinkedinUrl"),
        "estimatedRevenue": lead.get("estimatedRevenue"),
        "currentCrm": lead.get("currentCrm"),
        "websitePlatform": lead.get("websitePlatform"),
        "automationTools": lead.get("automationTools") or [],
        "aiUsage": lead.get("aiUsage"),
        "techStack": lead.get("techStack") or [],
        "growthSignals": lead.get("growthSignals") or [],
        "evidence": lead.get("researchEvidence"),
    }


async def run_manual_enrichment(lead_id: str, org_id: str, org_context: dict | None = None) -> None:
    """Runs the research/verification/scoring pipeline against a lead a human
    typed in by hand.

    CreateManualLeadDto's own doc comment always intended this ("Enrichment
    and scoring happen afterwards by running the agents against it") but
    nothing ever triggered it until this function existed. Unlike
    run_extraction, the Lead row already exists, so this PATCHes the result
    onto it (see api_client.apply_enrichment) instead of POSTing a new lead,
    and verification runs in its non-rejecting form — see
    "lead_verification_soft" in the registry.
    """
    org_context = dict(org_context or {})
    org_context["promptOverrides"] = await api_client.get_prompt_overrides(org_id)
    lead = await api_client.get_lead_detail(lead_id, org_id)
    candidate = _lead_to_candidate(lead)

    async def announce_start(agent) -> None:
        # Fired right before each agent runs, so the lead's page shows "X is
        # working on this now" instead of agents only appearing once done.
        await api_client.record_agent_started(org_id, lead_id, agent.name, agent.responsibility)

    async def stream(record) -> None:
        # Sent the moment each of the six steps finishes rather than batched
        # at the end — this pipeline runs several Claude CLI calls back to
        # back and can take minutes, and without this the lead's agent
        # timeline showed nothing at all until the whole thing was done.
        record.lead_id = lead_id
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
                    "leadId": record.lead_id,
                }
            ],
        )

    orchestrator = build("manual_lead_enrichment", seed_keys=("candidate", "org_context"))
    ctx = AgentContext(
        run_id=f"manual-enrich-{lead_id}",
        org_id=org_id,
        data={"candidate": candidate, "org_context": org_context},
    )
    await orchestrator.run(ctx, on_step=stream, on_start=announce_start)

    verification = ctx.get("verification") or {}
    scores = ctx.get("scores") or {}
    intel = ctx.get("company_intelligence") or {}
    audit = ctx.get("website_audit") or {}
    buyer = ctx.get("buyer_intelligence") or {}
    opportunities = ctx.get("opportunities") or {}
    agent_review = ctx.get("agent_review") or {}

    patch = {
        **_map_intelligence_fields(intel, audit, buyer, opportunities),
        **verification,
        **_map_score_fields(scores),
        **_map_agent_scores(intel, buyer, opportunities),
    }
    # Unlike _map_candidate_fields feeding a brand-new lead, this PATCHes one
    # that already has real values — a None here must leave the existing
    # column alone rather than null it out. _map_intelligence_fields already
    # filters its own Nones; the other two mapping functions don't (they were
    # only ever used to build a CREATE payload before), so filter the merged
    # result instead of duplicating that logic in each of them.
    patch = {k: v for k, v in patch.items() if v is not None}
    if agent_review:
        patch["agentReview"] = agent_review

    try:
        await api_client.apply_enrichment(lead_id, org_id, patch)
    except Exception:
        logger.exception("failed to apply enrichment results for lead %s", lead_id)


async def run_manual_enrichment_in_background(
    lead_id: str, org_id: str, org_context: dict | None = None
) -> None:
    try:
        await run_manual_enrichment(lead_id, org_id, org_context)
    except Exception:
        logger.exception("manual enrichment for lead %s failed", lead_id)
