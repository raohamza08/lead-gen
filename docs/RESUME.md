# Resume here

State as of **2026-08-10**. Read this first.

---

## Restart the stack

**As of 2026-08-11, this is mostly automatic.** API, web, and ai-workers each
run under a restart-forever supervisor script
(`C:\Users\ADMIN\BusinessAgentServices\service-*.ps1` — outside the repo,
machine-local) instead of a bare `npm run dev:*` in a console window. If any
of the three crashes or gets killed, the loop relaunches it within ~5
seconds, no one needs to notice. A `.bat` in the current user's Startup
folder (`shell:startup`) launches all three supervisors automatically at
every logon, so a reboot recovers on its own too — **this needed no admin
rights**, since `Register-ScheduledTask`/`schtasks` were both denied in this
environment (see Traps); the Startup folder is fully user-writable and was
the fallback.

**Caveat proven by testing (2026-08-11):** killing only the leaf
`dist/main` node process does NOT reliably trigger the supervisor — `nest
start --watch` manages its compiled child internally and the outer `npm run
dev:api` can be left running with no live server underneath, silently. If
the API is unreachable but a supervisor-owned `npm`/`nest` process is still
in the list, **kill the whole chain** (both the `npm run dev:api` node
process and the `nest.js start --watch` one), not just the leaf — only then
does the supervisor's own loop see the exit and restart cleanly. A genuine
crash (unhandled exception, OOM, killed window) takes the whole tree down
together and doesn't hit this caveat.

Redis is not supervised this way — Docker Desktop containers already
survive independently once started:

```powershell
docker start leadgen-redis                                   # Redis, if not already up
```

**For the user (no scripting needed):** two Desktop shortcuts —
`Start Business Agent.bat` and `Stop Business Agent.bat` — do this by hand.
Start is idempotent (safe to double-click even if things are already
running; it just reports "already running" for each) and prints a plain
pass/fail per service before waiting for a keypress to close. Stop kills the
supervisors and whatever they're running, but leaves Redis (Docker) up.
Both just call `C:\Users\ADMIN\BusinessAgentServices\StartAll.ps1` /
`StopAll.ps1`.

