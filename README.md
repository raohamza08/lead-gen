# Lead Generation & Client Acquisition Platform

AI-powered internal platform for lead sourcing, qualification, personalization, outreach, and analytics. Full design is in [`lead-gen-system-architecture.md`](./lead-gen-system-architecture.md) (also published as a shareable doc — ask if you need the link again).

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
- API keys: Anthropic (Claude), Google AI (Gemini), ClickUp, Google service account, mail provider — see `.env.example`. **None of these are required to run the scaffold locally** — see "Demo mode" below.

**Windows note:** if `python`/`python3` on PATH resolve to the Microsoft Store stub instead of a real install, use `py -3` instead (`py -3 -m venv .venv`, etc.).

**Windows + Docker Desktop note:** Docker Desktop requires WSL2 as its backend. If `wsl --status` reports "Windows Subsystem for Linux is not installed," run `wsl --install` (admin PowerShell, reboot required) before installing/starting Docker Desktop — otherwise Docker Desktop will fail its first-run check. Both `wsl --install` and the Docker Desktop installer need an elevated (admin) terminal.

## First-time setup

```bash
cp .env.example .env          # fill in real values (optional for local demo — see below)
npm install                   # installs web + api + packages workspaces (large tree, first run can take a while — see note)
npm run docker:up             # starts Postgres + Redis
npm run prisma:migrate --workspace=apps/api   # creates DB schema
npm run prisma:seed --workspace=apps/api      # creates a demo org, admin user, and one niche filter
npm run dev:api                # http://localhost:4000 (builds packages/types first)
npm run dev:web                # http://localhost:3000 (builds packages/types first)

# AI workers (separate Python env)
cd apps/ai-workers
py -3 -m venv .venv && .venv\Scripts\activate        # macOS/Linux: python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Log in at `http://localhost:3000/login` with the seeded admin: `admin@example.com` / `ChangeMe123!`.

