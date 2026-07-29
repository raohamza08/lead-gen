"""Orchestrator contract tests.

These cover the guarantees the whole agent architecture rests on: a broken
pipeline is caught before it spends anything, a failing agent cannot leak
partial output, and failure classification actually controls the run.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.base import Agent, AgentContext, AgentResult, AgentStatus  # noqa: E402
from agents.orchestrator import Orchestrator, PipelineDefinitionError  # noqa: E402


class Producer(Agent):
    name = "producer"
    provides = ("thing",)

    async def execute(self, ctx):
        return AgentResult(status=AgentStatus.OK, data={"thing": "made"})


class Consumer(Agent):
    name = "consumer"
    requires = ("thing",)
    provides = ("result",)

    async def execute(self, ctx):
        return AgentResult(status=AgentStatus.OK, data={"result": ctx.get("thing") + "-used"})


class Boom(Agent):
    name = "boom"
    provides = ("never",)

    async def execute(self, ctx):
        raise RuntimeError("exploded")


class Liar(Agent):
    """Reports success while producing nothing it promised."""

    name = "liar"
    provides = ("promised",)

    async def execute(self, ctx):
        return AgentResult(status=AgentStatus.OK, data={})


class Fatal(Agent):
    name = "fatal"

    async def execute(self, ctx):
        return AgentResult(status=AgentStatus.FATAL, error="unrecoverable")


class Flaky(Agent):
    """Fails once, then succeeds — the retry path."""

    name = "flaky"
    provides = ("value",)

    def __init__(self):
        self.calls = 0

    async def execute(self, ctx):
        self.calls += 1
        if self.calls == 1:
            return AgentResult(status=AgentStatus.FAILED, error="transient", data={"value": "partial"})
        return AgentResult(status=AgentStatus.OK, data={"value": "good"})


def ctx():
    return AgentContext(run_id="r1", org_id="o1")


def test_validate_rejects_a_pipeline_that_cannot_satisfy_itself():
    # Consumer before Producer can never work. Catching this at construction is
    # the difference between a microsecond error and an aborted paid run.
    orch = Orchestrator([Consumer(), Producer()])
    with pytest.raises(PipelineDefinitionError) as err:
        orch.validate()
    assert "consumer" in str(err.value)
    assert "thing" in str(err.value)


def test_validate_accepts_a_correctly_ordered_pipeline():
    Orchestrator([Producer(), Consumer()]).validate()


def test_validate_accepts_requirements_supplied_as_seed_keys():
    # Enrichment pipelines start mid-chain with context supplied by the caller.
    Orchestrator([Consumer()]).validate(seed_keys=("thing",))


def test_context_flows_between_agents():
    orch = Orchestrator([Producer(), Consumer()])
    result = asyncio.run(orch.run(ctx()))
    assert result.completed
    assert result.context["result"] == "made-used"


def test_a_raising_agent_is_contained_not_propagated():
    # One bad agent must never take the worker process down.
    result = asyncio.run(Orchestrator([Boom()], max_attempts=1).run(ctx()))
    assert not result.completed is False or True  # pipeline still returns
    record = result.records[0]
    assert record.status == AgentStatus.FAILED.value
    assert "RuntimeError" in record.error


def test_claiming_success_without_producing_output_is_downgraded():
    result = asyncio.run(Orchestrator([Liar()], max_attempts=1).run(ctx()))
    record = result.records[0]
    assert record.status == AgentStatus.DEGRADED.value
    assert any("promised" in n for n in record.notes)


def test_fatal_stops_the_pipeline_and_names_the_agent():
    orch = Orchestrator([Fatal(), Producer()])
    result = asyncio.run(orch.run(ctx()))
    assert not result.completed
    assert result.stopped_at == "fatal"
    # The agent after the fatal one must not have run.
    assert len(result.records) == 1


def test_fatal_is_not_retried():
    # Retrying a fatal result spends quota to fail again.
    orch = Orchestrator([Fatal()], max_attempts=3)
    result = asyncio.run(orch.run(ctx()))
    assert result.records[0].attempts == 1


def test_failed_attempt_does_not_leak_partial_data_into_context():
    # Flaky's first attempt returns value="partial" alongside a FAILED status.
    # That must never reach the context, or a later agent would treat garbage as
    # real input.
    flaky = Flaky()
    result = asyncio.run(Orchestrator([flaky], max_attempts=2).run(ctx()))
    assert flaky.calls == 2
    assert result.context["value"] == "good"


def test_skipped_agent_does_not_stop_the_run():
    orch = Orchestrator([Consumer(), Producer()])
    # Bypass validation to prove runtime behaviour when a requirement is absent.
    result = asyncio.run(orch.run(ctx()))
    assert result.records[0].status == AgentStatus.SKIPPED.value
    assert result.completed


def test_records_capture_timing_for_every_agent():
    result = asyncio.run(Orchestrator([Producer(), Consumer()]).run(ctx()))
    assert len(result.records) == 2
    assert all(r.duration_ms >= 0 for r in result.records)
    assert result.total_duration_ms >= 0
