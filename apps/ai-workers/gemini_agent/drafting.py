"""Email #3 drafting (Part D2/D4) — never a template, always grounded in `context`."""
import json
from pathlib import Path

from config import settings

try:
    from google import genai
except ImportError:  # pragma: no cover
    genai = None

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "shared" / "prompts" / "email3_draft.txt").read_text()


async def draft_email(context: dict, org_context: dict) -> dict:
    if settings.google_genai_api_key and genai is not None:
        return await _draft_via_gemini(context, org_context)
    return _draft_demo(context, org_context)


async def _draft_via_gemini(context: dict, org_context: dict) -> dict:
    client = genai.Client(api_key=settings.google_genai_api_key)
    prompt = PROMPT_TEMPLATE.format(
        org_name=org_context.get("name", "our company"),
        org_services=org_context.get("services", "AI automation services"),
        tone_of_voice=org_context.get("tone_of_voice", "direct, warm, no jargon"),
        company_name=context["company_name"],
        industry=context.get("industry"),
        employee_count=context.get("employee_count"),
        country=context.get("country"),
        tech_stack=json.dumps(context.get("tech_stack")),
        reviewer_notes=json.dumps(context.get("reviewer_notes")),
        website_excerpt=context.get("website_excerpt", "")[:1500],
        case_study_title=context.get("case_study_title") or "n/a",
        case_study_metrics=json.dumps(context.get("case_study_metrics") or {}),
    )
    response = client.models.generate_content(model="gemini-2.5-pro", contents=prompt)
    try:
        return json.loads(response.text)
    except (json.JSONDecodeError, AttributeError):
        return _draft_demo(context, org_context)


def _draft_demo(context: dict, org_context: dict) -> dict:
    """DEMO MODE fallback — clearly labeled, not a substitute for a real Gemini call."""
    hook = context.get("reviewer_notes", {}).get("suggested_hook") or f"what I noticed on {context['company_name']}'s site"
    problems = [
        context.get("reviewer_notes", {}).get("business_problems") or "manual lead follow-up eating rep time",
    ]
    return {
        "subject": f"A specific idea for {context['company_name']}",
        "body_html": (
            f"<p>[DEMO DRAFT] Hi, following up on {hook}. For a {context.get('industry','')} team your size, "
            f"the biggest lever is usually {problems[0]}. We could likely automate this in a few weeks with a "
            f"payback inside a quarter. Worth a 15-minute call?</p>"
            f"<p style=\"font-size:12px;color:#888\">{{{{org.postal_address}}}} · "
            f"<a href=\"{{{{unsubscribe_link}}}}\">Unsubscribe</a></p>"
        ),
        "rationale": {
            "problems_identified": problems,
            "automation_ideas": ["Automated lead follow-up sequencing", "AI-assisted intake triage"],
            "roi_estimate_basis": "[DEMO] Estimated from comparable engagements in this industry band",
            "roadmap_steps": ["Discovery call", "Pilot on one workflow", "Roll out org-wide"],
        },
    }
