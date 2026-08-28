"""
Deterministic checks for the 5-email sequence's mandatory voice/structure
rules (Part: 5-email sequence, 2026-08-12). Checked in Python rather than
trusted to the model's own compliance — a rule the prompt asked for and a
rule that's actually true in the output are not the same thing, and this is
what stands between a jargon-laden or fabricated draft and a real inbox.
"""
import re

_BANNED_PHRASES = [
    "digital transformation", "leverage", "streamline your operations",
    "streamline operations", "synerg", "game changer", "game-changer",
    "cutting edge", "cutting-edge", "revolutioniz", "unlock the power",
    "best-in-class", "world-class", "paradigm shift", "circle back",
    "touch base", "low-hanging fruit", "move the needle", "value-add",
    "core competenc", "disrupt", "innovative solution", "take it to the next level",
]

_URGENCY_PHRASES = [
    "limited time", "don't miss out", "do not miss out", "act now", "hurry",
    "last chance", "expires soon", "while supplies last", "act fast",
]

_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002190-\U000021FF\U00002B00-\U00002BFF]"
)
#: A capitalised bracket note like "[INSERT REAL, VERIFIED RESULT]" — the only
#: acceptable way to reference an unverified figure. Detecting it is what lets
#: the caller force human approval instead of ever auto-sending it verbatim.
PLACEHOLDER_RE = re.compile(r"\[[A-Z][A-Z0-9 ,.'/_-]{2,80}\]")
_TAG_RE = re.compile(r"<[^>]+>")


def visible_text(html: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()


def word_count(text_or_html: str) -> int:
    text = visible_text(text_or_html)
    return len(text.split()) if text else 0


def has_placeholder(*texts: str) -> bool:
    return any(PLACEHOLDER_RE.search(t) for t in texts if t)


def lint_draft(step: int, subject: str, body_html: str, org_names: list[str]) -> list[str]:
    """Returns violations against the mandatory rules — empty means it
    passes. The caller (EmailAgent) retries once on a non-empty result, and
    if it still fails, submits anyway but flags it for human review rather
    than silently sending something that broke a rule."""
    issues: list[str] = []
    body_text = visible_text(body_html)
    words = body_text.split()

    if len(words) > 150:
        issues.append(f"body is {len(words)} words, over the 150-word limit")

    subject_words = subject.split()
    if len(subject_words) > 6:
        issues.append(f"subject is {len(subject_words)} words, over the 6-word limit")

    haystack = f"{subject} {body_text}"
    if "!" in haystack:
        issues.append("contains an exclamation point")
    if _EMOJI_RE.search(haystack):
        issues.append("contains an emoji")

    lowered = haystack.lower()
    for phrase in _BANNED_PHRASES:
        if phrase in lowered:
            issues.append(f"uses banned jargon phrase: '{phrase}'")
    for phrase in _URGENCY_PHRASES:
        if phrase in lowered:
            issues.append(f"uses urgency language: '{phrase}'")

    if step < 3:
        for name in org_names:
            stripped = name.strip() if name else ""
            if stripped and stripped.lower() in body_text.lower():
                issues.append(f"names the company ('{stripped}') before Email 3 — it may only appear in the signature")

    return issues
