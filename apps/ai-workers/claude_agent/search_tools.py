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
    niche_filter: dict, attempt: int, already_found: Optional[list[str]] = None
) -> Optional[dict]:
    try:
        return await _find_candidate_via_cli(niche_filter, already_found or [])
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


async def _find_candidate_via_cli(niche_filter: dict, already_found: list[str]) -> Optional[dict]:
    exclusion = (
        f"\n\nAlready found in this run — do NOT return any of these again: {', '.join(already_found)}"
        if already_found
        else ""
    )
    prompt = f"""You are an expert B2B Lead Generation Specialist, Sales Navigator
strategist and AI sales-intelligence agent. Behave like a senior SDR who
understands buyer intent, growth signals and technology adoption.

Your goal is NOT to collect random companies. Find ONE company that has a real
business problem, budget capacity, growth potential, a need for automation or
technology improvement, and an accessible decision maker.

{_criteria_text(niche_filter)}{exclusion}

SEARCH STRATEGY
Combine dimensions the way Sales Navigator does — industry + location + size +
decision maker + growth signal + technology gap — rather than searching on one
axis. Work from buying-intent signals first: a company matching the industry and
headcount but showing no intent signal is a weak lead, while one showing several
intent signals is strong even if the firmographics fit imperfectly.

Use web search to find candidates, then FETCH the company's own website to
verify what you claim about it. Check for job postings, funding news, a recent
redesign or a technology migration — these establish that they are ready to act
now, not merely that they could benefit eventually.

VERIFY BEFORE RETURNING
1. The company exists and is currently operating.
2. The decision maker is genuinely relevant and has buying authority.
3. Any contact detail you report was actually found, not constructed.
4. There is a concrete business opportunity for automation or software work.
5. You can explain why this company is worth contacting.

CONTACT EMAILS
Report two distinct kinds of email if you can find them, and keep them apart:
- `email`: their work/company address (site domain, staff page, press
  contact, verified LinkedIn "Contact info").
- `personalEmail`: an address of theirs NOT on the company domain — found on
  a personal site/portfolio, a GitHub/Stack Overflow profile, a conference
  speaker bio, or their own LinkedIn "Contact info" if it lists one. Leave it
  null far more often than `email` — most people never surface one publicly,
  and that is the expected, normal result, not a gap to fill by guessing.

HARD RULES
- Never invent a company, a person, or an email address — for either `email`
  or `personalEmail`. A guessed address bounces, and bounces damage the
  sending reputation of every mailbox in the system — null is always the
  correct answer when unsure.
- Apply every EXCLUDE rule as a hard reject, however well the company scores.
- Reject freelancers, sole traders, and companies with no real digital presence
  or no budget capacity.
- Prefer a decision maker with authority (Founder, CEO, COO, CTO, VP, Director,
  Managing Director). Never return an intern, assistant or junior employee.
- `evidence` must cite what you actually observed — what the site showed, what a
  job posting said, where a figure came from. A human reviewer uses it to judge
  the lead, so vague evidence makes the lead unusable.
- Only return a lead a professional B2B sales team would consider worth
  contacting. If nothing qualifies, say so rather than lowering the bar.

Respond with ONLY a JSON object — no prose, no markdown code fences:
{{
  "companyName": string, "website": string, "linkedinUrl": string|null,
  "industry": string, "subIndustry": string|null,
  "country": string|null, "city": string|null,
  "employeeCount": number|null, "estimatedRevenue": string|null,
  "businessDescription": string,

  "contactName": string|null, "jobTitle": string|null,
  "contactLinkedinUrl": string|null, "email": string|null,
  "personalEmail": string|null, "phone": string|null,

  "techStack": string[], "currentCrm": string|null,
  "websitePlatform": string|null, "automationTools": string[], "aiUsage": string|null,

  "growthSignals": string[],
  "matchedSignals": string[],
  "evidence": string
}}
If you cannot find a company that genuinely qualifies, respond with {{"no_match": true}}.
"""
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
