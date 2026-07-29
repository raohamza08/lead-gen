"""
Agent contract for the AI Sales OS.

Each agent has exactly ONE responsibility and communicates only through a shared
AgentContext. That constraint is what makes the system debuggable: when a lead
comes out wrong you can point at the single agent that produced the bad field,
re-run just that agent, and see its inputs and outputs in isolation.

Two design rules do most of the reliability work:

1. Agents declare `requires` and `provides` as context keys. The orchestrator
   validates the whole chain BEFORE running any of it, so a mis-ordered pipeline
   fails in microseconds at startup rather than halfway through an expensive
   run that has already spent API quota.

2. Failure is classified, not boolean. A verification agent that cannot reach a
   website degrades the lead; a discovery agent that finds nothing ends the
   pipeline. Collapsing those into "raised or didn't" forces every caller to
   re-derive the distinction from the exception type.
"""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterable

logger = logging.getLogger("agents.base")


class AgentStatus(str, Enum):
    """Outcome of a single agent run."""

    OK = "OK"
    #: Produced partial output. The pipeline continues with what it has — e.g.
    #: enrichment found no LinkedIn page, which is a worse lead, not a failure.
    DEGRADED = "DEGRADED"
    #: Could not produce its output, but later agents don't depend on it.
    FAILED = "FAILED"
    #: Nothing downstream can proceed. The orchestrator stops the pipeline.
    FATAL = "FATAL"
    #: Preconditions weren't met, so the agent deliberately did no work.
    SKIPPED = "SKIPPED"


@dataclass
class AgentResult:
    status: AgentStatus
    #: Context keys this run produced. Merged into the context by the orchestrator
    #: rather than mutated in place, so an agent cannot corrupt another's output.
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    duration_ms: int = 0
    #: Free-form notes surfaced in the dashboard's agent timeline.
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status in (AgentStatus.OK, AgentStatus.DEGRADED)


@dataclass
class AgentContext:
    """Shared state threaded through one pipeline execution.

    Deliberately a plain dict rather than a typed model: agents are added and
    reordered constantly, and a rigid schema would make every new agent a
    breaking change. `requires`/`provides` supply the safety a type would.
    """

    run_id: str
    org_id: str
    data: dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def has(self, *keys: str) -> bool:
        return all(self.data.get(k) is not None for k in keys)

    def merge(self, values: dict[str, Any]) -> None:
        self.data.update(values)

    def missing(self, keys: Iterable[str]) -> list[str]:
        return [k for k in keys if self.data.get(k) is None]


class Agent(ABC):
    """One responsibility. No agent calls another — only the orchestrator sequences them."""

    #: Stable identifier, used in pipeline definitions and persisted on AgentRun.
    name: str = "unnamed"
    #: Human-readable responsibility, shown in the dashboard.
    responsibility: str = ""
    #: Context keys that must be present before this agent can run.
    requires: tuple[str, ...] = ()
    #: Context keys this agent is expected to produce.
    provides: tuple[str, ...] = ()
    #: When True, a FAILED result stops the pipeline rather than degrading it.
    critical: bool = False

    @abstractmethod
    async def execute(self, ctx: AgentContext) -> AgentResult:
        """Do the work. Raising is allowed — `run` converts it into a result."""

    async def run(self, ctx: AgentContext) -> AgentResult:
        """Wraps execute() with precondition checks, timing and error capture.

        Agents never handle their own timing or exception translation; doing it
        here is what guarantees every agent reports the same shape to the
        dashboard, however it was written.
        """
        missing = ctx.missing(self.requires)
        if missing:
            return AgentResult(
                status=AgentStatus.SKIPPED,
                error=f"missing required context: {', '.join(missing)}",
            )

        started = time.monotonic()
        try:
            result = await self.execute(ctx)
        except Exception as err:  # noqa: BLE001 - deliberately broad
            # An agent crashing must never take the pipeline process down; the
            # orchestrator decides whether this particular failure is fatal.
            logger.exception("agent %s raised", self.name)
            result = AgentResult(
                status=AgentStatus.FATAL if self.critical else AgentStatus.FAILED,
                error=f"{type(err).__name__}: {err}",
            )

        result.duration_ms = int((time.monotonic() - started) * 1000)

        # An agent reporting OK while producing none of what it promised is a
        # bug that would otherwise surface much later as a confusing null.
        if result.status is AgentStatus.OK:
            unfulfilled = [k for k in self.provides if result.data.get(k) is None]
            if unfulfilled:
                result.status = AgentStatus.DEGRADED
                result.notes.append(f"did not produce: {', '.join(unfulfilled)}")

        return result
