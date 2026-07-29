"""
Agent registry and the pipeline definitions built from it.

One place that knows every agent, so the dashboard can list the fleet and its
responsibilities without importing each module, and pipelines are declared as
names rather than imports.
"""
from __future__ import annotations

from .base import Agent
from .lead_agents import (
    LeadDiscoveryAgent,
    LeadVerificationAgent,
    OpportunityAgent,
    ResearchAgent,
)
from .orchestrator import Orchestrator

#: Every agent the system can run, keyed by its stable name.
AGENTS: dict[str, Agent] = {
    a.name: a
    for a in (
        LeadDiscoveryAgent(),
        LeadVerificationAgent(),
        ResearchAgent(),
        OpportunityAgent(),
    )
}

#: Named pipelines. Order is the contract — `Orchestrator.validate` proves each
#: agent's requirements are satisfied by something earlier in the list.
PIPELINES: dict[str, tuple[str, ...]] = {
    # One candidate, end to end, from search to a scored lead ready to persist.
    "lead_acquisition": ("lead_discovery", "lead_verification", "research", "opportunity"),
    # Re-enrich a lead that already exists, skipping discovery and verification.
    "lead_enrichment": ("research", "opportunity"),
}


def build(pipeline: str, *, seed_keys: tuple[str, ...] = ()) -> Orchestrator:
    """Construct and validate a pipeline by name.

    Validation happens at construction rather than on first run, so an invalid
    pipeline surfaces as a startup error instead of a half-finished extraction.
    """
    if pipeline not in PIPELINES:
        raise KeyError(f"unknown pipeline '{pipeline}'. Known: {sorted(PIPELINES)}")

    orchestrator = Orchestrator([AGENTS[name] for name in PIPELINES[pipeline]])
    orchestrator.validate(seed_keys=seed_keys)
    return orchestrator


def describe_fleet() -> list[dict]:
    """Agent roster for the dashboard's AI Performance panel."""
    return [
        {
            "name": a.name,
            "responsibility": a.responsibility,
            "requires": list(a.requires),
            "provides": list(a.provides),
            "critical": a.critical,
        }
        for a in AGENTS.values()
    ]
