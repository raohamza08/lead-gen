# Deployment

Two options. **Option A is what is currently live**, and it is the better fit
for this project.

---

# Option A — PC as the server, frontend on Vercel (current setup)

The frontend is on Vercel; the API, the Python workers and Redis all run on the
workstation, published over HTTPS by a Cloudflare quick tunnel.

```
Vercel (frontend, HTTPS + WebSocket client)
   |  public HTTPS URL
Cloudflare Tunnel  --->  workstation
                           |-- API          :4000   <- also serves the WebSocket
                           |                           gateway (socket.io) over
                           |                           the same tunnel/origin
                           |-- ai-workers   :8000   <- the `claude` CLI lives here
                           +-- Redis        :6379   (Docker)
                                 |
                           Supabase (already cloud)
```

The WebSocket gateway (`apps/api/src/realtime/`, added 2026-07-30) needs no
separate publishing step — it rides the same tunnel and CORS allowlist as the
REST API (`apps/api/src/common/cors.ts`, shared between `main.ts`'s
`enableCors` and the gateway's `@WebSocketGateway({ cors: ... })`). If REST
calls work through the tunnel, sockets do too; there is nothing extra to
configure here.

**Why this beats a managed API host here.** A cloud API cannot reach the
workstation, so `AI_WORKERS_URL` is dead from the cloud: the "Run now" button
and the scheduled daily extraction both fail, because the lead-finder needs the
locally logged-in `claude` CLI. Co-locating the API with the workers makes the
entire pipeline work, dashboard-triggered runs included.

**Cost:** nothing. No credit card, no port forwarding, and the tunnel dials
outward so the home IP is never exposed.

## Running it

```powershell
npm run dev:api          # :4000
npm run dev:web          # :3000 (optional; Vercel serves the public copy)
cd apps/ai-workers; .venv\Scripts\python.exe -m uvicorn main:app --port 8000
docker start leadgen-redis

.\scripts\serve-public.ps1
```

`scripts/serve-public.ps1` starts the tunnel, waits for its hostname, updates
Vercel's `NEXT_PUBLIC_API_BASE_URL`, and redeploys. **Run it after every reboot
or whenever the tunnel drops.**

## The two things that break this, and why

1. **A quick tunnel gets a new random hostname every start.**
   `NEXT_PUBLIC_API_BASE_URL` is inlined into the client bundle at *build* time,
   so updating the variable alone changes nothing — the shipped JavaScript still
   calls the old hostname until the site is redeployed. The script always does
   both. For a hostname that survives restarts, use a *named* tunnel (free
   Cloudflare account plus a domain), which can also run as a Windows service
   and start on boot.

   **This is not theoretical** — in one session (2026-07-30/31) the quick
   tunnel failed twice: once because Cloudflare's edge stopped recognising the
   session outright (`"Unauthorized: Tunnel not found"` in
   `cloudflared.err.log`), once because a fresh hostname just didn't resolve
   on this workstation's local DNS for several minutes (confirmed healthy the
   whole time via an external resolver). Both required the full
   restart-tunnel → update `.env` → update Vercel env (production **and**
   preview) → redeploy → restart API sequence above, by hand, twice in one
   day. See `docs/RESUME.md`'s Traps section for exactly how each was
   diagnosed. If this keeps recurring, migrating to a named tunnel stops being
   optional.

2. **CORS.** `APP_BASE_URL` in `.env` must contain the Vercel origin. It takes a
   comma-separated list, so localhost can stay alongside it:

   ```
   APP_BASE_URL=https://lead-gen-dashboard-umber.vercel.app,http://localhost:3000
   ```

   Restart the API after changing it. `*` is not an option — CORS runs with
   `credentials: true`, and a wildcard is illegal alongside credentials.

## Trade-offs to accept

- The workstation *is* the server: asleep, rebooted or offline means the
  dashboard has no backend.
- Home upload bandwidth gates response times.
- **The API is reachable from the public internet.** The seeded
  `admin@example.com` account and its password are documented in this public
  repo; anyone who reads it can sign in. Change that password before treating
  the deployment as anything other than a demo.

---

# Option B — fully managed (API on Render)

Kept for reference. Three services, two of which deploy to managed hosts and one
of which cannot.

| Service | Host | Why |
|---|---|---|
| `apps/web` | Vercel | Next.js; Vercel is the native target |
| `apps/api` | Render (Docker) | Needs a **persistent process**: BullMQ workers hold the "wait 2 days" delayed jobs and `@nestjs/schedule` runs the per-filter extraction crons. On ephemeral serverless functions neither would ever fire |
| `apps/ai-workers` | **Stays on your workstation** | The lead-finder shells out to a locally logged-in `claude` CLI. That is bound to your machine's subscription session and cannot be reproduced on a managed host |
| Postgres | Supabase | Already cloud-hosted |
| Redis | Render Key Value | Provisioned by `render.yaml` |

Because the workers stay local, **scheduled lead extraction only runs while your
workstation is running them**. Everything else — the dashboard, the API, the
sequencer timers, webhooks — runs in the cloud independently.

---

## 1. Push to GitHub

Render deploys from a Git repository, so the repo needs a remote.

