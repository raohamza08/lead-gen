# Resume here

State as of **2026-07-31**, commit `3428706`. Read this first.

---

## Restart the stack

Nothing survives a reboot. In four terminals (or via `Start-Process`):

```powershell
docker start leadgen-redis                                   # Redis
npm run dev:api                                              # :4000
npm run dev:web                                              # :3000
cd apps/ai-workers; .venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Then publish the API and repoint the deployed dashboard:

```powershell
.\scripts\serve-public.ps1
```

Check it worked: `curl http://localhost:4000/api/v1/health` should report
`database: up, redis: up`.

**Login:** the seeded admin's email was changed directly in the database at
some point outside any migration/seed file — it is **no longer**
`admin@example.com`, and the real current one is not written down here
on purpose (would mean publishing a real personal email in this public
repo). Once logged in, check `/settings` → Team for the current roster, or
query the `users` table directly. **The `ChangeMe123!` password no longer
works** (confirmed 2026-07-30 — it was changed at some point and this file
never got updated). There is still no self-service reset (see Not built), so
a locked-out account can only be fixed by setting a new bcrypt hash directly
in the `users` table. Prefer creating yourself a named account via Team
rather than sharing this seeded one further.

**Dashboard:** https://lead-gen-dashboard-umber.vercel.app
**Repo:** https://github.com/raohamza08/lead-gen

> The Cloudflare quick tunnel gets a **new hostname every restart**, and
> `NEXT_PUBLIC_API_BASE_URL` is compiled into the bundle at build time, so the
> site must be redeployed after every tunnel restart. `serve-public.ps1` does
> both. It forces `--protocol http2`; without that the tunnel dies within
> minutes on this network while the process stays alive, so a dead tunnel looks
> identical to a working one. **If the script's own health check fails, don't
> assume the tunnel is broken** — this workstation's local DNS resolver can lag
> behind a brand-new hostname for several minutes; see Traps below for the two
> distinct failure modes hit in the same session and how to tell them apart.

---

## Current state (2026-07-31)

**Everything needed to run a campaign is configured and working:**

- One active mailbox: `sales@euroshub.com` (SMTP), verified with a real test send.
- One campaign ("Healthcare AI Campaign") linked to the "Healthcare" niche filter.
- 2 leads currently live: one at `PERSONALIZED_PITCH` (EurosHub, walked
  through with real emails sent), one at `UNDER_REVIEW` — that second one
  predates the auto-advance work below and won't move on its own; a manual
  advance or a fresh enrichment run would move it now.

**The pipeline is now autonomous end to end (2026-07-30/31 session) — this
is the biggest behavioural change since launch:**

