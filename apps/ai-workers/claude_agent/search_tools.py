"""
Candidate discovery (Part B3/C1). Claude proposes candidates; it never gets to
mark them "verified" itself — that's always a deterministic check in
verifier.py, so "Verified Email" is a defensible claim rather than an LLM guess.

Lead-finding shells out to the local Claude Code CLI (cli_client.py), which
authenticates via the user's existing paid Claude Code subscription rather
than a metered ANTHROPIC_API_KEY. Falls back to clearly-labeled synthetic demo
candidates if the CLI is unavailable or errors, so the rest of the pipeline
(dedup -> verify -> score -> insert) stays exercisable without it.
"""
import json
import logging
import random
from typing import Optional

from config import settings
from shared.prompts import load_prompt

from . import cli_client

logger = logging.getLogger("claude_agent.search_tools")

_DEMO_COMPANIES = [
    ("Northwind Ops", "northwindops.example.com"),
    ("Beacon Analytics", "beaconanalytics.example.com"),
    ("Lucent Field Services", "lucentfield.example.com"),
    ("Harbor Recruiting Group", "harborrecruiting.example.com"),
    ("Ferrow Manufacturing", "ferrowmfg.example.com"),
]


async def find_candidate(
    niche_filter: dict,
    attempt: int,
    already_found: Optional[list[str]] = None,
    org_context: Optional[dict] = None,
) -> Optional[dict]:
    try:
        return await _find_candidate_via_cli(niche_filter, already_found or [], org_context)
    except cli_client.ClaudeCliUnavailable as err:
        if not settings.allow_demo_fallback:
            # Deliberately re-raised rather than degraded. Demo candidates are
            # synthetic companies at `.example.com`; inserted into a real leads
            # table they are indistinguishable from genuine ones and violate the
            # "only verified leads" requirement. The caller aborts the run and
            # reports the failure instead of quietly filling the table with
            # fake companies.
            logger.error("Claude CLI unavailable on attempt %d and demo fallback is disabled: %s", attempt, err)
            raise
        logger.warning("Claude CLI unavailable (%s) — falling back to demo candidate for attempt %d", err, attempt)
        return _find_candidate_demo(niche_filter, attempt)


def _criteria_text(niche_filter: dict) -> str:
    """The API renders the filter into an explained brief using the shared
    taxonomy in packages/types. Fall back to the raw dict only when it's absent,
    so a direct API call or an older caller still yields a usable prompt."""
    brief = niche_filter.get("searchBrief")
    if brief and brief.strip():
        return brief
    trimmed = {
        k: v
        for k, v in niche_filter.items()
        if k not in ("searchBrief", "orgId", "id", "clickupListId") and v not in (None, [], "")
    }
    return json.dumps(trimmed, indent=2)


async def _find_candidate_via_cli(
    niche_filter: dict, already_found: list[str], org_context: Optional[dict] = None,
) -> Optional[dict]:
    exclusion = (
        f"\n\nAlready found in this run — do NOT return any of these again: {', '.join(already_found)}"
        if already_found
        else ""
    )
    prompt = (
        f"{load_prompt('lead_discovery', org_context)}\n\n"
        f"TARGETING CRITERIA\n{_criteria_text(niche_filter)}{exclusion}\n"
    )
    envelope = await cli_client.query(prompt)
    data = cli_client.extract_json(envelope.get("result", ""))
    if not data or data.get("no_match"):
        return None
    return data


def _find_candidate_demo(niche_filter: dict, attempt: int) -> Optional[dict]:
    if attempt >= len(_DEMO_COMPANIES):
        return None  # demo pool exhausted -> models the "niche saturated" shortfall path
    name, domain = _DEMO_COMPANIES[attempt]
    return {
        "companyName": name,
        "website": f"https://{domain}",
        "linkedinUrl": f"https://linkedin.com/company/{domain.split('.')[0]}",
        "contactName": "Jordan Blake",
        "jobTitle": "Operations Director",
        "email": f"jordan.blake@{domain}",
        "industry": niche_filter.get("niche", "General"),
        "country": (niche_filter.get("countries") or ["United States"])[0],
        "city": None,
        "employeeCount": random.randint(15, 180),
        "businessDescription": f"[DEMO DATA] A {niche_filter.get('niche', 'business')} company managing most "
        f"operations through spreadsheets and email rather than a shared system.",
    }
