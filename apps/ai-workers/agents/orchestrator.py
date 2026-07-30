"""
Workflow orchestrator.

Sequences agents, enforces the contract they declare, retries transient
failures, and records every run so the dashboard can show what the system is
actually doing. Agents never call each other — all coordination happens here,
which is what keeps any single agent replaceable.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from .base import Agent, AgentContext, AgentResult, AgentStatus

logger = logging.getLogger("agents.orchestrator")


class PipelineDefinitionError(Exception):
    """A pipeline that cannot possibly succeed, detected before it runs."""


@dataclass
class AgentRunRecord:
    """One agent execution, for the dashboard's agent timeline and queue view."""

    agent: str
    status: str
    duration_ms: int
    error: str | None = None
    notes: list[str] = field(default_factory=list)
    attempts: int = 1
    # Set after the fact, once the candidate this run belonged to either became
    # a Lead or was rejected — the orchestrator itself never knows a lead id,
    # since agents run before the lead row exists.
    lead_id: str | None = None


@dataclass
class PipelineResult:
    run_id: str
    completed: bool
    records: list[AgentRunRecord] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)
    stopped_at: str | None = None
    stop_reason: str | None = None

    @property
    def total_duration_ms(self) -> int:
        return sum(r.duration_ms for r in self.records)


class Orchestrator:
    """Runs an ordered list of agents against one shared context."""

    def __init__(self, agents: list[Agent], *, max_attempts: int = 2) -> None:
        self.agents = agents
        self.max_attempts = max(1, max_attempts)

    def validate(self, seed_keys: tuple[str, ...] = ()) -> None:
        """Check the chain can satisfy itself, before spending anything.

        Walks the pipeline accumulating what each agent provides and asserting
        the next agent's requirements are already available. Catching a
        mis-ordered pipeline here costs microseconds; catching it at runtime
        costs an aborted run that has already paid for web searches and model
        calls.
        """
        available: set[str] = set(seed_keys)
        for agent in self.agents:
            missing = [k for k in agent.requires if k not in available]
            if missing:
                raise PipelineDefinitionError(
                    f"agent '{agent.name}' requires {missing}, which nothing before it provides. "
                    f"Available at that point: {sorted(available) or 'nothing'}"
                )
            available.update(agent.provides)

    async def run(self, ctx: AgentContext) -> PipelineResult:
        result = PipelineResult(run_id=ctx.run_id, completed=False)

        for agent in self.agents:
            record = await self._run_with_retry(agent, ctx)
            result.records.append(record)

            status = AgentStatus(record.status)

            if status is AgentStatus.FATAL:
                result.stopped_at = agent.name
                result.stop_reason = record.error or "fatal error"
                logger.error("pipeline %s stopped at %s: %s", ctx.run_id, agent.name, result.stop_reason)
                result.context = ctx.data
                return result

            if status is AgentStatus.FAILED and agent.critical:
                result.stopped_at = agent.name
                result.stop_reason = f"critical agent failed: {record.error}"
                result.context = ctx.data
                return result

            # SKIPPED and FAILED on a non-critical agent are both survivable:
            # the lead is poorer, not unusable, and forcing the whole run to
            # abort over one optional enrichment step would waste the work
            # already done.

        result.completed = True
        result.context = ctx.data
        return result

    async def _run_with_retry(self, agent: Agent, ctx: AgentContext) -> AgentRunRecord:
        last: AgentResult | None = None
        # Tracked outside the loop so the record reports attempts actually made.
        # Reporting max_attempts unconditionally would show retries that never
        # happened for FATAL results, which stop immediately.
        attempt = 0

        while attempt < self.max_attempts:
            attempt += 1
            last = await agent.run(ctx)

            if last.ok or last.status is AgentStatus.SKIPPED:
                # Merge only on success. A failed attempt must not leave partial
                # output in the context for later agents to mistake for real data.
                ctx.merge(last.data)
                return AgentRunRecord(
                    agent=agent.name,
                    status=last.status.value,
                    duration_ms=last.duration_ms,
                    error=last.error,
                    notes=last.notes,
                    attempts=attempt,
                )

            # FATAL means the precondition for success is absent, not that the
            # call was unlucky — retrying just spends quota to fail again.
            if last.status is AgentStatus.FATAL or attempt == self.max_attempts:
                break

            backoff = 2 ** attempt
            logger.warning(
                "agent %s attempt %d/%d failed (%s) — retrying in %ds",
                agent.name, attempt, self.max_attempts, last.error, backoff,
            )
            await asyncio.sleep(backoff)

        assert last is not None
        return AgentRunRecord(
            agent=agent.name,
            status=last.status.value,
            duration_ms=last.duration_ms,
            error=last.error,
            notes=last.notes,
            attempts=attempt,
        )
