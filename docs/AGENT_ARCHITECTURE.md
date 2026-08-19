# Agent architecture

The AI work is a **fleet of single-responsibility agents coordinated by an
orchestrator**, not one model doing everything. Agents never call each other;
all sequencing happens in the orchestrator, which is what keeps any individual
agent replaceable and independently testable.

```
                    Dashboard (real-time, WebSocket)
                              │
                  API — BullMQ agent-dispatch queue
                              │
                     Workflow Orchestrator
                              │
   ┌──────────┬────────────┬──┴───────┬──────────────┬────────────┐
   │          │            │          │              │            │
 Lead     Verification  Company/Site/  AI Opportunity  Agent      (Email, LinkedIn,
Discovery              Buyer Intel     + Lead Scoring  Review     Scheduler, Analytics,
                                                                   Learning)
```

## Why decomposed

The previous runner fused discovery, verification and scoring into one
procedure. Three concrete problems followed, and each is fixed by the split:

- **Attribution.** A wrong field could have come from any step. Now each agent
  records its own status, duration and error, so a bad output points at exactly
  one agent.
- **Partial loss.** A failure late in the chain discarded everything earlier.
  Now a research failure downgrades the lead instead of throwing away verified
  contact data that cost real quota to obtain.
- **Cost visibility.** One timing number covered everything. Now each step's
  latency and failure rate is separate, which is what makes the AI Performance
  panel meaningful.

## The contract

Every agent declares `requires` and `provides` as context keys, and the
orchestrator validates the whole chain **before running any of it**:

```python
orchestrator = build("lead_acquisition", seed_keys=("niche_filter", ...))
# raises PipelineDefinitionError if any agent needs something nothing earlier provides
```

A mis-ordered pipeline fails in microseconds at construction rather than
halfway through a run that has already paid for web searches and model calls.

## Failure is classified, not boolean

| Status | Meaning | Orchestrator behaviour |
|---|---|---|
| `OK` | Produced everything promised | continue |
| `DEGRADED` | Partial output; lead is poorer, not unusable | continue |
| `FAILED` | Could not produce output | continue unless `critical` |
| `FATAL` | Nothing downstream can proceed | stop the pipeline |
| `SKIPPED` | Preconditions absent, so no work done | continue |

Collapsing these into "raised or didn't" forces every caller to re-derive the
distinction from exception types. Two consequences worth knowing:

- **`FATAL` is never retried.** It means the precondition for success is absent,
  not that the call was unlucky — retrying only spends quota to fail again.
- **A failed attempt's data never reaches the context.** Only successful results
  merge, so a later agent can never mistake partial output for real input.

An agent that reports `OK` while producing none of its declared `provides` is
automatically downgraded to `DEGRADED` with a note. That converts a silent bug
into a visible one at the point it happens, rather than as a confusing null much
later.

## Agents

All 14 are **built and wired into a live pipeline** as of 2026-07-31 — the
table below used to track several as "not yet an agent"; that gap is closed.