**First `npm install` can take a long time.** With no lockfile yet, npm has to resolve the full NestJS + Next.js + BullMQ dependency graph package-by-package against the registry — on a slow connection or a Windows machine with real-time antivirus scanning every extracted file, this has been observed taking 15–30+ minutes with **no console output in between** (npm's default log level is quiet until it finishes). That's expected, not a hang — check `Get-Process node` / `tasklist` shows CPU time slowly increasing rather than killing and restarting it.

## Demo mode (no API keys needed)

The Python AI workers run in a clearly-labeled **demo mode** whenever `ANTHROPIC_API_KEY` / `GOOGLE_GENAI_API_KEY` are unset:
- `claude_agent/search_tools.py` returns a small fixed pool of synthetic candidate companies instead of doing a real web search (and returns "no more candidates" once the pool is exhausted, exercising the same "niche saturated" shortfall path a real run would hit).
- `claude_agent/verifier.py` still does **real** HTTP verification (website reachability, LinkedIn URL reachability); only email verification falls back to a syntactic check without a NeverBounce/ZeroBounce key.
- `claude_agent/scorer.py` and `gemini_agent/drafting.py` fall back to a deterministic, clearly-labeled `[DEMO ...]` heuristic instead of calling Claude/Gemini.

This means the full pipeline — extraction → dedup → verify → score → insert → Sheets/ClickUp sync stubs → Email 1 → wait → Email 2 → wait → Gemini draft → approval queue — is exercisable end-to-end locally with zero external credentials. Swap in real keys in `.env` and nothing else needs to change.

## What's implemented vs. stubbed

Maps to the roadmap in Part H1 of the architecture doc.

**Implemented (Phase 0–3 territory):**
- Full Prisma schema matching the ERD (Part B4), including a `SuppressionEntry` table and a `RefreshToken` table not in the original diagram (added during implementation — see below)
- JWT auth + refresh-token rotation, RBAC guards, PII-redaction interceptor, audit-log interceptor, global exception filter with trace IDs
- Niche filters CRUD + run-now (dispatches to the AI workers service)
- Leads CRUD, human-review fields, stage-transition validation against the Part C6 state machine, Email #3 approval queue
- Sequencer: BullMQ delayed jobs for the "wait 2 days" / "wait 1-2 days" steps, cancellable on reply (Part C6) — this is real, not a polling cron
- Email compliance gate: suppression-list check, unsubscribe-link check, per-mailbox daily-limit rotation, before every send (Part C6/I4/I5)
- Sheets/ClickUp sync workers and webhook receivers (ClickUp stage-change, email open/click tracking, unsubscribe, reply/bounce/complaint ingestion) — provider API calls are stubbed and logged (see TODOs in `apps/api/src/sync/`), the queueing/idempotency/state machine around them is real
- Dashboard: login, Overview (live KPIs + funnel chart against the real API), Leads list + detail with the review form, Settings (niche filter CRUD)
- AI workers: bounded extraction loop (Part C1 — stops on target/attempts/runtime, never loops forever), Gemini drafting + mandatory self-critique pass, both wired to call back into the NestJS API

**Stubbed / needs real credentials before going live:**
- Google Sheets and ClickUp API calls (`apps/api/src/sync/*.worker.ts`) log intent instead of calling the real APIs
- Gmail/SMTP sending (`apps/api/src/email/providers/*.ts`) logs intent instead of sending
- Gmail/Graph push-notification adapters for delivery/bounce/reply events (`apps/api/src/webhooks/email-webhook.controller.ts`) — the normalized ingestion endpoint exists, provider-specific translation doesn't yet
- LinkedIn semi-automation (Part C7) — only the manual task-creation half exists

**Not yet built:** analytics beyond the Overview KPIs/funnel (Part F1's Pipeline/Sequences/Analytics tabs are placeholder pages pointing at the relevant backend code), multi-tenant row-level security, the AI improvement/feedback loop (Part D5).

## Implementation notes / deviations from the design doc

A few things surfaced while building this that are worth knowing before you extend it:

1. **`bcryptjs` instead of `bcrypt`.** The design doc doesn't specify a hashing library; `bcrypt` (native, via node-gyp) was the initial choice but its build step depends on a working Python toolchain for node-gyp, which hung indefinitely on a Windows dev machine with an inconsistent `python`/`python3` PATH setup (the Microsoft Store alias stub). Switched to `bcryptjs` (pure JS, same API) to remove that class of environment problem entirely. Revisit if hashing throughput ever becomes a bottleneck — it won't at this scale.
2. **System-driven stage transitions bypass `LeadsService.advanceStage`'s validation on purpose.** The sequencer (Email 1/2 sent, Gemini drafting) and the reply webhook update `PipelineState` directly rather than going through the human-facing `advanceStage` endpoint, because they're system transitions already known to be valid — but this means each of those call sites is also individually responsible for calling `SyncService.onStageChanged` so ClickUp stays in sync (Part C5's "the card always reflects real state even though a human never touched it" requirement). This was actually missed on the first pass — Email #1 sending didn't advance the pipeline stage at all (so the Email #2 wait-timer never got scheduled), and none of the internal transitions were pushed to ClickUp. Both are fixed in `apps/api/src/sequencer/sequencer.service.ts`, `apps/api/src/leads/leads.service.ts`, and `apps/api/src/webhooks/email-webhook.controller.ts`. If you add a new internal stage transition, remember both halves: update `PipelineState` **and** call `sync.onStageChanged`.
3. **Refresh tokens and the suppression list are real tables, not deferred.** The original ERD (Part B4) didn't include `RefreshToken` or `SuppressionEntry` as separate models; both turned out to be required for the auth rotation design (Part E4) and the compliance gate (Part C6/I4/I5) to actually work, so they were added to `apps/api/prisma/schema.prisma`.
4. **An initial SQL migration is checked in even though no live Postgres was available in the build environment.** `apps/api/prisma/migrations/20260727000000_init/migration.sql` was generated with `prisma migrate diff --from-empty` (schema-only, no DB connection needed) and validated with `prisma validate`. It hasn't been applied against a live database yet — do that once with `npm run prisma:deploy --workspace=apps/api` (or `prisma:migrate` for a dev DB) the first time you point this at a real Postgres instance.

## Build validation status

Verified directly, end to end, not just via CI config:
- `npm run build:types` — shared types package compiles clean
- `npx prisma validate` / `prisma generate` — schema is valid, client generates clean; `prisma migrate diff --from-empty` produced a working initial migration (see note above) without needing a live DB
- `npm run build --workspace=apps/api` — NestJS API compiles clean (TypeScript)
- `npm run lint --workspace=apps/api` — clean (fixed 3 real lint errors: an unused destructured variable in `analytics.service.ts`, a `let` that should've been `const` in `clickup-sync.worker.ts`, an unused import in `tracking.controller.ts`)
- `npm test --workspace=apps/api` — the `pipeline-transitions.spec.ts` suite passes (4/4)
- `npm run build --workspace=apps/web` — Next.js production build compiles and prerenders all 11 routes clean (fixed 2 real ESLint errors: unescaped `'`/`"` in JSX text in `analytics/page.tsx` and `leads/[id]/page.tsx`)
- `npm run lint --workspace=apps/web` — clean
- Also fixed one real TypeScript error caught by the API build: a `Record<string, unknown>` wasn't directly assignable to Prisma's `InputJsonValue` in `email-webhook.controller.ts`'s `meta` field — needed an explicit cast (same pattern already used elsewhere for JSON fields)

**Not yet verified (needs a real Postgres/Redis — Docker Desktop install in progress on this dev machine as of 2026-07-27):** `prisma migrate deploy` actually applying to a live DB, the seed script, and any runtime behavior of the API/web/ai-workers servers talking to each other and a real database. Everything else that doesn't need a live DB has been verified directly, not just via CI config: `npm install`, `build:types`, `prisma validate`/`generate` (against a placeholder `DATABASE_URL`), `apps/api` build+lint+test (4/4 pass), `apps/web` build+lint (all 11 routes prerender clean). The demo-mode AI workers service *was* run live (see "Demo mode" above) and confirmed working, including its fire-and-forget callback into the (not-yet-running) NestJS API failing gracefully rather than crashing. Once Docker Desktop is installed, run `npm run docker:up`, `npm run prisma:migrate --workspace=apps/api`, and `npm run prisma:seed --workspace=apps/api` to close this last gap.
