"""Specialised agents plus the orchestrator that coordinates them."""

from .base import Agent, AgentContext, AgentResult, AgentStatus
from .orchestrator import AgentRunRecord, Orchestrator, PipelineDefinitionError, PipelineResult
from .registry import (
    AGENTS,
    OPTIONAL_ENRICHMENT,
    PIPELINES,
    build,
    build_for_filter,
    describe_fleet,
)

__all__ = [
    "Agent",
    "AgentContext",
    "AgentResult",
    "AgentStatus",
    "AgentRunRecord",
    "Orchestrator",
    "PipelineDefinitionError",
    "PipelineResult",
    "AGENTS",
    "OPTIONAL_ENRICHMENT",
    "PIPELINES",
    "build",
    "build_for_filter",
    "describe_fleet",
]
