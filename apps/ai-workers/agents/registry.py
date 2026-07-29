"""
Agent registry and the pipeline definitions built from it.

One place that knows every agent, so the dashboard can list the fleet and its
responsibilities without importing each module, and pipelines are declared as
names rather than imports.
"""
from __future__ import annotations

from .base import Agent
from .intelligence_agents import (
    BuyerIntelligenceAgent,
    CompanyIntelligenceAgent,
    WebsiteAuditAgent,
)
from .lead_agents import (
    AiOpportunityAgent,
    LeadDiscoveryAgent,
    LeadScoringAgent,
    LeadVerificationAgent,
)
from .ops_agents import AnalyticsAgent, LearningAgent
from .orchestrator import Orchestrator
from .outreach_agents import EmailAgent, LinkedInAgent, ReviewAgent, SchedulerAgent

#: Every agent the system can run, keyed by its stable name.
AGENTS: dict[str, Agent] = {
    a.name: a
    for a in (
        LeadDiscoveryAgent(),
        LeadVerificationAgent(),
        CompanyIntelligenceAgent(),
        WebsiteAuditAgent(),
        BuyerIntelligenceAgent(),
        AiOpportunityAgent(),
        LeadScoringAgent(),
        ReviewAgent(),
        EmailAgent(),
        LinkedInAgent(),
        SchedulerAgent(),
        AnalyticsAgent(),
        LearningAgent(),
    )
}

#: Named pipelines. Order is the contract — `Orchestrator.validate` proves each
#: agent's requirements are satisfied by something earlier in the list.
#:
#: Scoring is deliberately LAST in every pipeline: it judges what the
#: intelligence agents actually established, so a lead whose research degraded
#: is scored on verified facts rather than optimistic assumptions.
PIPELINES: dict[str, tuple[str, ...]] = {
    # One candidate, end to end: found, verified, researched, audited, profiled,
    # analysed for opportunity, then scored.
    "lead_acquisition": (
        "lead_discovery",
        "lead_verification",
        "company_intelligence",
        "website_audit",
        "buyer_intelligence",
        "ai_opportunity",
        "lead_scoring",
    ),
    # Re-enrich an existing lead without re-discovering or re-verifying it.
    "lead_enrichment": (
        "company_intelligence",
        "website_audit",
        "buyer_intelligence",
        "ai_opportunity",
        "lead_scoring",
    ),
    # Cheap re-score after a human edits the review notes: no external calls
    # beyond the scorer itself.
    "rescore": ("lead_scoring",),

    # Everything needed to contact one lead. Review runs first so the reviewer's
    # corrections reach the email and LinkedIn copy rather than being applied
    # after they are written.
    "outreach": ("review", "email", "linkedin", "scheduler"),
    # Email only, for a sequence step that needs no LinkedIn copy.
    "email_only": ("review", "email", "scheduler"),
    # Cross-lead analysis. Separate from every per-lead pipeline because it
    # reads aggregates, not one candidate.
    "optimisation": ("analytics", "learning"),
}


#: Agents that make an extra Claude CLI call each. The full lead_acquisition
#: pipeline costs SIX CLI calls per candidate; dropping these three brings it
#: back to three. At a 100/day target that is the difference between ~600 and
#: ~300 calls against a subscription with finite headroom, so which enrichment
#: runs is a per-filter decision rather than a global default.
OPTIONAL_ENRICHMENT: tuple[str, ...] = (
    "company_intelligence",
    "website_audit",
    "buyer_intelligence",
)


def build_for_filter(niche_filter: dict, *, seed_keys: tuple[str, ...] = ()) -> Orchestrator:
    """The acquisition pipeline with enrichment agents the filter disabled removed.

    Discovery, verification, opportunity and scoring are never optional — without
    them there is no lead, no guarantee it is real, and no way to rank it.
    """
    disabled = set(niche_filter.get("disabledAgents") or [])
    # Silently dropping a required agent would produce a pipeline that validates
    # but cannot make a lead, so only enrichment is removable.
    steps = tuple(
        name
        for name in PIPELINES["lead_acquisition"]
        if name not in disabled or name not in OPTIONAL_ENRICHMENT
    )
    orchestrator = Orchestrator([AGENTS[name] for name in steps])
    orchestrator.validate(seed_keys=seed_keys)
    return orchestrator


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