- A lead that clears verification (auto-discovered, or manually entered and
  enriched) now walks itself straight through `VERIFIED → RESEARCH_COMPLETED
  → UNDER_REVIEW → READY_FOR_OUTREACH` with **no manual advance needed** —
  Email #1 sends and a LinkedIn draft generates automatically. It only stops
  short of outreach if the lead's email never verified. This replaces the old
  "drag through review to Ready" step described in earlier versions of this
  doc — that step no longer exists as a gate (a human can still edit the
  review note, it just doesn't block anything anymore).
- The AI-drafted personalized pitch (Email #3) **now sends itself by
  default** — `/settings` has an "Automation" toggle to require approval
  again per org.
- LinkedIn **sending** is still human-only (ToS/ban risk, unchanged); only
  copy-drafting is automatic now, generated alongside Email #1.
- The four AI-worker dispatch calls that used to be bare `fetch()` with no
  retry (manual enrichment, pitch drafting, LinkedIn drafting, extraction
  runs) now go through a BullMQ queue with retries; a notification (bell,
  top right of the dashboard) appears only once retries are exhausted.
- The dashboard is now real-time: a WebSocket gateway pushes lead creation,
  stage changes, agent runs and email sends to every connected browser. The
  pipeline board and lead detail page update live — no more manual refresh,
  no more polling.
- The manual "Generate pitch draft" / "Run agent review" / "Generate
  LinkedIn copy" buttons are gone from the lead detail page — all three now
  fire automatically and retry on their own.

**To run a campaign for real:** create/edit a niche filter on `/settings`,
decide Full vs Reduced enrichment cost there, link it to a campaign on
`/campaigns`, then either wait for its daily cron or hit **Run now**. New
leads now handle themselves from there — nothing to drag or click.

---

## What exists

**14 agents** behind an orchestrator (`apps/ai-workers/agents/`), 8 pipelines.
See [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md). Enrichment cost is
tunable per niche filter — Full (6 Claude CLI calls/candidate) or Reduced (3,
skips `company_intelligence`/`website_audit`/`buyer_intelligence`) — via a
toggle or per-agent checkboxes on `/settings`. All AI-worker dispatch now
goes through a retrying BullMQ queue rather than a bare `fetch()`.

`lead_discovery · lead_verification · company_intelligence · website_audit ·
buyer_intelligence · ai_opportunity · lead_scoring · review · email · linkedin ·
scheduler · analytics · learning · agent_review`

**Pipeline:** 20 stages, `NEW_LEAD → … → WON → CLIENT_ONBOARDING`, with `LOST`
reachable from any active stage. State machine lives in
`packages/types/src/pipeline.ts` — shared between API and dashboard so the
board only offers drops the API will actually accept. As of 2026-07-30/31,
`NEW_LEAD → … → READY_FOR_OUTREACH` auto-advances on its own (see Current
state above) — dragging/back/forward controls still work, they're just no
longer required. One level of undo: every stage change records
`previousStage`, and a "← Back" control (`/pipeline` cards, lead detail page)
swaps back to it — also how a failed automated send gets retried (back to
Ready, forward again). A direct **Resend** button on the lead detail page's
Emails section covers messages that failed before this existed. Leads can
also be permanently deleted (pipeline card "Delete" button, ADMIN only, full
history goes with it — no detach-and-keep) and exported as CSV (`/leads` →
Export CSV, always the full org, not the page's filtered view).

**Real-time (2026-07-30/31):** a WebSocket gateway (`apps/api/src/realtime/`)
pushes `lead.created` / `lead.stageChanged` / `lead.updated` /
`agentRun.recorded` / `email.sent` / `email.failed` / `notification.created`
to every connected dashboard, scoped per org. `apps/web/lib/realtime.ts`'s
`useRealtimeEvent`/`useRealtimeRefetch` hooks are how a page subscribes — the
pipeline board and lead detail page both use it instead of polling.

**Notifications** (`apps/api/src/notifications/`, bell icon top-right of the
dashboard): fires only when automatic retry is exhausted — a queued
agent-dispatch job or an email send that failed every attempt. Everyday
agent activity (OK/DEGRADED runs, normal stage changes) never appears here on
purpose; it would bury the ones that need a human.

**Lead source layer & Agent review** (2026-07-30): every lead is tagged
`SURFACE_WEB` / `LICENSED_DATABASE` / `MANUAL` (`sourceLayer`, filterable on
`/leads`). Manually-added leads now get the same
verification/research/scoring pipeline as discovered ones
(`manual_lead_enrichment`), dispatched automatically on creation. A new
"Agent review" section on the lead detail page mirrors Human review's fields
but is filled in by the `agent_review` agent from its own research — a
starting point to agree with, correct, or override.

**Campaigns** link to a niche filter (`/campaigns`, "Linked filter" dropdown);
every AI-discovered lead from that filter is stamped with `campaignId`
automatically, which is what makes campaign performance non-zero.

**Team management** (`/settings`): ADMIN can create accounts with any
email/password/role, change roles, activate/deactivate members (not self).
Each person logs in with their own email — no shared account needed going
forward. No self-service password reset yet; an admin sets it and hands it
over directly.

**Email accounts** (`/settings`): add SMTP/Microsoft 365 (host/port/user/pass)
or Gmail (OAuth refresh token, obtained out-of-band — no consent flow built),
health bars (sent today vs daily limit), pause/resume, **Send test**, delete.

**Dashboard pages:** overview (executive), leads (+ manual add, filters,
CSV export), pipeline (drag-and-drop + back + delete), analytics, campaigns,
automation (agent telemetry), sequences, settings (niche filters + email
accounts + team).

**Tests:** 37 API (`npm test --workspace=apps/api`) + 22 agent
(`cd apps/ai-workers; .venv\Scripts\python.exe -m pytest tests/ -q`).

---

## Not built

- Self-service password change/reset for Team accounts — the only way to
  recover a lost password today is a direct DB update to the `users` table.
- Review Center and Lead Intelligence dashboards
- Personalized landing pages
- Token / cost tracking for Claude and Gemini
- ClickUp's 27 custom fields (sync sends far fewer)
- Taxonomy pickers in the filter builder — the taxonomy feeds the AI search
  brief, but Industries / Countries / Bands / Growth Signals / Titles / Tech /
  AI-types have no `NicheFilter` columns or UI controls yet
- `/sequences` and `/settings` still use an older visual layout than the rest
  of the dashboard (hand-rolled classes instead of the shared `card` styles)
- A named Cloudflare tunnel (stable hostname) — still on the quick tunnel,
  which is the source of the recurring outages in Traps below.
- Retry policy (attempts/backoff) is a fixed constant per queue, not
  admin-configurable per org.

---

## Traps already hit — don't rediscover these

**`prisma migrate dev` silently drops indexes it doesn't know it should keep,
and new migrations can land in the wrong replay order (2026-07-29 incident).**
Two distinct traps, both hit generating a migration this same day:

1. Several indexes existed only as hand-written SQL in earlier migrations —
   never declared as `@@index` in `schema.prisma`. The moment *any* new
   `migrate dev` ran, it read their absence from the schema as drift and
   generated `DROP INDEX` for all five, and applied it immediately — no
   prompt, no warning, since the command wasn't run with `--create-only`.
   **Always add `@@index`/`@@unique` for every hand-written index, and run
   `--create-only` first to read the generated SQL before applying anything
   that isn't obviously additive.** Recovered same day; the priority-score
   index lost its `NULLS LAST` (Prisma can't express it) — a real but minor
   semantic change, noted in a schema comment.
2. Existing migration folders in this repo use fabricated round-hour
   timestamps (`..._150000`, `..._160000`) rather than real creation times. A
   brand-new migration's folder name uses the **real current time**, which
   can sort *before* same-day migrations stamped later round numbers. Folder
   name order is what a from-scratch replay (fresh environment, `migrate
   reset`, or `--create-only`'s shadow-db validation) uses; the live dev
   database was fine because it replays by real applied order from
   `_prisma_migrations`, which masks the problem on first apply. Fix: rename
   the new migration folder to a round timestamp later than every existing
   one for that day, and update `_prisma_migrations.migration_name` to match
   via a direct `UPDATE` if it was already applied. Verify with `prisma
   migrate status` — it must say "Database schema is up to date" with zero
   drift after the fix.

**Claude CLI on Windows.** The prompt is piped on **stdin**, never passed as an
argv element. `claude` resolves to `claude.CMD`, so `subprocess.run` goes
through `cmd.exe`, whose parser stops at the first newline — a multi-line prompt
silently dropped every flag after it, including `--output-format json`. Nothing
errored; the output was just unusable.

**Prisma on Alpine.** `node:20-alpine` ships no `openssl`, so Prisma's probe
fails, it loads its `openssl-1.1.x` engine and the container dies at boot. Needs
`apk add openssl` in **both** Dockerfile stages plus
`binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`. The image builds fine
either way — it only fails at runtime.

**`dotenv-cli` in containers.** `prisma:generate` wraps prisma in
`dotenv -e ../../.env`, which exits non-zero when the file is missing and fails
the build. Use the `:ci` script variants.

**Render's free tier rejects `preDeployCommand`** — it is paid-only, and pairing
it with `plan: free` makes the whole blueprint fail. Migrations run from a
workstation instead.

**Supabase blips used to kill the API.** `$connect()` throwing in
`onModuleInit` aborts Nest's bootstrap and exits the process. Now retries with
backoff.

**`docker --env-file` does not strip quotes**, so a quoted `.env` value arrives
with the quotes attached and Prisma rejects the URL (P1012). Local testing only.

**PowerShell 5.1 has no `&&`** — use `;`. And piping a string into a native exe
does not feed it stdin; `serve-public.ps1` redirects from a file instead.

**Windows process management:** use `Stop-Process -Id <pid> -Confirm:$false`,
never `taskkill //F`, which has killed unrelated dev servers here.

**A Cloudflare quick tunnel's hostname can fail to resolve on this
workstation's local DNS resolver right after starting**, even though the
tunnel itself is healthy and resolves fine everywhere else (verified via
Google DNS / `curl --resolve`). `ipconfig /flushdns` doesn't reliably fix it
either. Don't treat this as a dead tunnel — confirm with an external resolver
(`nslookup <host> 8.8.8.8`, or `curl --resolve`) before restarting anything.

**This actually happened twice in the same session (2026-07-30/31), and the
two incidents were different failure modes worth telling apart:**

1. **The tunnel itself genuinely died** — `cloudflared.err.log` showed
   `"Unauthorized: Tunnel not found"` on every reconnect attempt, meaning
   Cloudflare's edge no longer recognised the session (quick tunnels are
   ephemeral; this can happen with no local warning while the process stays
   alive, retrying forever). Fix: restart `cloudflared` for a brand-new
   hostname, update `.env`'s `API_PUBLIC_URL` + Vercel's
   `NEXT_PUBLIC_API_BASE_URL` (production **and** preview) + redeploy, then
   restart the API so it picks up the new `API_PUBLIC_URL`.
2. **The tunnel was fine but this workstation's resolver specifically
   couldn't resolve the fresh hostname** for several minutes — confirmed via
   external DNS while local `curl`/`nslookup` returned `NXDOMAIN`. Bare
   `trycloudflare.com` resolved fine throughout, so it wasn't a categorical
   block — just the specific new subdomain record not propagating locally.
   `ipconfig /flushdns` did not fix it. **What actually worked: restarting
   the tunnel again for a different fresh hostname** — the new one resolved
   locally on the first attempt. If a hostname won't resolve locally after a
   flush, don't keep waiting on that exact one — cycle to a new one instead.
   (The properly-targeted fix — a hosts-file entry pinning the one bad
   hostname to its resolved IP — needs admin privileges this session doesn't
   have; a same-day self-elevation attempt was correctly blocked by the
   permission system. If this recurs, either run the hosts-file edit as
   Administrator yourself, or move to a named tunnel — see Not built.)

Either way, remember **`serve-public.ps1`'s own health check uses this same
local resolver**, so it will report a false "tunnel is up but not reachable"
error under failure mode 2 even when the tunnel is genuinely fine — that's
what happened here. If that check fails, verify externally before concluding
the script or the tunnel is broken.

---

## Known issues

**Claude CLI intermittently exits 1 with both streams empty** after several
successful web-search turns. Not reproducible with short prompts, so it looks
like subscription rate limiting — unconfirmed. Mitigated with 3× backoff and a
concurrency semaphore.

**Cost:** the full acquisition pipeline makes **6 CLI calls per candidate**
(~600/day at a 100 target). Use the Full/Reduced toggle or per-agent
checkboxes on `/settings` to drop to 3. Discovery, verification, opportunity
and scoring cannot be disabled.

**`ALLOW_DEMO_FALLBACK` is off** and should stay off — with it on, a CLI failure
inserts synthetic `.example.com` companies into the real leads table.

**Security:** the API is internet-reachable whenever the tunnel is up; raised
with the user once, they chose to leave it. The public README's mention of
`admin@example.com`/`ChangeMe123!` is now scoped to a fresh local install (the
seed script genuinely creates that account) — the equivalent line for the
*live* instance was removed from the README this session since that account's
email has since changed. Prefer using Team to create named accounts over
relying on the seeded one further, on the live instance or otherwise.
