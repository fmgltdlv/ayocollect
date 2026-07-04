# ayocollect

811 ticket analytics for excavators. Fetches ticket detail and dig-site polygons from **USAN** (Northern CA + Nevada) and **DigAlert** (Southern CA), then scores utility response timeliness.

The app runs as a **Cloudflare Worker API** plus a **Cloudflare Pages** frontend. Ticket data is **imported in bulk** from a dedicated scraper (VM) via authenticated ingest routes; the Worker upserts into D1 and serves analytics to the UI. Legacy Worker-side scraping (batch jobs, cron) is disabled by default.

## Architecture

| Component | Location | Role |
|---|---|---|
| Dedicated scraper | `scraper/` (+ `_811-ref/`) | Scan 811 APIs, POST batches to Worker |
| Worker API | `backend/` | Ingest, read API, analytics (D1 upsert) |
| Frontend | `frontend/` | Static UI on Cloudflare Pages (`ayocollect-ui`) |
| Database | Cloudflare D1 | Ticket data, settings |

**Production URLs**

| Service | URL |
|---|---|
| UI | https://ayocollect-ui.pages.dev |
| API | https://ayocollect.thefieldmappinggroup.workers.dev/api |

The frontend calls the API via `frontend/config.js` (`window.AYO_API_BASE`).

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (installed via `npm install` in `backend/`)

## Local development

**Backend (API only):**

```bash
cd backend
npm install
npm run db:migrate:local
npm run dev
```

API at `http://127.0.0.1:8787` (typically).

**Frontend (optional — run UI separately):**

```bash
cp frontend/config.local.js.example frontend/config.local.js
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:8788`. `config.local.js` points the UI at the local API.

## Deploy to Cloudflare

Backend and frontend deploy **independently**:

```bash
# API only (Worker + D1 + cron)
cd backend
npm run deploy

# UI only (Pages)
cd frontend
npm install
npm run deploy
```

First-time Pages setup: create the project once with `npx wrangler pages project create ayocollect-ui --production-branch=main`, then use `npm run deploy` for future UI updates.

You can also deploy from the **Cloudflare dashboard** (Git-connected Workers Builds for the API). The frontend can be connected to Git separately under **Workers & Pages → ayocollect-ui**.

---

### Option A: Deploy from the Cloudflare Dashboard (Git)

Use this if you want pushes to GitHub to deploy automatically without running commands locally.

#### 1. Sign in and create D1

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and select your account.
2. **Storage & Databases → D1 SQL Database → Create database**
3. Name it `ayocollect-db` (or any name — match it in `wrangler.toml`).
4. Open the database → **Settings** → copy the **Database ID**.
5. In your GitHub repo, set `backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ayocollect-db"
database_id = "<paste-database-id-here>"
```

Commit and push that change before connecting the Worker.

#### 2. Apply database schema

The dashboard cannot run migration files directly. Use one of:

**A. Wrangler once from your machine**

```bash
cd backend
npm install
npx wrangler login
npm run db:migrate:remote
```

**B. D1 Console in the dashboard**

1. **Storage & Databases → D1 SQL Database → ayocollect-db → Console**
2. Paste and run the SQL from `backend/migrations/0001_init.sql`.

Confirm tables exist:

```sql
SELECT name FROM sqlite_master WHERE type = 'table';
```

#### 3. Connect the Worker to GitHub

1. **Workers & Pages → Create**
2. Choose **Connect to Git** (or **Workers → Connect Git repository**).
3. Authorize GitHub and select the `ayocollect` repository.
4. Configure the build:

| Setting | Value |
|---|---|
| **Worker name** | `811-ticket-serverless` (must match `name` in `wrangler.toml`) |
| **Root directory** | `backend` |
| **Build command** | `npm install && npm run deploy` |
| **Deploy command** | *(leave empty — deploy is in the build command)* |

Cloudflare reads `backend/wrangler.toml` for the D1 binding and cron trigger.

5. Click **Save and Deploy** (or **Deploy**).

#### 4. Configure secrets in the dashboard

1. **Workers & Pages → 811-ticket-serverless → Settings → Variables and Secrets**
2. **Add secret** → Name: `DIGALERT_SESSION_COOKIES`
3. Value: JSON cookie object, e.g. `{"session":"..."}`

Redeploy after adding secrets (**Deployments → Retry deployment** or push a new commit).

#### 5. Verify bindings and triggers

In **Workers & Pages → 811-ticket-serverless → Settings**:

| Tab | What to check |
|---|---|
| **Bindings** | D1 database `DB` → `ayocollect-db` |
| **Triggers** | Cron `0 * * * *` (hourly UTC) |
| **Domains & Routes** | `811-ticket-serverless.<subdomain>.workers.dev` |

Open the workers.dev URL and test:

```
/api/health   →  {"ok":true}
/             →  {"service":"ayocollect-api",...}
```

