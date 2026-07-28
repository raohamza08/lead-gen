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
from .cli_client import ClaudeCliUnavailable
from .search_tools import find_candidate
from .verifier import verify_candidate
from .scorer import score_candidate

logger = logging.getLogger("claude_agent.runner")


async def run_extraction(run_id: str, niche_filter: dict, org_context: dict | None = None) -> None:
    org_id = niche_filter["orgId"]
    daily_target = niche_filter.get("dailyTarget", 100)
    org_context = org_context or {}

    verified = 0
    duplicates = 0
    attempts = 0
    started_at = time.monotonic()
    already_found: list[str] = []
    search_failed: str | None = None

    while (
        verified < daily_target
        and attempts < settings.max_search_attempts
        and (time.monotonic() - started_at) < settings.max_runtime_seconds
    ):
        attempts += 1
        try:
            candidate = await find_candidate(niche_filter, attempts - 1, already_found)
        except ClaudeCliUnavailable as err:
            # The lead-finder is genuinely unavailable (already retried with
            # backoff inside cli_client). Stop here and report it: leads found
            # before the failure are real and stay, but the run must not be
            # reported as a clean "niche saturated" finish, which is what a
            # silent break would look like.
            search_failed = str(err)
            logger.error("run %s: lead search unavailable after %d attempts: %s", run_id, attempts, err)
            break
        if candidate is None:
            logger.info("run %s: no more candidates found after %d attempts", run_id, attempts)
            break
        if candidate.get("companyName"):
            already_found.append(candidate["companyName"])

        verification = await verify_candidate(candidate)
        if not verification["qualifies"]:
            continue  # rejected — Part C3: never persisted, only counted in metrics

        scores = await score_candidate(candidate, org_context)
        result = await api_client.create_lead(
            org_id,
            {
                **_map_candidate_fields(candidate),
                **verification,
                **_map_score_fields(scores),
                "runId": run_id,
                "filterId": niche_filter.get("id"),
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
