"""Behaviour tests for the agents whose logic is not just a model call."""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import PIPELINES, build, describe_fleet  # noqa: E402
from agents.base import AgentContext, AgentStatus  # noqa: E402
from agents.ops_agents import AnalyticsAgent, LearningAgent  # noqa: E402
from agents.outreach_agents import ReviewAgent, SchedulerAgent  # noqa: E402

SEEDS = {
    "lead_acquisition": ("niche_filter", "org_context", "attempt", "already_found"),
    "lead_enrichment": ("candidate", "verification", "org_context"),
    "manual_lead_enrichment": ("candidate", "org_context"),
    "company_intelligence_only": ("candidate", "org_context"),
    "rescore": ("candidate", "verification", "org_context"),
    "outreach": ("lead", "org_context", "case_study", "sequence_step"),
    "email_only": ("lead", "org_context", "case_study", "sequence_step"),
    "linkedin_draft": ("lead",),
    "optimisation": ("performance", "outcomes"),
    "case_study_review": ("case_study_input", "org_context"),
    "social_content": ("social_content_input", "org_context"),
}


def ctx(**data):
    return AgentContext(run_id="r", org_id="o", data=data)


def test_every_pipeline_validates():
    # A pipeline whose agents cannot satisfy each other would fail at runtime
    # mid-extraction; this catches it at import time instead.
    for name in PIPELINES:
        build(name, seed_keys=SEEDS[name])


def test_fleet_names_are_unique():
    names = [a["name"] for a in describe_fleet()]
    assert len(names) == len(set(names))


class TestReviewAgent:
    def test_human_notes_override_ai_findings(self):
        # The reviewer has context the model cannot see. Averaging the two would
        # produce an email matching neither.
        result = asyncio.run(ReviewAgent().run(ctx(lead={
            "painPoints": "AI guess",
            "aiOpportunities": "AI opportunity",
            "reviewNote": {"painPoints": "Human correction"},
        })))
        assert result.data["review_merged"]["painPoints"] == "Human correction"

    def test_ai_findings_used_where_the_human_said_nothing(self):
        result = asyncio.run(ReviewAgent().run(ctx(lead={
            "aiOpportunities": "AI opportunity",
            "reviewNote": {"painPoints": "Human"},
        })))
        assert result.data["review_merged"]["opportunities"] == "AI opportunity"

    def test_unreviewed_lead_degrades_rather_than_blocking(self):
        # Outreach can still proceed, but it must be visible that no human looked.
        result = asyncio.run(ReviewAgent().run(ctx(lead={"painPoints": "AI"})))
        assert result.status is AgentStatus.DEGRADED
        assert result.data["review_merged"]["humanReviewed"] is False


class TestSchedulerAgent:
    def test_schedules_a_wait_after_email_one(self):
        result = asyncio.run(SchedulerAgent().run(ctx(
            lead={"pipelineState": {"stage": "EMAIL_1_SENT"}})))
        assert result.data["schedule"]["waitDays"] == 3
        assert result.data["schedule"]["nextActionAt"] is not None

    def test_stops_the_sequence_once_they_reply(self):
        # Following up after someone answered is the fastest way to lose a
        # warm lead.
        for stage in ("REPLIED", "MEETING_BOOKED", "WON", "LOST"):
            result = asyncio.run(SchedulerAgent().run(ctx(
                lead={"pipelineState": {"stage": stage}})))
            assert result.data["schedule"]["nextActionAt"] is None, stage

    def test_never_schedules_onto_a_weekend(self):
        result = asyncio.run(SchedulerAgent().run(ctx(
            lead={"pipelineState": {"stage": "EMAIL_1_SENT"}})))
        due = datetime.fromisoformat(result.data["schedule"]["nextActionAt"])
        assert due.weekday() < 5

    def test_unknown_stage_does_not_invent_a_schedule(self):
        result = asyncio.run(SchedulerAgent().run(ctx(
            lead={"pipelineState": {"stage": "NEGOTIATION"}})))
        assert result.data["schedule"]["nextActionAt"] is None


class TestSampleSizeGuards:
    def test_analytics_refuses_to_conclude_from_a_tiny_sample(self):
        # A campaign with 4 leads and a 50% reply rate has told you nothing.
        result = asyncio.run(AnalyticsAgent().run(ctx(
            performance=[{"name": "tiny", "leads": 4}])))
        assert result.status is AgentStatus.SKIPPED
        assert "below the" in " ".join(result.notes)

    def test_learning_refuses_to_learn_from_too_few_decided_deals(self):
        # Learning from noise narrows the targeting on no evidence, and the
        # damage compounds.
        result = asyncio.run(LearningAgent().run(ctx(
            performance=[{"name": "c", "leads": 500}],
            outcomes={"won": 2, "lost": 1},
        )))
        assert result.status is AgentStatus.SKIPPED
        assert "noise" in " ".join(result.notes)