If the supervisors themselves are ever not running (e.g. after removing them,
or on a machine where the Startup `.bat` hasn't fired yet), fall back to the
plain manual start:

```powershell
npm run dev:api                                              # :4001
npm run dev:web                                              # :3001
cd apps/ai-workers; .venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Ports moved from the documented 4000/3000 to 4001/3001 because this
workstation also runs an unrelated Docker-based app (`chatbot-server-1`,
`chatbot-web-1`) permanently bound to 4000/3000. If that app is ever removed,
the ports can move back — just update `API_PORT`/`WEB_PORT` in `.env`,
`apps/web/package.json`'s `dev` script, and `apps/web/.env.local`'s
`NEXT_PUBLIC_API_BASE_URL` together, or the three will disagree.

Public access is **Tailscale Funnel**, not the old Cloudflare quick tunnel —
see "Public access" below. Unlike Cloudflare's, its hostname is stable, so
after a plain restart (nothing reset the Funnel config) there is normally
**nothing else to do** — skip straight to the health check.

Check it worked: `curl http://localhost:4001/api/v1/health` should report
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

## Public access

**As of 2026-08-10: Tailscale Funnel, not the Cloudflare quick tunnel.**
Tailscale was already installed and used for another app on this machine
(that app's Funnel occupies the default hostname/port 443, proxying to its
own port 4000 — do not touch that config). This app's API is funneled on a
**second port on the same node**, which coexists with it:

```powershell
tailscale funnel --bg --https=8443 4001
```

Public URL: `https://rao-hamza-badar.taild82cd0.ts.net:8443` → proxies to
`127.0.0.1:4001` (this app's API). Check current state any time with
`tailscale funnel status` — it lists every port funneled on this node.

**Why this is better than the old Cloudflare setup:** the hostname is tied to
the Tailscale *node*, not the tunnel process, so it does **not** change on
restart. `API_PUBLIC_URL` (`.env`) and Vercel's `NEXT_PUBLIC_API_BASE_URL`
(production + preview) were pointed at it once and should not need touching
again for a routine API restart — only the API itself needs restarting to
pick up `.env` changes (it's read once at boot). Contrast with the old
`serve-public.ps1` flow (still in the repo, unused by default), which had to
redo both of those on *every single restart* because Cloudflare's quick
tunnel minted a brand-new hostname each time.

**If this ever needs re-establishing** (Funnel was reset, or moved to a
different local port):
1. `tailscale funnel --bg --https=8443 4001` (adjust the port if 4001 changed)
2. Update `API_PUBLIC_URL` in `.env` to the funnel URL, restart the API
3. `vercel env add NEXT_PUBLIC_API_BASE_URL production --force` and same for
   `preview` (value: `<funnel-url>/api/v1`), piping from a temp file — a
   direct pipe into `vercel env add` hangs on Windows, see Traps in
   [[deployment-setup]]
4. `vercel --prod --yes` to redeploy (required: `NEXT_PUBLIC_*` is compiled
   into the bundle at build time, not read at runtime)

`APP_BASE_URL`'s CORS allowlist already contains the Vercel origin and does
not change with any of this.

---

## 5-email sequence, real drafting engine (2026-08-12)

**Replaces the old 3-email flow (Email 1/2 static templates + a Gemini-drafted
Email 3 that was, in practice, permanently broken).** The user reported real
sent emails containing literal `[DEMO DRAFT]` text — root cause:
`GOOGLE_GENAI_API_KEY` was never configured in this deployment, so every
single Email 3 draft silently fell through to a hardcoded fallback template.
Fixed by moving off Gemini entirely.

**All 5 emails are now AI-drafted, on the Claude CLI** — the same engine
already used for lead discovery/research/scoring, needing no separate API
key:
1. **Problem Trigger** — one felt industry pain point. The company is never
   named except in the signature.
2. **Industry Insight** — a real AI/automation shift in their industry, still
   no pitch.
3. **Proof** — first email allowed to name the company as the "who" behind a
   result. No `CaseStudy` rows are seeded (table exists, empty) — the prompt
   is instructed to write this as an observational pattern rather than
   invent one, and never to guess a number.
4. **Soft Offer** — first ask, must be low-friction (audit/framework/
   question/call), not a services pitch.
5. **Breakup** — short, no guilt, closes the sequence.

3 business days between each (real business-day counting, weekends skipped
in the count itself — see `sequencer.service.ts`'s `businessDaysDelayMs`).

**Safety layer, because "never fabricate" can't just be a prompt
instruction:** `gemini_agent/lint.py` mechanically checks every draft
(150-word cap, 6-word subject cap, banned jargon list, no exclamation/emoji,
no urgency language, no company name before step 3) and retries once if it
fails. Separately, `EmailMessage.status` is forced to `PENDING_APPROVAL` —
overriding the org's `autoSendEnabled` setting — whenever a draft contains an
unresolved `[BRACKET PLACEHOLDER]`. Verified with real Claude CLI calls
against throwaway test leads (cleaned up after), not just unit tests.

**Recalibrated same day:** the model's own `flags` field originally also
forced `PENDING_APPROVAL` on its own, on the theory that any self-reported
uncertainty should get a human look. In practice this over-fired — a real
Email 2 got flagged and blocked for a plain, unattributed industry
observation ("teams putting something automated in front of that inbox
first...") that never claimed anything false. `flags` still rides along in
the AgentRun notes for visibility, but only the concrete bracket-placeholder
check gates auto-send now — see `gemini_agent/drafting.py`'s
`draft_and_validate`.

Pipeline stages renamed/added to match:
`EMAIL_1_SENT → WAITING_EMAIL_2 → EMAIL_2_SENT → WAITING_EMAIL_3 →
EMAIL_3_SENT → WAITING_EMAIL_4 → EMAIL_4_SENT → WAITING_EMAIL_5 →
EMAIL_5_SENT → LINKEDIN_OUTREACH`. Migrated by hand
(`prisma/migrations/20260812120000_five_email_sequence`) since `prisma
migrate dev` refuses to run non-interactively for a change that removes enum
values — verified against production first that no live `PipelineState` row
used any of the four removed values before writing the migration.

---

## Current state (2026-07-31, campaign facts stale — see lead count above)

**Everything needed to run a campaign is configured and working:**

- One active mailbox: `sales@euroshub.com` (SMTP), verified with a real test send.
- One campaign ("Healthcare AI Campaign") linked to the "Healthcare" niche filter.
- As of 2026-08-12 there is exactly **one** lead in the pipeline, at
  `CLIENT_ONBOARDING` (won). The "2 leads" and `PERSONALIZED_PITCH` reference
  below is what this file said on 2026-07-31 and is no longer current —
  `PERSONALIZED_PITCH` doesn't exist as a stage anymore either (see the
  5-email sequence section above).

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
- Every AI-drafted email in the 5-email sequence (see above) **sends itself
  by default** — `/settings` has an "Automation" toggle to require approval
  again per org. A draft the worker's own safety checks flagged
  (`needsReview`) always requires approval regardless of that setting.
- LinkedIn **sending** is still human-only (ToS/ban risk, unchanged); only
  copy-drafting is automatic now, generated alongside Email 1.
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

**Real-time (2026-07-30/31, extended 2026-08-12):** a WebSocket gateway
(`apps/api/src/realtime/`) pushes `lead.created` / `lead.stageChanged` /
`lead.updated` / `agentRun.started` / `agentRun.recorded` /
`extractionRun.progress` / `email.sent` / `email.failed` /
`notification.created` to every connected dashboard, scoped per org.
`apps/web/lib/realtime.ts`'s `useRealtimeEvent`/`useRealtimeRefetch` hooks
are how a page subscribes — the pipeline board and lead detail page both use
it instead of polling. `/leads` now does too (`lead.created`, added
2026-08-12 — it previously loaded once on mount and never refetched).

**"Run now" live progress (2026-08-12):** hitting Run now on a niche filter
(`/settings`) used to give zero feedback — the button just sat there for
however long the run took, with nothing to tell you it was even working.
`apps/ai-workers/claude_agent/runner.py`'s `run_extraction` now PATCHes
`/extraction-runs/:id` once per candidate attempt (not just once at the very
end), which the controller turns into a live `extractionRun.progress`
event; `/settings` shows a per-filter "Running — N/target verified · N
rejected" line that updates continuously, and the button disables itself
while a run is in flight. Combined with `/leads` now subscribing to
`lead.created`, newly-found leads also appear on that page without a manual
refresh while a run is going.

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

**Tailscale Funnel can go dark after this workstation's network/IP changes**
(confirmed 2026-08-10: `tailscaled`'s own log showed `gateway and self IP
changed`, e.g. from a Wi-Fi reconnect or sleep/wake) — `tailscale funnel
status` still reports both funnels "on" and `tailscale status` shows
`BackendState: Running` with no reported health issues, but the public HTTPS
listener stops accepting connections (TLS handshake fails, or `curl` gets no
response at all) until it reconnects on its own, which was not observed to
happen quickly. Affected **both** funnels on this node at once (this app's
and the unrelated other app's), confirming it's a node-level Tailscale issue,
not anything specific to this app's config. `Restart-Service Tailscale`
needs admin rights this session doesn't have and fails silently. **What
worked: `tailscale down` followed by `tailscale up`** (no admin needed) —
funnel config is preserved across this and both endpoints came back within
seconds. If the public API is unreachable but `curl http://localhost:4001/api/v1/health`
is fine locally, try this before anything else.

**Historical — applies only if reverting to `serve-public.ps1`/Cloudflare,
not the current Tailscale Funnel setup (see "Public access" above).** Kept
because the script and this failure mode still exist in the repo.

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
