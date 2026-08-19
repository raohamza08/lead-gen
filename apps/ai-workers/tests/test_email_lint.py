"""Behaviour tests for the 5-email sequence's deterministic voice/structure checks."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_agent.lint import has_placeholder, lint_draft, word_count  # noqa: E402

ORG_NAMES = ["EurosHub", "EurosHub Ltd"]


def clean_body(text: str) -> str:
    return f"<p>{text}</p>"


def test_clean_draft_passes():
    body = clean_body("Most teams in this space lose hours a week chasing follow-up by hand.")
    issues = lint_draft(1, "A quiet cost in ops", body, ORG_NAMES)
    assert issues == []


def test_flags_body_over_word_limit():
    body = clean_body(" ".join(["word"] * 151))
    issues = lint_draft(1, "Short subject", body, ORG_NAMES)
    assert any("150-word" in i for i in issues)


def test_flags_subject_over_six_words():
    issues = lint_draft(1, "This subject line has way too many words in it", clean_body("fine"), ORG_NAMES)
    assert any("6-word" in i for i in issues)


def test_flags_exclamation_point():
    issues = lint_draft(1, "Quick thought", clean_body("This is exciting!"), ORG_NAMES)
    assert any("exclamation" in i for i in issues)


def test_flags_banned_jargon():
    issues = lint_draft(1, "Quick thought", clean_body("We help you leverage AI."), ORG_NAMES)
    assert any("leverage" in i for i in issues)


def test_flags_urgency_language():
    issues = lint_draft(1, "Quick thought", clean_body("Act now before it's too late."), ORG_NAMES)
    assert any("urgency" in i for i in issues)


def test_flags_company_name_before_step_three():
    issues = lint_draft(1, "Quick thought", clean_body("EurosHub can help your team."), ORG_NAMES)
    assert any("names the company" in i for i in issues)


def test_allows_company_name_from_step_three():
    issues = lint_draft(3, "Quick thought", clean_body("EurosHub helped a similar team."), ORG_NAMES)
    assert not any("names the company" in i for i in issues)


def test_has_placeholder_detects_bracket_note():
    assert has_placeholder("subject", "We cut turnaround by [INSERT REAL, VERIFIED RESULT].") is True
    assert has_placeholder("subject", "We cut turnaround by half.") is False


def test_word_count_ignores_html_tags():
    assert word_count("<p>one two three</p>") == 3
