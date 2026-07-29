# Resume here

State as of **2026-07-29**, commit `8dd9686`. Read this first.

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
query the `users` table directly. Password is `ChangeMe123!` unless changed.
Prefer creating yourself a named account via Team rather than sharing this
seeded one further.

**Dashboard:** https://lead-gen-dashboard-umber.vercel.app
**Repo:** https://github.com/raohamza08/lead-gen

> The Cloudflare quick tunnel gets a **new hostname every restart**, and
> `NEXT_PUBLIC_API_BASE_URL` is compiled into the bundle at build time, so the
> site must be redeployed after every tunnel restart. `serve-public.ps1` does
> both. It forces `--protocol http2`; without that the tunnel dies within
> minutes on this network while the process stays alive, so a dead tunnel looks
> identical to a working one.

---

## Current state (2026-07-29)

**Everything needed to run a campaign is configured and working:**

- One active mailbox: `sales@euroshub.com` (SMTP), verified with a real test send.
- One campaign ("Healthcare AI Campaign") linked to the "Healthcare" niche filter.
- Outreach has been exercised live: the one remaining test lead (EurosHub)
  has been walked through the pipeline as far as `PERSONALIZED_PITCH`, with
  real emails sent through the mailbox above.
- The other 10 leads that existed earlier today were deleted (via the new
  pipeline delete button) during testing — this was intentional, not data loss.

**Nothing is currently blocking outreach.** To run it for real: create/edit a
niche filter on `/settings`, decide Full vs Reduced enrichment cost there,
link it to a campaign on `/campaigns`, then either wait for its daily cron or
hit **Run now**. New leads land in `NEW_LEAD` and need to be walked through
review to `READY_FOR_OUTREACH` (drag on `/pipeline`, or use the buttons on a
lead's detail page) before the sequencer takes over.

---

## What exists

**13 agents** behind an orchestrator (`apps/ai-workers/agents/`), 6 pipelines.
See [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md). Enrichment cost is
tunable per niche filter — Full (6 Claude CLI calls/candidate) or Reduced (3,
skips `company_intelligence`/`website_audit`/`buyer_intelligence`) — via a
toggle or per-agent checkboxes on `/settings`.

`lead_discovery · lead_verification · company_intelligence · website_audit ·
buyer_intelligence · ai_opportunity · lead_scoring · review · email · linkedin ·
scheduler · analytics · learning`

**Pipeline:** 20 stages, `NEW_LEAD → … → WON → CLIENT_ONBOARDING`, with `LOST`
reachable from any active stage. State machine lives in
`packages/types/src/pipeline.ts` — shared between API and dashboard so the
board only offers drops the API will actually accept. One level of undo:
every stage change records `previousStage`, and a "← Back" control
(`/pipeline` cards, lead detail page) swaps back to it — also how a failed
automated send gets retried (back to Ready, forward again). A direct
**Resend** button on the lead detail page's Emails section covers messages
that failed before this existed. Leads can also be permanently deleted
(pipeline card "Delete" button, ADMIN only, full history goes with it — no
detach-and-keep) and exported as CSV (`/leads` → Export CSV, always the full
org, not the page's filtered view).

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

- Self-service password change/reset for Team accounts
- Review Center and Lead Intelligence dashboards
- Personalized landing pages
- Token / cost tracking for Claude and Gemini
- ClickUp's 27 custom fields (sync sends far fewer)
- Taxonomy pickers in the filter builder — the taxonomy feeds the AI search
  brief, but Industries / Countries / Bands / Growth Signals / Titles / Tech /
  AI-types have no `NicheFilter` columns or UI controls yet
- `/sequences` and `/settings` still use an older visual layout than the rest
  of the dashboard (hand-rolled classes instead of the shared `card` styles)

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
before restarting anything.

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
