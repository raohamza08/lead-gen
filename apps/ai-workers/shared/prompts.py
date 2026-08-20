"""
Per-agent prompt text, editable from Settings (Part: agent prompts).

Every agent's *instructions* — the rules, tone, and output schema that stay
the same on every call — lives in its own `.txt` file under `shared/prompts/`
and is loaded through `load_prompt` below. The *dynamic* part of a prompt
(the specific candidate's data, a JSON dump of performance numbers, etc.) is
never in these files — it's assembled in Python exactly as before and
concatenated onto the loaded text at call time. That split is deliberate: it
means an org's override can replace only static instructional text and can
never be missing a `{placeholder}` a piece of code depends on, so there is no
way to type something in Settings that crashes an agent.

Org-level overrides arrive through `org_context["promptOverrides"]` (a dict
keyed by agent name), the same context object already threaded through every
pipeline — not a second DB connection from this side. Settings.PATCH writes
it, Settings.DELETE removes the key to restore the shipped default.
"""
from __future__ import annotations

from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt(name: str, org_context: dict | None = None) -> str:
    """The org's saved override for `name` if one exists, else the shipped
    default read from `shared/prompts/{name}.txt`."""
    override = ((org_context or {}).get("promptOverrides") or {}).get(name)
    if override:
        return override
    return (_PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")


def default_prompt(name: str) -> str:
    """The shipped default only, ignoring any override — what the Settings
    page shows as the reference text and what "Restore default" reverts to."""
    return (_PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
