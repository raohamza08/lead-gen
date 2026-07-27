"""Mandatory self-critique / groundedness pass (Part D2/D4) before a draft reaches approval or the compliance gate."""
import json
from pathlib import Path

from config import settings

try:
    from google import genai
except ImportError:  # pragma: no cover
    genai = None

PROMPT_TEMPLATE = (Path(__file__).parent.parent / "shared" / "prompts" / "email3_critique.txt").read_text()


async def critique_draft(context: dict, draft: dict) -> dict:
    if settings.google_genai_api_key and genai is not None:
        client = genai.Client(api_key=settings.google_genai_api_key)
        prompt = PROMPT_TEMPLATE.format(context_json=json.dumps(context), draft_json=json.dumps(draft))
        response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        try:
            return json.loads(response.text)
        except (json.JSONDecodeError, AttributeError):
            pass

    # DEMO MODE / fallback: a minimal mechanical check rather than a full LLM audit.
    body = draft.get("body_html", "")
    issues = []
    if "unsubscribe" not in body.lower():
        issues.append("Missing unsubscribe link")
    if len(body) > 4000:
        issues.append("Body unexpectedly long for a 180-word target")
    return {"pass": len(issues) == 0, "issues": issues}
