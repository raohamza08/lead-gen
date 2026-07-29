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
from agents import AgentContext
from agents import build as build_pipeline

logger = logging.getLogger("claude_agent.runner")


async def run_extraction(run_id: str, niche_filter: dict, org_context: dict | None = None) -> None:
    org_id = niche_filter["orgId"]
    daily_target = niche_filter.get("dailyTarget", 100)
    org_context = org_context or {}

    verified = 0
    duplicates = 0
    rejected = 0
    attempts = 0
    started_at = time.monotonic()
    already_found: list[str] = []
    search_failed: str | None = None
    agent_records: list = []

    # Built once per run, not per candidate: construction validates that every
    # agent's requirements are satisfied by something earlier in the chain, and
    # paying that check 40 times would be waste.
    orchestrator = build_pipeline(
        "lead_acquisition",
        seed_keys=("niche_filter", "org_context", "attempt", "already_found"),
    )

    while (
        verified < daily_target
        and attempts < settings.max_search_attempts
        and (time.monotonic() - started_at) < settings.max_runtime_seconds
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
                continue

            # Anything else genuinely broke; record it rather than reporting a
            # clean "niche saturated" finish.
            search_failed = f"{stopped}: {reason}"
            logger.error("run %s: pipeline failed at %s: %s", run_id, stopped, reason)
            break

        verification = ctx.get("verification") or {}
        scores = ctx.get("scores") or {}
        research = ctx.get("research") or {}

        # Start the lead at the stage it has genuinely reached. Every lead
        # persisted here already passed the verification agent, and most also
        # completed research — starting them all at NEW_LEAD would misreport the
        # funnel and force them through transitions that already happened.
        initial_stage = "RESEARCH_COMPLETED" if research else "VERIFIED"

        result = await api_client.create_lead(
            org_id,
            {
                **_map_candidate_fields(candidate),
                **_map_research_fields(research),
                **verification,
                **_map_score_fields(scores),
                "runId": run_id,
                "filterId": niche_filter.get("id"),
                "initialStage": initial_stage,
            },
        )

        if result.get("status") == "duplicate":
            duplicates += 1
        else:
            verified += 1

    if search_failed:
        status = "FAILED"
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
            "finishedAt": _now_iso(),
            **({"error": search_failed} if search_failed else {}),
        },
    )
    logger.info("run %s finished: %s (%d/%d verified, %d duplicates, %d attempts)",
                run_id, status, verified, daily_target, duplicates, attempts)


def _map_research_fields(research: dict) -> dict:
    """Research output onto lead columns. Only fills fields discovery left
    empty — discovery saw the company directly, research is inference on top."""
    if not research:
        return {}
    mapped = {
        "businessDescription": research.get("businessSummary"),
        "websitePlatform": research.get("websitePlatform"),
        "currentCrm": research.get("currentCrm"),
        "aiUsage": research.get("aiUsage"),
        "growthSignals": research.get("growthSignals") or [],
        "techStack": research.get("techStack") or [],
    }
    return {k: v for k, v in mapped.items() if v not in (None, [], "")}


def _map_candidate_fields(candidate: dict) -> dict:
    return {
        "companyName": candidate["companyName"],
        "website": candidate.get("website"),
        "linkedinUrl": candidate.get("linkedinUrl"),
        "contactName": candidate.get("contactName"),
        "jobTitle": candidate.get("jobTitle"),
        "email": candidate.get("email"),
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


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def run_in_background(run_id: str, niche_filter: dict, org_context: dict | None = None) -> None:
    try:
        await run_extraction(run_id, niche_filter, org_context)
    except Exception:
        logger.exception("run %s failed", run_id)
        await api_client.update_extraction_run(run_id, {"status": "FAILED", "finishedAt": _now_iso()})