| Agent | Responsibility | Notes |
|---|---|---|
| `lead_discovery` | Finds companies matching the filters | critical |
| `lead_verification` | Validates website, LinkedIn, email; rejects unqualified | critical. Registered twice — see below |
| `company_intelligence` | Business model, competitors, growth signals, digital maturity | optional enrichment (Full/Reduced toggle) |
| `website_audit` | Design/UX/SEO/speed/security findings quotable to the prospect | optional enrichment |
| `buyer_intelligence` | Decision-maker persona, authority/engagement scores | optional enrichment |
| `ai_opportunity` | Manual workflows, automation ideas, ROI, deal size | always runs |
| `lead_scoring` | Six-dimension rubric + priority score | always runs, always last |
| `agent_review` | AI's own review note — same fields Human review asks a person to fill in | added 2026-07-30, feeds `manual_lead_enrichment` |
| `review` | Merges the human's review note with AI findings for outreach copy | not the same agent as `agent_review` above — this one blends, that one authors from scratch |
| `email` | Drafts one email of the 5-email sequence (Claude CLI, not Gemini — see `docs/RESUME.md`'s 2026-08-12 entry) | step-aware via `sequence_step` in context |
| `linkedin` | Drafts connection/follow-up copy only | sending itself is permanently out of scope (ToS/ban risk) — this has not changed and should not |
| `scheduler` | Wait periods, follow-up timing | BullMQ sequencer in the API |
| `analytics` | Campaign performance and optimisation suggestions | |
| `learning` | Learns which niches, offers and subject lines perform | |

**`lead_verification` is registered under two dict keys** in
`registry.py` — `"lead_verification"` (the strict form: an unqualified
candidate is `FATAL`, correct for a not-yet-persisted discovery candidate)
and `"lead_verification_soft"` (`reject_unqualified=False`: a manually-added
lead already exists as a row, so a failed check degrades it instead of
discarding it). Both share the same `.name`, so the dashboard fleet roster
still shows one `lead_verification` row — `describe_fleet()` dedupes by name
specifically to keep this invisible.

`company_intelligence`/`website_audit`/`buyer_intelligence` and
`ai_opportunity`/`lead_scoring` are deliberately separate agents rather than
one "research" and one "opportunity" step (an earlier version of this doc
described it that way, before the split). Research establishes *facts*;
opportunity/scoring form *judgements* on top of them — fusing them produces
confident-sounding opportunities with nothing underneath.

## Pipelines

```python
"lead_acquisition":      lead_discovery -> lead_verification -> company_intelligence
                          -> website_audit -> buyer_intelligence -> ai_opportunity -> lead_scoring
"lead_enrichment":        company_intelligence -> website_audit -> buyer_intelligence
                          -> ai_opportunity -> lead_scoring       # re-enrich an existing lead; unused today
"manual_lead_enrichment": lead_verification_soft -> company_intelligence -> website_audit
                          -> buyer_intelligence -> ai_opportunity -> lead_scoring -> agent_review
"rescore":                lead_scoring          # cheap re-score after a review-note edit
"outreach":                review -> email -> linkedin -> scheduler
"email_only":              review -> email -> scheduler         # drives every step of the 5-email sequence
"linkedin_draft":          review -> linkedin
"optimisation":            analytics -> learning                # cross-lead, not per-candidate
```

`GET /agents` on the worker returns the live roster and pipeline definitions,
read from the registry rather than a hand-maintained list — an agent added to
the fleet appears there without a second edit that could be forgotten.

## Dispatch and progress (added 2026-07-30/31)

Every HTTP call from the NestJS API into these pipelines (`/lead-gen/enrich`,
`/personalization/draft`, `/linkedin/draft`, `/lead-gen/runs`) now goes
through a retrying BullMQ queue (`apps/api/src/common/queue/agent-dispatch.*`)
instead of a bare `fetch()` — a transient failure retries automatically, and
a `Notification` is created only once retries are exhausted.

`Orchestrator.run()` also accepts an optional `on_step` callback, awaited
with each agent's result the moment that agent finishes rather than only once
the whole pipeline completes. `gemini_agent/runner.py` and
`claude_agent/runner.py`'s `run_manual_enrichment` both use it to stream
`agentRun.recorded` events to the dashboard in real time (over the API's
WebSocket gateway) instead of the old batch-at-the-end telemetry flush — a
pipeline that runs for minutes now shows live progress instead of nothing
until it's done.

## Adding an agent

1. Subclass `Agent`, set `name`, `responsibility`, `requires`, `provides`.
2. Implement `execute()`. Raising is fine — `run()` converts it to a result;
   never catch broadly inside an agent just to return a status.
3. Register it in `agents/registry.py` and add it to a pipeline.
4. Construction validates the chain, so a wrong position fails immediately.

Set `critical = True` only when nothing downstream can work without it.
Over-using it turns recoverable degradation into aborted runs.

## Testing

`tests/test_orchestrator.py` covers the guarantees the architecture rests on:
contract validation, containment of a raising agent, the no-partial-data rule,
`FATAL` not being retried, and accurate attempt counting.
`tests/test_agents.py` validates every pipeline in `PIPELINES` actually
constructs (a `SEEDS` dict per pipeline — add an entry here when adding a
pipeline, or `test_every_pipeline_validates` fails with a `KeyError`), that
`describe_fleet()` names stay unique despite the two `lead_verification`
registry keys, plus behaviour tests for `ReviewAgent`/`SchedulerAgent`/sample-
size guards. 22 tests total. Run with:

```bash
cd apps/ai-workers && .venv\Scripts\python.exe -m pytest tests/ -q
```