Open the UI at **Workers & Pages → ayocollect-ui** (https://ayocollect-ui.pages.dev).

#### 6. Custom domain (optional)

**Settings → Domains & Routes → Add → Custom domain** — enter your domain and complete DNS setup.

#### 7. Future updates via dashboard

- Push to your connected branch (e.g. `main`) → Cloudflare rebuilds and deploys automatically.
- View status: **Workers & Pages → 811-ticket-serverless → Deployments**
- View logs: **Logs** or **Observability → Workers**
- New SQL migrations: run `npm run db:migrate:remote` locally **or** paste new migration SQL in **D1 → Console**, then redeploy.

---

### Option B: Deploy from your machine (Wrangler CLI)

#### 1. Cloudflare account

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Select your account (top-left account switcher).

#### 2. Create the D1 database (Dashboard)

1. Go to **Storage & Databases → D1 SQL Database**.
2. Click **Create database**.
3. Name it `ayocollect-db` and create it.
4. Open the new database → **Settings** tab.
5. Copy the **Database ID** (UUID).

Update `backend/wrangler.toml` with that ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ayocollect-db"
database_id = "<paste-database-id-here>"
```

#### 3. Apply database schema

```bash
cd backend
npm install
npx wrangler login
npm run db:migrate:remote
```

To confirm in the dashboard: **Storage & Databases → D1 SQL Database → ayocollect-db → Console**, then run:

```sql
SELECT name FROM sqlite_master WHERE type = 'table';
```

You should see tables such as `dig_alert_tickets`, `fetch_jobs`, and `app_settings`.

#### 4. Set secrets (Dashboard, optional)

DigAlert fetches may require session cookies if the API is gated.

1. Deploy once first (step 5) so the Worker exists.
2. Go to **Workers & Pages → 811-ticket-serverless**.
3. Open **Settings → Variables and Secrets**.
4. Under **Secrets**, click **Add**.
5. Name: `DIGALERT_SESSION_COOKIES`
6. Value: JSON cookie object, for example:

```json
{"session":"...","other_cookie":"..."}
```

For local dev, put the same value in `backend/.dev.vars`:

```
DIGALERT_SESSION_COOKIES={"session":"..."}
```

#### 5. Deploy the Worker

```bash
cd backend
npm run deploy
```

#### 6. Deploy the frontend (Pages)

```bash
cd frontend
npm install
npx wrangler pages project create ayocollect-ui --production-branch=main   # first time only
npm run deploy
```

After deploy, confirm in the dashboard:

1. **Workers & Pages → 811-ticket-serverless**
2. **Metrics** tab should show recent requests after you visit the site.
3. **Settings → Triggers** should show the cron schedule `0 * * * *` (hourly UTC).

Your app URL:

```
https://811-ticket-serverless.<your-subdomain>.workers.dev
```

Find the exact URL under **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes → workers.dev**.

#### 7. Custom domain (Dashboard, optional)

1. **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes**
2. Click **Add → Custom domain** (or **Add route** if using a path on an existing zone).
3. Enter your domain (e.g. `ayocollect.example.com`) and follow the DNS prompts.

The domain must be on a zone already in your Cloudflare account.

#### 8. Verify deployment

```
https://ayocollect.thefieldmappinggroup.workers.dev/api/health
https://ayocollect-ui.pages.dev
```

Expected response:

```json
{"ok":true}
```

In the dashboard, check **Workers & Pages → 811-ticket-serverless → Logs** for errors if the health check fails.

## Updating production

**Dashboard (Git-connected):** push to your connected branch — Cloudflare redeploys automatically.

**CLI (backend):**

```bash
cd backend
npm run deploy
```

**CLI (frontend only):**

```bash
cd frontend
npm run deploy
```

If you add new SQL migrations under `backend/migrations/`:

```bash
npm run db:migrate:remote
npm run deploy
```

Confirm in the dashboard under **Workers & Pages → 811-ticket-serverless → Deployments** that the latest version is active.

## Dashboard quick reference

| Task | Where in Cloudflare Dashboard |
|---|---|
| Connect Git / redeploy API | **Workers & Pages → ayocollect → Deployments** |
| Deploy / redeploy UI | **Workers & Pages → ayocollect-ui → Deployments** |
| Create / view D1 database | **Storage & Databases → D1 SQL Database** |
| Run SQL manually | **D1 → ayocollect-db → Console** |
| View Worker URL | **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes** |
| Check D1 binding | **Workers & Pages → 811-ticket-serverless → Settings → Bindings** |
| Add secrets | **Workers & Pages → 811-ticket-serverless → Settings → Variables and Secrets** |
| Check cron trigger | **Workers & Pages → 811-ticket-serverless → Settings → Triggers** |
| View logs / errors | **Workers & Pages → 811-ticket-serverless → Logs** |
| Add custom domain | **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes → Add** |

## Ingest API (scraper → Worker)

See `scraper/README.md` for batch formats and the `push-batch.mjs` test client.

```bash
cd backend
npx wrangler secret put INGEST_SECRET
npm run deploy
```

| Endpoint | Purpose |
|---|---|
| `POST /api/ingest/digalert` | Bulk Dig Alert payloads |
| `POST /api/ingest/usan-ca` | Bulk USAN CA payloads + optional polygon WKT |
| `POST /api/ingest/usan-nv` | Bulk USAN NV payloads + optional polygon WKT |

Auth: `Authorization: Bearer <INGEST_SECRET>`. Max 100 tickets per request.

## Configuration

| Setting | Description |
|---|---|
| `INGEST_SECRET` | Bearer token for `/api/ingest/*` (Worker secret) — **required for scraper import** |
| `ENABLE_WORKER_SCRAPING` | `true` to re-enable legacy Worker batch jobs / cron / Fetch tab (default `false`) |
| `DIGALERT_SESSION_COOKIES` | Only if `ENABLE_WORKER_SCRAPING=true` |
| `WORKER_URL` | Only if `ENABLE_WORKER_SCRAPING=true` |
| Auto-fetch settings | D1 `app_settings`; ignored unless Worker scraping enabled |

## Project layout

```
backend/          Cloudflare Worker (ingest + read API)
  migrations/     D1 schema migrations
  src/            Worker source
scraper/          Scraper docs + batch push helper
_811-ref/         Reference Python scraper code
frontend/         Static HTML/CSS/JS (Cloudflare Pages)
```
