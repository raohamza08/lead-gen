"""Lead scoring against the explicit rubric in Part D3/D4 — never a black-box number."""
import logging
from pathlib import Path

from . import cli_client

logger = logging.getLogger("claude_agent.scorer")

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "shared" / "prompts" / "lead_scoring.txt").read_text()


async def score_candidate(candidate: dict, org_context: dict) -> dict:
    try:
        return await _score_via_cli(candidate, org_context)
    except cli_client.ClaudeCliUnavailable as err:
        logger.warning("Claude CLI unavailable (%s) — falling back to heuristic scoring", err)
        return _score_heuristic(candidate)


async def _score_via_cli(candidate: dict, org_context: dict) -> dict:
    import json

    prompt = PROMPT_TEMPLATE.format(
        org_name=org_context.get("name", "our company"),
        org_services=org_context.get("services", "AI automation services"),
        icp_definition=org_context.get("icp_definition", "growing SMB/mid-market companies"),
        candidate_json=json.dumps(candidate),
        site_text_excerpt=candidate.get("businessDescription", ""),
    )
    envelope = await cli_client.query(prompt)
    data = cli_client.extract_json(envelope.get("result", ""))
    if data is None:
        return _score_heuristic(candidate)
    return data


def _score_heuristic(candidate: dict) -> dict:
    """Fallback used only when the Claude CLI is unavailable — deterministic and explainable, not a substitute for the real rubric."""
    description = (candidate.get("businessDescription") or "").lower()
    manual_signals = sum(term in description for term in ["spreadsheet", "manual", "email", "no crm"])
    employee_count = candidate.get("employeeCount") or 0

    lead_score = min(100, 40 + manual_signals * 15 + (10 if 20 <= employee_count <= 200 else 0))
    ai_opportunity = min(100, 30 + manual_signals * 20)

    return {
        "lead_score": lead_score,
        "confidence_score": 55,
        "ai_opportunity_score": ai_opportunity,
        "automation_score": min(100, manual_signals * 25),
        "crm_readiness_score": 20 if "no crm" in description else 50,
        "website_quality_score": 50,
        "fit_reason": f"[HEURISTIC FALLBACK] {manual_signals} manual-workflow signal(s) found in business description.",
        "suggested_services": "Workflow automation assessment; AI-assisted lead follow-up",
        "expected_value": 4000 + manual_signals * 1500,
        "priority": "HIGH" if lead_score >= 70 else "MEDIUM" if lead_score >= 50 else "LOW",
    }