```bash
git add -A
git commit -m "Add deployment config"
# create an EMPTY repo on github.com first (no README/.gitignore), then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

`.env` is gitignored and must stay that way — every secret is injected by the
host, never committed.

## 2. Deploy the API to Render

1. Render Dashboard → **New** → **Blueprint** → select the repo. It reads
   [`render.yaml`](../render.yaml) and creates the `leadgen-api` web service plus
   the `leadgen-redis` Key Value instance.
2. Render prompts for every var marked `sync: false`. At minimum:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **transaction** pooler, port 6543, with `?pgbouncer=true` |
   | `DIRECT_URL` | Supabase **session** pooler, port 5432 (migrations only) |
   | `APP_BASE_URL` | Your Vercel URL — fill in after step 3, then redeploy |
   | `INTERNAL_SERVICE_TOKEN` | Same value as your local `.env` |

   `REDIS_URL` is wired automatically. `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`
   are generated by Render. Integration keys (Gemini, ClickUp, Sheets, Gmail)
   are optional — each client degrades to a logged no-op without them.

   > The password in the Supabase URLs must stay **percent-encoded** (`@` → `%40`).

   **Plans.** Both services default to `free` so a review deployment costs
   nothing. Two consequences to know before trusting it with live outreach:

   - A free **web service** spins down after 15 minutes idle and takes ~1
     minute to wake, so the first dashboard load after a quiet spell hangs.
   - A free **Key Value** instance does **not persist to disk**, and Render may
     restart it at any time, wiping it. BullMQ keeps the "wait 2 days" delayed
     jobs there, so a restart silently drops every scheduled follow-up — leads
     stall at `EMAIL_1_SENT` with nothing to advance them and no error raised.

   Move both to `starter` before running real sequences. It's a plan change in
   the Render dashboard; no redeploy needed.

3. **Run migrations yourself, from your machine**, before deploying anything
   that adds one:

   ```bash
   npm run prisma:deploy --workspace=apps/api
   ```

   The blueprint deliberately has **no `preDeployCommand`**: Render offers
   pre-deploy commands only on paid instance types, and a blueprint pairing one
   with `plan: free` is rejected. This costs nothing to work around, because the
   database is Supabase and is reachable from anywhere — the migration doesn't
   need to run from inside Render at all.

   On a paid instance you can automate it again by adding
   `preDeployCommand: npm run prisma:deploy:ci --workspace=apps/api`, which also
   buys you the safety property that a failed migration aborts the deploy and
   leaves the previous version serving.

4. Verify: `curl https://<your-api>.onrender.com/api/v1/health` →
   `{"status":"ok","dependencies":{"database":"up","redis":"up"}}`.

## 3. Deploy the dashboard to Vercel

```bash
vercel login
vercel link           # from the repo root
vercel --prod
```

[`vercel.json`](../vercel.json) drives the build. It runs from the **repo root**,
not `apps/web`, because the web app imports the `@leadgen/types` workspace
package, which has to be compiled first.

Set one environment variable in the Vercel project (Settings → Environment
Variables), for **all** environments:

```
NEXT_PUBLIC_API_BASE_URL = https://<your-api>.onrender.com/api/v1
```

> `NEXT_PUBLIC_*` values are inlined into the client bundle **at build time**.
> Setting it after a deploy has no effect until you redeploy — the old value is
> already baked into the shipped JavaScript. Include the `/api/v1` suffix.

## 4. Close the CORS loop

Go back to Render and set `APP_BASE_URL` to the Vercel production URL, then
redeploy. It accepts a comma-separated list, so you can keep localhost too:

```
APP_BASE_URL=https://your-app.vercel.app,http://localhost:3000
```

Vercel mints a new hostname for every preview deployment, so those can't be
listed ahead of time. To allow them, set `VERCEL_PREVIEW_ORIGIN_SUFFIX` to your
team's `.vercel.app` suffix. Left unset, previews are blocked — which is the
safe default, since CORS runs with `credentials: true` and `*` is not a legal
origin alongside credentials.

## 5. Point the local workers at the deployed API

In your workstation `.env`:

```
API_BASE_URL=https://<your-api>.onrender.com/api/v1
```

Restart `apps/ai-workers`. Lead extraction now writes into the same database the
deployed dashboard reads. Note the reverse direction does **not** work: the
deployed API can't reach your workstation, so `AI_WORKERS_URL` stays local and
API-initiated extraction (the "Run now" button, scheduled crons) will fail from
the cloud unless you expose the workers through a tunnel such as `cloudflared`.

---

## Gotchas already fixed here — don't reintroduce them

Each of these was caught by building and running the real image locally, not by
reading the config:

1. **`dotenv-cli` in the Docker build.** `prisma:generate` is
   `dotenv -e ../../.env -- prisma generate`. There is no repo-root `.env` in a
   container, and dotenv-cli exits non-zero when its file is missing, so the
   image build failed. The Dockerfile uses the `:ci` script variants, which read
   the process environment directly.
2. **Prisma engine vs. Alpine's OpenSSL.** `node:20-alpine` ships neither the
   `openssl` package nor `libssl3`, so Prisma's probe failed, it silently fell
   back to its `openssl-1.1.x` engine, and the container died at boot with
   `Error loading shared library libssl.so.1.1`. Fixed by `apk add openssl` in
   **both** stages plus `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
   in `schema.prisma`. The image built fine either way — it only failed at
   runtime.
3. **Binding to localhost.** Managed hosts inject `PORT` and route to the
   container's external interface, so `main.ts` binds `0.0.0.0`. A default
   localhost bind is unreachable and fails the platform health check.

To re-verify the image before any deploy:

```bash
docker build -f infra/docker/api.Dockerfile -t leadgen-api:test .
docker run --rm -e DATABASE_URL=... -e DIRECT_URL=... -e REDIS_URL=... -p 4001:4000 leadgen-api:test
curl http://localhost:4001/api/v1/health
```

> `docker --env-file` does **not** strip surrounding quotes, so a quoted value in
> `.env` arrives with the quotes attached and Prisma rejects the URL. That is a
> local testing artifact only — Render sets variables directly.
