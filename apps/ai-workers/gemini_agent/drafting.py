"""
Drafts one email of the 5-email sequence (Part: 5-email sequence, 2026-08-12).

Runs on the Claude CLI — the same engine the rest of the app already depends
on for discovery, research and scoring — not the Google Gemini API. The old
Gemini integration required GOOGLE_GENAI_API_KEY, which this deployment never
had configured, so every real draft silently fell back to a hardcoded
"[DEMO DRAFT]" template. Moving to the CLI removes that failure mode
entirely: it needs no separate key, just the same subscription already
proven working everywhere else in this app.

The model is asked for the email's STRUCTURAL PARTS (hook / insight /
evidence / reframe / cta) rather than one free-form body_html blob, and this
module assembles the final HTML itself. That's deliberate: it guarantees
exactly one CTA by construction (one field, not "please write only one"),
guarantees `evidence` can never leak into an Email 1/2 body even if the model
slips, and makes the word-count/lint checks apply to exactly what gets sent.
"""
import json
import logging

from claude_agent import cli_client
from shared.prompts import load_prompt

from .lint import has_placeholder, lint_draft

logger = logging.getLogger("gemini_agent.drafting")

STEP_NAMES = {1: "Problem Trigger", 2: "Industry Insight", 3: "Proof", 4: "Soft Offer", 5: "Breakup"}

# Editable in Settings as email_step_1..5 and email_voice_rules. NOTE: the
# word-count, banned-phrase and single-CTA rules stated in email_voice_rules
# are also enforced separately and deterministically by lint.py — editing the
# wording here changes what the model is told, not what draft_and_validate
# below actually accepts, so a loosened voice-rules override still gets
# retried/flagged for review the same as today if it violates lint.py.


async def draft_email(context: dict, org_context: dict, step: int) -> dict:
    org_name = org_context.get("name", "our company")
    org_services = org_context.get("services", "AI automation and lead-generation systems")
    tone = org_context.get("tone_of_voice", "direct, warm, no jargon")

    case_study = context.get("case_study")
    if step == 3:
        if case_study:
            case_study_instruction = (
                f"A real case study is available — you may reference it directly: "
                f"{case_study.get('title')}: {case_study.get('summary')}. If you need a specific "
                f"number this case study doesn't give you, use a bracketed placeholder like "
                f"[INSERT REAL, VERIFIED RESULT] instead of inventing or estimating one."
            )
        else:
            case_study_instruction = (
                "No verified case study is available yet. Do not invent one, a client name, or a "
                "number. Write the evidence as an observational pattern instead — something you've "
                "noticed happen for businesses like theirs — without claiming a specific result."
            )
    else:
        case_study_instruction = ""

    brief = load_prompt(f"email_step_{step}", org_context)
    voice_rules = load_prompt("email_voice_rules", org_context)

    prompt = f"""You are writing email {step} of 5 in a cold outbound sequence for {org_name}
({org_services}). This email's role in the sequence is "{STEP_NAMES[step]}".

FULL SEQUENCE, for context only — you are writing just this one:
1. Problem Trigger — one felt industry pain point, company never named.
2. Industry Insight — a real AI/automation shift in their industry, no pitch.
3. Proof — first email allowed to name {org_name}, with a real or observational result, never invented.
4. Soft Offer — first ask, low-friction only (audit / framework / question / call), no services pitch.
5. Breakup — short, no guilt, closes the door gently.

THIS EMAIL'S JOB:
{brief}
{f"CASE STUDY CONTEXT: {case_study_instruction}" if case_study_instruction else ""}

STRUCTURE (mandatory): hook -> specific/felt insight{" -> evidence" if step >= 3 else ""} -> perspective/reframe -> ONE clear CTA.

RECIPIENT:
Company: {context.get('company_name')} ({context.get('industry')}, {context.get('employee_count')} employees, {context.get('country')})
Tech stack: {json.dumps(context.get('tech_stack'))}
What we know: {json.dumps(context.get('reviewer_notes'))}
Website excerpt: {context.get('website_excerpt', '')[:1200]}

{voice_rules}

Tone: {tone}.

Respond with ONLY JSON, no prose or code fences:
{{
  "subject": string,
  "hook": string,
  "insight": string,
  "evidence": string|null,
  "reframe": string,
  "cta": string,
  "flags": string[]
}}"""

    envelope = await cli_client.query(prompt)
    data = cli_client.extract_json(envelope.get("result", "")) or {}
    if not data or not data.get("subject"):
        return {}

    # Evidence is structurally impossible before step 3, even if the model
    # slipped and returned one — dropped here rather than trusted.
    evidence = data.get("evidence") if step >= 3 else None

    parts = [data.get("hook"), data.get("insight"), evidence, data.get("reframe"), data.get("cta")]
    body_html = "\n".join(f"<p>{p}</p>" for p in parts if p)

    return {
        "subject": data.get("subject", ""),
        "body_html": body_html,
        "flags": data.get("flags") or [],
        "rationale": {
            "hook": data.get("hook"),
            "insight": data.get("insight"),
            "evidence": evidence,
            "reframe": data.get("reframe"),
            "cta": data.get("cta"),
        },
    }


