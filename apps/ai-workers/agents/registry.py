"""
Agent registry and the pipeline definitions built from it.

One place that knows every agent, so the dashboard can list the fleet and its
responsibilities without importing each module, and pipelines are declared as
names rather than imports.
"""
from __future__ import annotations

from .base import Agent
from .case_study_agent import CaseStudyReviewAgent
from .email_lead_agent import EmailLeadClassifierAgent
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
from .review_agents import AgentReviewAgent
from .social_content_agent import SocialContentAgent

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
        AgentReviewAgent(),
        CaseStudyReviewAgent(),
        SocialContentAgent(),
        EmailLeadClassifierAgent(),
    )
}
# A second instance of the same agent under a distinct registry key, used only
# by the manual-lead pipeline below — see LeadVerificationAgent.__init__. Its
# `.name` is still "lead_verification", so AgentRun telemetry looks identical
# regardless of which pipeline ran it; only this lookup key differs.
AGENTS["lead_verification_soft"] = LeadVerificationAgent(reject_unqualified=False)

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
    # A hand-entered lead already exists as a Lead row (CreateManualLeadDto),
    # so this runs everything discovery would otherwise have triggered —
    # verification, research, opportunity, scoring, and the AI's own review
    # note — just against a lead that isn't going anywhere if a check fails.
    # Verification is the soft variant: a manual lead with an unverified email
    # still gets fully enriched, it just carries that as information rather
    # than being dropped (see LeadVerificationAgent.reject_unqualified).
    #
    # company_intelligence is deliberately NOT here (Part: token reduction,
    # 2026-08-29) — it used to run immediately for every hand-entered/CSV-
    # imported lead, including the many that never get promoted out of Lead
    # Room. See "company_intelligence_only" below: it runs once, on promotion
    # to Pipeline, only for leads the user actually chose to move forward.
    "manual_lead_enrichment": (
        "lead_verification_soft",
        "website_audit",
        "buyer_intelligence",
        "ai_opportunity",
        "lead_scoring",
        "agent_review",
    ),
    # Company research for a lead the user just promoted to Pipeline (Part:
    # token reduction, 2026-08-29) — split out of manual_lead_enrichment
    # above so this one call is spent only on leads reaching Ready, not
    # every raw import. Safe to run standalone: company_intelligence only
    # requires "candidate" (see intelligence_agents.py), nothing website_audit/
    # buyer_intelligence/ai_opportunity/lead_scoring produced upstream.
    "company_intelligence_only": ("company_intelligence",),
    # Cheap re-score after a human edits the review notes: no external calls
    # beyond the scorer itself.
    "rescore": ("lead_scoring",),

    # Everything needed to contact one lead. Review runs first so the reviewer's
    # corrections reach the email and LinkedIn copy rather than being applied
    # after they are written.
    "outreach": ("review", "email", "linkedin", "scheduler"),
    # Email only, for a sequence step that needs no LinkedIn copy. This is what
    # actually drives the Gemini-drafted pitch (Part D2) — see gemini_agent/runner.py.
    "email_only": ("review", "email", "scheduler"),
    # LinkedIn copy only, triggered on demand from a lead's detail page rather
    # than automatically — LinkedIn outreach itself stays human-driven (ToS/ban
    # risk), this only removes the blank-page problem for the person sending it.
    "linkedin_draft": ("review", "linkedin"),
    # Cross-lead analysis. Separate from every per-lead pipeline because it
    # reads aggregates, not one candidate.
    "optimisation": ("analytics", "learning"),
    # One agent, its own pipeline: reviewing a submitted case study for niche
    # fit and email-ready wording, triggered from Settings when an operator
    # adds one.
    "case_study_review": ("case_study_review",),
    # One agent, its own pipeline: drafts or repurposes a social post caption
    # from a brief (Part: Social Media Management), triggered on demand from
    # the composer or an automation's CREATE_DRAFT action.
    "social_content": ("social_content",),
    # One agent, its own pipeline: judges whether an inbound email's sender
    # looks like a viable prospect (Part: Lead Room), triggered from the Email
    # Hub sync worker on a thread's first message only.
    "email_lead_classifier": ("email_lead_classifier",),
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
    """Agent roster for the dashboard's AI Performance panel.

    Deduped by `.name` rather than a straight pass over AGENTS.values():
    "lead_verification_soft" is a second registry entry for the manual-lead
    pipeline (see LeadVerificationAgent.__init__), not a second agent, and
    would otherwise show as a duplicate "lead_verification" row.
    """
    seen: set[str] = set()
    fleet: list[dict] = []
    for a in AGENTS.values():
        if a.name in seen:
            continue
        seen.add(a.name)
        fleet.append(
            {
                "name": a.name,
                "responsibility": a.responsibility,
                "requires": list(a.requires),
                "provides": list(a.provides),
                "critical": a.critical,
            }
        )
    return fleet
