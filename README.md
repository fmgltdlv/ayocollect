# ayocollect

811 ticket analytics for excavators. Fetches ticket detail and dig-site polygons from **USAN** (Northern CA + Nevada) and **DigAlert** (Southern CA), then scores utility response timeliness.

The app is a single Cloudflare Worker that serves the API, static frontend, and hourly cron jobs. Data is stored in D1.

## Architecture

| Component | Location | Role |
|---|---|---|
| Worker API | `backend/` | REST API, ticket fetch jobs, scheduled sync |
| Frontend | `frontend/` | Static UI served by the Worker via `[assets]` |
| Database | Cloudflare D1 | Ticket data, fetch jobs, settings |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (installed via `npm install` in `backend/`)

## Local development

```bash
cd backend
npm install
npm run db:migrate:local
npm run dev
```

Open the URL Wrangler prints (typically `http://127.0.0.1:8787`). The Worker serves both the frontend and `/api/*` routes.

## Deploy to Cloudflare

### 1. Cloudflare account

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Select your account (top-left account switcher).

### 2. Create the D1 database (Dashboard)

1. Go to **Storage & Databases → D1 SQL Database**.
2. Click **Create database**.
3. Name it `811-tickets` and create it.
4. Open the new database → **Settings** tab.
5. Copy the **Database ID** (UUID).

Update `backend/wrangler.toml` with that ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "811-tickets"
database_id = "<paste-database-id-here>"
```

### 3. Apply database schema

From your machine (requires Wrangler linked to the same account):

```bash
cd backend
npm install
npx wrangler login
npm run db:migrate:remote
```

To confirm in the dashboard: **Storage & Databases → D1 SQL Database → 811-tickets → Console**, then run:

```sql
SELECT name FROM sqlite_master WHERE type = 'table';
```

You should see tables such as `dig_alert_tickets`, `fetch_jobs`, and `app_settings`.

### 4. Set secrets (Dashboard, optional)

DigAlert fetches may require session cookies if the API is gated.

1. Deploy once first (step 5) so the Worker exists, **or** create the Worker placeholder from the dashboard.
2. Go to **Workers & Pages → 811-ticket-serverless** (name matches `wrangler.toml`).
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

### 5. Deploy the Worker (CLI)

Deployment is done with Wrangler from the repo:

```bash
cd backend
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

### 6. Custom domain (Dashboard, optional)

1. **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes**
2. Click **Add → Custom domain** (or **Add route** if using a path on an existing zone).
3. Enter your domain (e.g. `ayocollect.example.com`) and follow the DNS prompts.

The domain must be on a zone already in your Cloudflare account.

### 7. Verify deployment

In the browser or terminal:

```
https://811-ticket-serverless.<your-subdomain>.workers.dev/api/health
```

Expected response:

```json
{"ok":true}
```

In the dashboard, check **Workers & Pages → 811-ticket-serverless → Logs** (or **Observability → Workers**) for errors if the health check fails.

## Updating production

After code changes:

```bash
cd backend
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
| Create / view D1 database | **Storage & Databases → D1 SQL Database** |
| Run SQL manually | **D1 → 811-tickets → Console** |
| View Worker URL | **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes** |
| Add secrets | **Workers & Pages → 811-ticket-serverless → Settings → Variables and Secrets** |
| Check cron trigger | **Workers & Pages → 811-ticket-serverless → Settings → Triggers** |
| View logs / errors | **Workers & Pages → 811-ticket-serverless → Logs** |
| Add custom domain | **Workers & Pages → 811-ticket-serverless → Settings → Domains & Routes → Add** |

## Configuration

| Setting | Description |
|---|---|
| `DIGALERT_SESSION_COOKIES` | JSON cookie object for authenticated DigAlert API access (Worker secret) |
| Auto-fetch settings | Configured in the UI under Settings; stored in D1 `app_settings` |

The hourly cron trigger (`0 * * * *` UTC) runs automatic fetch jobs when auto-fetch is enabled in app settings.

## Project layout

```
backend/          Cloudflare Worker (Hono API + cron)
  migrations/     D1 schema migrations
  src/            Worker source
frontend/         Static HTML/CSS/JS (served by Worker)
```
