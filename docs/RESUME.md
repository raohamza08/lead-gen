# Resume here

State as of **2026-07-29**, commit `fcceac9`. Read this first.

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
`admin@example.com`. Check `/settings` → Team (once logged in) or query the
`users` table for the current one. Password is still `ChangeMe123!` unless
changed. `docs/RESUME.md`/`README.md` mentions of `admin@example.com` below
are stale; not corrected in place because doing so would mean putting a real
personal email in the public repo — flag this to the user before editing.
**Dashboard:** https://lead-gen-dashboard-umber.vercel.app
**Repo:** https://github.com/raohamza08/lead-gen

> The Cloudflare quick tunnel gets a **new hostname every restart**, and
> `NEXT_PUBLIC_API_BASE_URL` is compiled into the bundle at build time, so the
> site must be redeployed after every tunnel restart. `serve-public.ps1` does
> both. It forces `--protocol http2`; without that the tunnel dies within
> minutes on this network while the process stays alive, so a dead tunnel looks
> identical to a working one.

---

## Pick up exactly here

**Team / user management UI — done (2026-07-29).** The backend
(`apps/api/src/users/`) already existed in full — list, create, role change,
deactivate, all `@Roles`-gated — but had zero frontend before this. `/settings`
now has a Team section: ADMIN sees a "New user" form (name, email, temp
password, role) and can change any member's role or deactivate/reactivate
them (can't deactivate self); MANAGER and below see a read-only roster
(matches the `GET /users` RBAC, which already allowed ADMIN+MANAGER). Added
`PATCH /users/:id/activate` (only `deactivate` existed) and a friendly 409 on
duplicate email (was an unhandled Prisma P2002 → 500). Each new user logs in
with their own email/password immediately — there's no separate invite/consent
step. `getCurrentUser()` in `api-client.ts` decodes the JWT payload
client-side to gate the admin-only controls in the UI; this is display-only,
never a security boundary — the API's `RolesGuard` is what actually enforces
it on every request. **Not built:** self-service password change/reset — an
admin sets the password at creation and hands it to the person directly.

**Email settings UI — done.** `/settings` now has an Email accounts panel:
list with health bars (sent today vs daily limit), an add form that switches
fields by provider, pause/resume, **Send test**, delete. `api-client.ts` has
`testEmailAccount` / `deleteEmailAccount` / `getEmailAccounts`.

| Endpoint | Purpose |
|---|---|
| `GET /settings/email-accounts` | list (credentials redacted) |
| `GET /settings/email-accounts/health` | + `sentToday` per mailbox |
| `POST /settings/email-accounts` | create |
| `PATCH /settings/email-accounts/:id` | update limits / status |
| `POST /settings/email-accounts/:id/test` | **real** test send to your address |
| `DELETE /settings/email-accounts/:id` | delete, keeps sent history |

Provider fields:
- `SMTP` / `MICROSOFT_365` → host, port, username, password
- `GMAIL` → `oauthRefreshToken` (obtained out-of-band; there is no consent
  flow in the app)

**Leads → campaigns link — done (2026-07-29).** `LeadsService.createVerified`
now looks up `Campaign.findFirst({ filterId })` and stamps `lead.campaignId`
on every AI-discovered lead. The `/campaigns` page has a **Linked filter**
dropdown per row (`PATCH /campaigns/:id { filterId }`) plus the same picker in
the create form, since the API accepted `filterId` but no UI ever sent it.
The one pre-existing campaign ("Healthcare AI Campaign") has been linked to
the "Healthcare" niche filter as a one-time data fix.

**`disabledAgents` — was documented but didn't actually exist (2026-07-29).**
Earlier notes claimed niche filters could disable the 3 enrichment agents; the
column was never on the `NicheFilter` model, never in the DTO, never in the
UI — only the Python worker's `build_for_filter` read it from a dict that
nothing ever populated. Now real end to end: migration
`20260729134015_add_niche_filter_disabled_agents`, DTO validates against the
three droppable agent names, `/settings` niche-filter builder has per-agent
checkboxes plus a one-click "Full (6 calls) / Reduced (3 calls)" toggle per
existing filter (PATCHes the whole row — `UpsertNicheFilterDto.niche` is
required even on update, and the endpoint replaces rather than merges).

**To actually run a campaign**, in order:

1. **Configure a mailbox and use Send test** on `/settings` — a real send is
   the only thing that proves it works. SMTP auth can succeed while the
   provider still refuses to relay. **No mailbox is configured yet** — this is
   the one remaining manual step; the operator has to supply real credentials
   (Gmail OAuth refresh token, obtained out-of-band; Hostinger via SMTP —
   typically `smtp.hostinger.com`, port 465/SSL or 587/STARTTLS, username = full
   mailbox address).
2. Create/link a campaign to a niche filter on `/campaigns` (dropdown now
   exists in both the row and the create form).
3. Decide the enrichment cost tradeoff on `/settings` (Full vs Reduced), then
   trigger discovery — either wait for the filter's cron or hit **Run now**.
4. Move a lead to `READY_FOR_OUTREACH` (drag it on `/pipeline`). The sequencer
   takes over from there.

---

## What exists

**13 agents** behind an orchestrator (`apps/ai-workers/agents/`), 6 pipelines.
See [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md).

`lead_discovery · lead_verification · company_intelligence · website_audit ·
buyer_intelligence · ai_opportunity · lead_scoring · review · email · linkedin ·
scheduler · analytics · learning`

**Pipeline:** 20 stages, `NEW_LEAD → … → WON → CLIENT_ONBOARDING`, with `LOST`
reachable from any active stage. State machine lives in
`packages/types/src/pipeline.ts` — **shared**, because the pipeline board needs
the same rules to decide which columns accept a dragged card.

**Dashboard pages:** overview (executive), leads (+ manual add, filters),
pipeline (drag-and-drop), analytics, campaigns, automation (agent telemetry),
sequences, settings.

**Tests:** 37 API (`npm test --workspace=apps/api`) + 22 agent
(`cd apps/ai-workers; .venv\Scripts\python.exe -m pytest tests/ -q`).

---

## Not built

- Review Center and Lead Intelligence dashboards
- Personalized landing pages
- Token / cost tracking for Claude and Gemini
- ClickUp's 27 custom fields (sync sends far fewer)
- Taxonomy pickers in the filter builder — the taxonomy feeds the AI search
  brief, but Industries / Countries / Bands / Growth Signals / Titles / Tech /
  AI-types have no `NicheFilter` columns or UI controls yet
- `/sequences` and `/settings` still use the older layout

---

## Traps already hit — don't rediscover these

**`prisma migrate dev` silently drops indexes it doesn't know it should keep,
and new migrations can land in the wrong replay order (2026-07-29 incident).**
Two distinct traps, both hit generating the `disabledAgents` migration:

1. Several indexes (`leads_campaign_id_idx`, `leads_org_company_name_key_idx`,
   `leads_org_linkedin_slug_idx`, `leads_org_linkedin_url_idx`,
   `lead_scores_lead_priority_score_idx`) existed only as hand-written SQL in
   earlier migrations — never declared as `@@index` in `schema.prisma`. The
   moment *any* new `migrate dev` ran, it read their absence from the schema
   as drift and generated `DROP INDEX` for all five, and applied it
   immediately — no prompt, no warning, since the command wasn't run with
   `--create-only`. **Always add `@@index`/`@@unique` for every hand-written
   index, and run `--create-only` first to read the generated SQL before
   applying anything that isn't obviously additive.** Recovered same day by
   declaring the four plain-column ones in `schema.prisma` (`map:` to match
   the exact existing name) and a `restore_dropped_indexes` migration; the
   priority-score index lost its `NULLS LAST` (Prisma can't express it), which
   is a real but minor semantic change — noted in a schema comment.
2. Existing migration folders in this repo use fabricated round-hour
   timestamps (`..._150000`, `..._160000`) rather than real creation times.
   A brand-new migration's folder name uses the **real current time**, which
   on 2026-07-29 was ~13:40 — sorting *before* same-day migrations stamped
   150000/160000. Folder name order is what a from-scratch replay (fresh
   environment, `migrate reset`, or `--create-only`'s shadow-db validation)
   uses; the live dev database was fine because it replays by real applied
   order from `_prisma_migrations`, which masked the problem on first apply.
   Fix: rename the new migration folder to a round timestamp later than every
   existing one for that day, and update `_prisma_migrations.migration_name`
   to match via a direct `UPDATE` if it was already applied. Verify with
   `prisma migrate status` — it must say "Database schema is up to date"
   with zero drift after the fix.

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

---

## Known issues

**Claude CLI intermittently exits 1 with both streams empty** after several
successful web-search turns. Not reproducible with short prompts, so it looks
like subscription rate limiting — unconfirmed. Mitigated with 3× backoff and a
concurrency semaphore.

**Cost:** the full acquisition pipeline makes **6 CLI calls per candidate**
(~600/day at a 100 target). Disable enrichment agents per filter via the
**Full/Reduced toggle or per-agent checkboxes on `/settings`** (`disabledAgents`:
`company_intelligence`, `website_audit`, `buyer_intelligence`) to get back to 3.
Discovery, verification, opportunity and scoring cannot be disabled.

**`ALLOW_DEMO_FALLBACK` is off** and should stay off — with it on, a CLI failure
inserts synthetic `.example.com` companies into the real leads table. The five
`.example.com` leads in the database predate that gate.

**Security:** `admin@example.com` / `ChangeMe123!` is published in the public
README and the API is internet-reachable whenever the tunnel is up. Raised;
user chose to leave it.
