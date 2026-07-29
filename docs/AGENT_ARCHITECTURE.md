# Agent architecture

The AI work is a **fleet of single-responsibility agents coordinated by an
orchestrator**, not one model doing everything. Agents never call each other;
all sequencing happens in the orchestrator, which is what keeps any individual
agent replaceable and independently testable.

```
                          Dashboard
                              │
                     Workflow Orchestrator
                              │
   ┌────────────┬─────────────┼─────────────┬────────────┐
   │            │             │             │            │
 Lead      Verification    Research    Opportunity   (Email, LinkedIn,
Discovery                                            Scheduler, Analytics,
                                                     Learning — see status)
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

| Agent | Responsibility | Status |
|---|---|---|
| `lead_discovery` | Finds companies matching the filters | **Built** (critical) |
| `lead_verification` | Validates website, LinkedIn, email; rejects unqualified | **Built** (critical) |
| `research` | Studies website, business model, competitors, growth signals | **Built** |
| `opportunity` | Pain points, automation opportunities, scores, suggested offer | **Built** |
| `review` | Merges human review with AI findings | Exists as API + UI, not yet an agent |
| `email` | Generates per-stage personalised emails | Exists as `gemini_agent`, not yet an agent |
| `linkedin` | Connection requests and outreach tasks | Data model only — automation intentionally out of scope (ToS/ban risk) |
| `scheduler` | Wait periods, follow-up timing, retries | Exists as BullMQ sequencer in the API |
| `analytics` | Campaign performance and optimisation suggestions | Exists as `AnalyticsService`, read-only |
| `learning` | Learns which niches, offers and subject lines perform | **Not built** |

`research` and `opportunity` are deliberately separate. Research establishes
*facts* (what they sell, who they compete with, what they're hiring for);
opportunity forms *judgements* on top of them. Fusing the two produces
confident-sounding opportunities with nothing underneath, and makes a wrong
answer impossible to attribute.

## Pipelines

```python
"lead_acquisition": lead_discovery -> lead_verification -> research -> opportunity
"lead_enrichment":  research -> opportunity      # re-enrich an existing lead
```

`GET /agents` on the worker returns the live roster and pipeline definitions,
read from the registry rather than a hand-maintained list — an agent added to
the fleet appears there without a second edit that could be forgotten.

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
`FATAL` not being retried, and accurate attempt counting. Run with:

```bash
cd apps/ai-workers && .venv\Scripts\python.exe -m pytest tests/ -q
```
