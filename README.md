# AI Sales OS — Lead Generation & Client Acquisition Platform

An internal platform that discovers, researches, qualifies and contacts B2B
leads through a fleet of specialised AI agents, keeping a human in control of
review and approval.

> **Picking this up again? Read [`docs/RESUME.md`](./docs/RESUME.md) first.**
> It has the restart commands, exactly where work stopped, and the traps already
> hit — reading it will save you rediscovering several of them.

**Live:** https://lead-gen-dashboard-umber.vercel.app · **Login:** see
[`docs/RESUME.md`](./docs/RESUME.md#restart-the-stack) — the seeded admin's
email has since been changed and isn't published here

## How it fits together

```
Vercel (dashboard)  ──HTTPS──>  Cloudflare Tunnel  ──>  workstation
                                                          ├── API        :4000  (NestJS)
                                                          ├── AI workers :8000  (FastAPI, 14 agents)
                                                          └── Redis      :6379  (BullMQ)
                                                                 │
                                                          Supabase Postgres
```

The API runs on the workstation rather than a managed host **on purpose**: the
lead-finder shells out to a locally logged-in `claude` CLI, so a cloud API could
never trigger extraction. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Documentation

| Document | What it covers |
|---|---|
| [`docs/RESUME.md`](./docs/RESUME.md) | **Start here.** Restart commands, current state, known traps |
| [`docs/AGENT_ARCHITECTURE.md`](./docs/AGENT_ARCHITECTURE.md) | The 14 agents, orchestrator contract, failure classification |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Vercel + tunnel setup, Render fallback |
| [`lead-gen-system-architecture.md`](./lead-gen-system-architecture.md) | Original full design |
| [`Instructions Doc.txt`](./Instructions%20Doc.txt), [`new.md.txt`](./new.md.txt) | Product specs this is built against |

## Monorepo layout

```
apps/
  web/          Next.js dashboard (TypeScript, Tailwind, Recharts)
  api/          NestJS core services (auth, leads, niche-filters, sequencer, sync, analytics, webhooks)
  ai-workers/   Python/FastAPI agents (Claude lead-gen agent, Gemini personalization agent)
packages/
  types/        Shared TypeScript types (lead schema, DTOs) used by web + api
infra/
  docker-compose.yml, docker/*.Dockerfile   Local Postgres + Redis + all three services
.github/workflows/ci.yml                    Node build/lint/test + Python lint, on PR/push
```

## Prerequisites

- Node.js >= 20, npm >= 10
- Python >= 3.11 (on Windows, use the `py` launcher — see note below)
- Docker (for Postgres/Redis locally) — or point `DATABASE_URL`/`REDIS_URL` at existing instances
- Google AI (Gemini), ClickUp, Google service account, mail provider API keys — see `.env.example`. **None of these are required to run the scaffold locally** — see "Demo mode" below.
- **No Anthropic API key needed.** The lead-finder (`apps/ai-workers/claude_agent`) shells out to the local Claude Code CLI (`claude -p ...`) instead of calling the Anthropic API directly, so it runs on an existing Claude Code subscription rather than metered API billing. Requires the `claude` CLI installed and logged in on the machine running `apps/ai-workers`.

**Windows note:** if `python`/`python3` on PATH resolve to the Microsoft Store stub instead of a real install, use `py -3` instead (`py -3 -m venv .venv`, etc.).

**Windows + Docker Desktop note:** Docker Desktop requires WSL2 as its backend. If `wsl --status` reports "Windows Subsystem for Linux is not installed," run `wsl --install` (admin PowerShell, reboot required) before installing/starting Docker Desktop — otherwise Docker Desktop will fail its first-run check. Both `wsl --install` and the Docker Desktop installer need an elevated (admin) terminal.

## First-time setup

```bash
cp .env.example .env          # fill in real values (optional for local demo — see below)
npm install                   # installs web + api + packages workspaces (large tree, first run can take a while — see note)
npm run prisma:deploy --workspace=apps/api    # applies migrations against DATABASE_URL/DIRECT_URL (Supabase or local Postgres)
npm run prisma:seed --workspace=apps/api      # creates a demo org, admin user, and one niche filter
npm run dev:api                # http://localhost:4000 (builds packages/types first)
npm run dev:web                # http://localhost:3000 (builds packages/types first)

# AI workers (separate Python env)
cd apps/ai-workers
py -3 -m venv .venv && .venv\Scripts\activate        # macOS/Linux: python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
# On Windows, don't use --reload here — it hasn't reliably picked up code changes in practice;
# stop and restart the process manually after editing apps/ai-workers code instead.
```

**Database/queue setup used in practice on the reference dev machine:** Postgres via Supabase (`DATABASE_URL` = transaction pooler port 6543 with `?pgbouncer=true`, `DIRECT_URL` = session pooler port 5432, both in `schema.prisma`'s datasource block) rather than the bundled `infra/docker-compose.yml` Postgres; Redis via a standalone container (`docker run -d --name leadgen-redis -p 6379:6379 redis`) rather than the full compose stack. `npm run docker:up` (full compose: Postgres + Redis + all three services) is still there as an option if you'd rather not use Supabase.

Log in at `http://localhost:3000/login` with the seeded admin: `admin@example.com` / `ChangeMe123!`.

**First `npm install` can take a long time.** With no lockfile yet, npm has to resolve the full NestJS + Next.js + BullMQ dependency graph package-by-package against the registry — on a slow connection or a Windows machine with real-time antivirus scanning every extracted file, this has been observed taking 15–30+ minutes with **no console output in between** (npm's default log level is quiet until it finishes). That's expected, not a hang — check `Get-Process node` / `tasklist` shows CPU time slowly increasing rather than killing and restarting it.

## Demo mode (no API keys needed)

The Python AI workers run in a clearly-labeled **demo mode** for whichever piece doesn't have what it needs:
- `claude_agent/search_tools.py` and `claude_agent/scorer.py` use the local `claude` CLI (subscription login, see above) for real web-search-grounded lead-finding and scoring. If the CLI isn't installed/reachable on PATH, they fall back to a small fixed pool of synthetic candidate companies / a deterministic heuristic score instead (and the search fallback returns "no more candidates" once the pool is exhausted, exercising the same "niche saturated" shortfall path a real run would hit).
- `claude_agent/verifier.py` still does **real** HTTP verification (website reachability, LinkedIn URL reachability); only email verification falls back to a syntactic check without a `NEVERBOUNCE_API_KEY`.
- `gemini_agent/drafting.py` falls back to a deterministic, clearly-labeled `[DEMO DRAFT]` template instead of calling Gemini when `GOOGLE_GENAI_API_KEY` is unset.

This means the full pipeline — extraction → dedup → verify → score → insert → Sheets/ClickUp sync → Email 1 → wait → Email 2 → wait → Gemini draft → approval queue — is exercisable end-to-end locally with zero external credentials beyond a logged-in `claude` CLI. Swap in real keys in `.env` and nothing else needs to change.

## What's implemented vs. stubbed

> The list below predates the agent architecture and is kept for the detail it
> carries about individual subsystems. For **current** status —  what works, what
> doesn't, and what to build next — use [`docs/RESUME.md`](./docs/RESUME.md),
> which is maintained as the source of truth.

### Added since (2026-07-30/31)

- **Fully autonomous, event-driven pipeline**: a lead now walks itself from
  verification through `READY_FOR_OUTREACH` (Email #1 sends, LinkedIn draft
  generates) with no manual advance; the AI-drafted pitch (Email #3) sends
  itself by default (Settings toggle to require approval again)
- **Real-time dashboard**: a WebSocket gateway pushes lead/stage/agent-run/
  email events to every connected browser — no more polling or manual refresh
- Every AI-worker dispatch call now goes through a retrying BullMQ queue
  instead of a bare `fetch()`, with a **notifications** system (bell icon)
  that surfaces only once automatic retry is exhausted
- **Lead source layer** (`SURFACE_WEB`/`LICENSED_DATABASE`/`MANUAL`) and an
  **Agent review** section — the `agent_review` agent (14th agent) fills in
  the same fields Human review asks a person for, from its own research;
  manually-added leads now get the full research/scoring pipeline too
- Per-mailbox display name for outreach emails

### Added since (2026-07-28/29)

- **14 specialised agents behind a workflow orchestrator** with contract
  validation and classified failure — `docs/AGENT_ARCHITECTURE.md`
- **20-stage pipeline** matching the full sales flow, with the state machine
  shared between API and dashboard
- **Sales-Navigator-style filter taxonomy** (18 categories) feeding an explained
  search brief the model can actually act on
- **Six-dimension lead scoring** plus a priority roll-up
- **Four-identity duplicate detection** — domain, email, company name, LinkedIn,
  the last two via persisted normalised keys
- **Campaigns**, **agent telemetry**, **automation dashboard**, full
  **analytics** (email funnel, revenue pipeline, cohort trends, LinkedIn)
- **Manual lead entry**, **niche-filter delete**, **drag-and-drop pipeline**
- Auth refresh with single-flight rotation, route guard, dark mode that works
- **Team management, email-account admin UI, per-filter enrichment cost
  control, campaign↔filter linking, pipeline undo, lead delete, and CSV
  export** — see `docs/RESUME.md` for the full detail on each

### Maps to the roadmap in Part H1 of the architecture doc

**Implemented (Phase 0–3 territory, confirmed working against a live Supabase/Redis stack, not just against a placeholder DB):**
- Full Prisma schema matching the ERD (Part B4), including a `SuppressionEntry` table and a `RefreshToken` table not in the original diagram (added during implementation — see below)
- JWT auth + refresh-token rotation, RBAC guards, PII-redaction interceptor, audit-log interceptor, global exception filter with trace IDs
- Niche filters CRUD + run-now + **automatic daily scheduling**: a dynamic `CronJob` per niche filter (via `@nestjs/schedule`), keyed by that filter's own `scheduleCron`/`timezone`/`active` columns, registered on boot and re-registered on every create/update — this is what actually runs lead extraction daily rather than requiring a manual "Run now" click
- Leads CRUD, human-review fields, stage-transition validation against the Part C6 state machine, Email #3 approval queue
- Sequencer: BullMQ delayed jobs for the "wait 2 days" / "wait 1-2 days" steps, cancellable on reply (Part C6) — this is real, not a polling cron
- Email compliance gate: suppression-list check, unsubscribe-link check, per-mailbox daily-limit rotation, before every send (Part C6/I4/I5)
- Google Sheets sync (`apps/api/src/sync/google-sheets.client.ts`, real `googleapis` service-account auth), ClickUp sync (`apps/api/src/sync/clickup.client.ts`, real REST client) and webhook receivers (ClickUp stage-change, email open/click tracking, unsubscribe, reply/bounce/complaint ingestion) — real API calls, gated to log-only fallback if credentials aren't configured
- Gmail sending (real `googleapis` OAuth2 + MIME compose) and M365 sending via SMTP AUTH (`apps/api/src/email/providers/*.ts`) — real, credential-gated
- Dashboard: login, Overview (live KPIs + funnel chart against the real API), Leads list + detail with the review form, Pipeline (read-only Kanban), Sequences (Email #3 approval queue, mailbox health, send calendar), Settings (niche filter CRUD)
- AI workers: bounded extraction loop (Part C1 — stops on target/attempts/runtime, never loops forever), Gemini drafting + mandatory self-critique pass, both wired to call back into the NestJS API. Lead-finding/scoring runs on the local Claude Code CLI (see "Prerequisites" above), not the Anthropic API.
- Full analytics: `/analytics/email-funnel`, `/linkedin-funnel`, `/revenue-pipeline` and `/cohort-trends` on the API, and a real `/analytics` page consuming all four (email-tracking board overall and per sequence step, daily trend series, pipeline value by stage, LinkedIn status funnel). Engagement counts are `COUNT(DISTINCT message_id)`, so a recipient who opens the same email five times counts once and open rate can't exceed 100%. The rate arithmetic lives in `analytics.math.ts` and is unit-tested independently of the database
- An internal-token-guarded lead-detail read endpoint (`GET /leads/:id/internal`) so the Gemini agent can fetch lead context without a user JWT — the original design reused the user-scoped route, which 401'd for a service account; fixed by adding this separate route rather than weakening the user-facing guard.

**Stubbed / needs real credentials before going live:**
- Gmail/Graph push-notification adapters translate provider payloads into the normalized ingestion endpoint for opens/clicks/replies, but Graph's NDR/bounce parsing specifically isn't implemented yet (flagged in code, not faked)
- LinkedIn — intentionally out of scope for now (see below)

**Not yet built:**
- ClickUp/Sheets connection config UI — creds are still env-var-only (the email-accounts and user/role admin UIs this bullet used to also list are both built now — see `docs/RESUME.md`)
- Self-service password change/reset for Team accounts — an admin sets the password at creation and hands it over directly
- Fuzzy/semantic duplicate detection — current dedup relies only on exact-match Postgres unique constraints (email, website domain), no near-duplicate (e.g. company-name-similarity) layer
- **LinkedIn automation is intentionally not planned** — real LinkedIn browser/API automation risks ToS violations and account bans; only the data model (`LinkedinActivity`) and a status field exist, with no automation or update endpoint by design, not oversight
- Multi-tenant row-level security, the AI improvement/feedback loop (Part D5), Next.js auth middleware (unauthenticated users currently just see raw 401s rather than a redirect to `/login`)

## Implementation notes / deviations from the design doc

A few things surfaced while building this that are worth knowing before you extend it:

1. **`bcryptjs` instead of `bcrypt`.** The design doc doesn't specify a hashing library; `bcrypt` (native, via node-gyp) was the initial choice but its build step depends on a working Python toolchain for node-gyp, which hung indefinitely on a Windows dev machine with an inconsistent `python`/`python3` PATH setup (the Microsoft Store alias stub). Switched to `bcryptjs` (pure JS, same API) to remove that class of environment problem entirely. Revisit if hashing throughput ever becomes a bottleneck — it won't at this scale.
2. **System-driven stage transitions bypass `LeadsService.advanceStage`'s validation on purpose.** The sequencer (Email 1/2 sent, Gemini drafting) and the reply webhook update `PipelineState` directly rather than going through the human-facing `advanceStage` endpoint, because they're system transitions already known to be valid — but this means each of those call sites is also individually responsible for calling `SyncService.onStageChanged` so ClickUp stays in sync (Part C5's "the card always reflects real state even though a human never touched it" requirement). This was actually missed on the first pass — Email #1 sending didn't advance the pipeline stage at all (so the Email #2 wait-timer never got scheduled), and none of the internal transitions were pushed to ClickUp. Both are fixed in `apps/api/src/sequencer/sequencer.service.ts`, `apps/api/src/leads/leads.service.ts`, and `apps/api/src/webhooks/email-webhook.controller.ts`. If you add a new internal stage transition, remember both halves: update `PipelineState` **and** call `sync.onStageChanged`.
3. **Refresh tokens and the suppression list are real tables, not deferred.** The original ERD (Part B4) didn't include `RefreshToken` or `SuppressionEntry` as separate models; both turned out to be required for the auth rotation design (Part E4) and the compliance gate (Part C6/I4/I5) to actually work, so they were added to `apps/api/prisma/schema.prisma`.
4. **Two migrations are checked in** (`20260727000000_init`, `20260727200000_sync_and_email_provider_fields`) — both have since been applied for real against a live Supabase Postgres instance via `npm run prisma:deploy --workspace=apps/api` (2026-07-27), not just validated schema-only.
5. **The Claude CLI argv trap (Windows).** The prompt is piped to `claude` on **stdin**, never passed as an argv element. On Windows `shutil.which("claude")` resolves to `claude.CMD` — an npm batch shim — so `subprocess.run` executes it through `cmd.exe`, and cmd.exe's parser stops at the first newline in the command line. The search prompts are multi-line, so `-p <prompt>` truncated the command and silently dropped **every flag after it**: without `--output-format json` stdout came back as raw prose instead of the JSON envelope, and without `--allowed-tools`/`--permission-mode` the model's WebSearch calls were denied and it returned an apology. Nothing errored — it just produced unusable output. If you add another CLI invocation, keep every argv element newline-free.
6. **Demo lead data is off by default and should stay that way.** `search_tools.find_candidate` can substitute synthetic `[DEMO DATA]` companies when the CLI is unavailable, which keeps the downstream pipeline exercisable — but those rows land in the real `leads` table and are indistinguishable from genuine leads once inserted, against the spec's "only verified leads" requirement. It is now gated behind `ALLOW_DEMO_FALLBACK` (default `false`); with it disabled a CLI failure aborts the run and records `FAILED` plus the reason on `extraction_runs.error` rather than quietly manufacturing leads. Enable it only against a throwaway database.
7. **`DIRECT_URL` was added to the Prisma datasource** alongside `DATABASE_URL` — needed because Supabase's connection pooler (`DATABASE_URL`, transaction mode, port 6543) doesn't support the prepared statements Prisma's migration engine needs; `DIRECT_URL` (session mode, port 5432) is used for migrations only, while the app itself connects through the pooler.

## Build validation status

Verified directly, end to end, not just via CI config:
- `npm run build:types` — shared types package compiles clean
- `npx prisma validate` / `prisma generate` — schema is valid, client generates clean
- `npm run build --workspace=apps/api` / `npx tsc --noEmit` — NestJS API compiles clean (TypeScript)
- `npm test --workspace=apps/api` — 37/37 across 4 suites (`pipeline-transitions.spec.ts`, `analytics.math.spec.ts`, `dedup.spec.ts`, `search-brief.spec.ts`)
- `npm run build --workspace=apps/web` — Next.js production build compiles and prerenders all routes clean
- **`prisma migrate deploy` and `prisma:seed` run for real against a live Supabase Postgres instance** (as of 2026-07-27) — both migrations applied cleanly, seed creates the demo org/admin/niche filter
- **All three services confirmed running together and talking to each other for real**: `apps/api` (port 4000) boots against Supabase with zero errors, `apps/ai-workers` (port 8000) and `apps/web` (port 3000) both healthy, admin login works end-to-end through the real UI
- The niche-filter cron scheduler registers correctly on boot (confirmed via log: `Scheduled N active niche filter(s) on startup`) and a manual `POST /niche-filters/:id/run-now` successfully dispatches to the AI workers and creates an `ExtractionRun` row

**Real lead discovery is confirmed working as of 2026-07-28.** A live extraction run against the seeded Healthcare filter returned Technology Rivers, Light IT, Arkenea, Tateeda, Leobit, Omada Health, ScienceSoft and Lark — real companies, each with its website fetched and its LinkedIn company page reachability-checked. See "The Claude CLI argv trap" below for the bug that was blocking this.

**Remaining unconfirmed issue:** after several successful web-search turns the CLI intermittently exits 1 with *both* stdout and stderr empty. It is not reproducible with short prompts (5 sequential and 4 concurrent short calls all succeed at the same moment), which points at subscription rate limiting on the expensive WebSearch turns rather than a defect in how the CLI is invoked — but that is a hypothesis, not a confirmed root cause. It is mitigated rather than fixed: `cli_client.query()` retries 3× with 2/4/8s exponential backoff, all invocations are gated through a concurrency semaphore, and the raised error now carries both streams so the next occurrence is diagnosable.