def append_signature(body_html: str) -> str:
    """The only place {org.name} can appear for Email 1/2, per the "company
    only in the signature" rule — resolved at send time by
    email-provider.service.ts, same as {{sender.name}}/{{unsubscribe_link}}.
    The " · " separator is NOT hardcoded here — {{org.postal_address}}'s
    substitution supplies its own trailing separator only when there's a
    real address to show, so an org that hasn't set one gets a clean
    "Unsubscribe" line instead of a dangling "· Unsubscribe". The link
    itself is styled to match the surrounding gray fine print (no default
    blue/underline) so it reads as ordinary small print, not a marketing
    footer CTA — still a real, functioning unsubscribe link, just visually
    subdued rather than prominent."""
    signature = (
        '<p>{{sender.name}}<br>{{org.name}}</p>'
        '<p style="font-size:11px;color:#999">{{org.postal_address}}'
        '<a href="{{unsubscribe_link}}" style="color:#999;text-decoration:none">Unsubscribe</a></p>'
    )
    return f"{body_html}\n{signature}"


async def draft_and_validate(context: dict, org_context: dict, step: int) -> tuple[dict, list[str], bool]:
    """Drafts, lints, and retries once on failure — mirrors the single-retry
    pattern already used elsewhere in this codebase (e.g. LeadVerification).
    Returns (draft, notes, needs_review). needs_review is True if the draft
    still breaks a rule after the retry, or contains an unresolved bracket
    placeholder — either way the caller must route it to human approval
    rather than auto-send, regardless of the org's autoSendEnabled setting."""
    org_names = [org_context.get("name"), "EurosHub"]

    draft = await draft_email(context, org_context, step)
    if not draft:
        return {}, ["drafting produced no output"], True

    issues = lint_draft(step, draft["subject"], draft["body_html"], org_names)
    notes: list[str] = []
    if issues:
        notes.append(f"failed voice/structure check ({'; '.join(issues)}) — retried once")
        retry = await draft_email(context, org_context, step)
        if retry:
            draft = retry
            issues = lint_draft(step, draft["subject"], draft["body_html"], org_names)
        if issues:
            notes.append(f"still failing after retry ({'; '.join(issues)}) — needs human review before sending")

    # A literal [BRACKET PLACEHOLDER] left in the text is the one case worth
    # hard-blocking on: it means an unresolved fact would otherwise land in a
    # prospect's inbox verbatim. The model's own `flags` field is much
    # softer — it can fire on a general, unattributed industry observation
    # that never claims anything false (confirmed 2026-08-13: a flagged
    # Email 2 draft read as ordinary market commentary, nothing fabricated).
    # Treating any non-empty `flags` as a hard block was routing genuinely
    # fine drafts to approval far more than intended, so only the concrete
    # placeholder check gates auto-send now — `flags` still rides along in
    # the rationale for a human to see, it just isn't load-bearing alone.
    placeholder = has_placeholder(draft["subject"], draft["body_html"])
    if placeholder:
        notes.append("contains an unresolved [placeholder] flagged for human review before sending")
    elif draft.get("flags"):
        notes.append(f"model noted: {'; '.join(draft['flags'])}")

    needs_review = bool(issues) or placeholder
    return draft, notes, needs_review
