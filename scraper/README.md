# Dedicated scraper → Worker ingest

Heavy 811 ticket collection runs on a dedicated machine (VM, home server, etc.). The Cloudflare Worker is the **D1 gateway and analytics API** — it receives pre-scraped batches via authenticated ingest endpoints.

Reference implementations: `_811-ref/811-ticket-data-main/`.

## What this folder contains

| File / folder | Purpose |
|---|---|
| `ayocollect_scraper/` | Python package: fetchers, scanner, ingest client |
| `cli.py` | One-off scans from the shell |
| `server.py` | Optional FastAPI control API (background jobs) |
| `.env.example` | Copy to `.env` and fill in secrets |
| `install.sh` | venv setup (+ optional systemd) |
| `Dockerfile` | Container image (Cloudflare Containers or local Docker) |
| `wrangler.toml` + `src/index.ts` | Cloudflare Worker + cron trigger |
| `entrypoint.sh` | Batch or API mode inside the container |
| `systemd/` | Service + daily timer units |
| `push-batch.mjs` | Test client for pre-built JSON batches |

## One-time setup

### 1. Worker ingest secret

```bash
cd backend
npx wrangler secret put INGEST_SECRET
```

Use the same value in `scraper/.env`.

### 2. Scraper machine

```bash
cd scraper
cp .env.example .env
# Edit: INGEST_SECRET, DIGALERT_SESSION_COOKIES (JSON), WORKER_URL

chmod +x install.sh
./install.sh

source venv/bin/activate
python cli.py health
```

`DIGALERT_SESSION_COOKIES` must be a JSON object, e.g. `{"session":"..."}` from a logged-in DigAlert browser session.

## Running scans

### CLI (recommended for backfills)

```bash
source venv/bin/activate

# Single day
python cli.py scrape --start 2026-05-01 --end 2026-05-01

# Date range (all systems from .env)
python cli.py scrape --start 2026-05-01 --end 2026-05-31

# Subset of systems
python cli.py scrape --start 2026-05-01 --end 2026-05-01 --systems usan-ca,usan-nv

# Yesterday only (good for cron)
python cli.py yesterday
```

Or as a module from the `scraper/` directory:

```bash
python -m ayocollect_scraper scrape --start 2026-05-01 --end 2026-05-01
```

### Scan rules (matches Worker)

- **2 consecutive misses** → advance to next calendar day
- **Max 3999 tickets/day** per system
- DigAlert: Southern CA ticket format
- USAN CA/NV: `YYYYMMDD#####-000`

Batches flush every `INGEST_BATCH_SIZE` tickets (default 50) with IDs like `2026-05-01-digalert-1`.

## Optional HTTP API

```bash
source venv/bin/activate
python server.py
# listens on SCRAPER_API_HOST:SCRAPER_API_PORT (default 0.0.0.0:8789)
```

| Endpoint | Description |
|---|---|
| `GET /health` | Local status + Worker ingest health |
| `GET /status` | Recent background jobs |
| `POST /scrape` | Start `{ "start": "2026-05-01", "end": "2026-05-31", "systems": ["usan-ca"] }` |

If `SCRAPER_API_KEY` is set, send `Authorization: Bearer <key>` or `X-API-Key`.

### Docker

```bash
cd scraper
docker build -t ayocollect-scraper .
docker run --env-file .env -p 8789:8789 ayocollect-scraper
```

### systemd (Linux)

```bash
INSTALL_SYSTEMD=1 ./install.sh
sudo systemctl start ayocollect-scraper          # API server
sudo systemctl start ayocollect-scraper-daily    # manual yesterday run
sudo systemctl list-timers ayocollect-scraper-daily.timer
```

## Worker ingest endpoints

| Endpoint | Auth |
|---|---|
| `POST /api/ingest/digalert` | `Authorization: Bearer <INGEST_SECRET>` |
| `POST /api/ingest/usan-ca` | same |
| `POST /api/ingest/usan-nv` | same |
| `GET /api/ingest/health` | same |

Max **100 tickets per request**. The scraper splits large days automatically.

### Dig Alert batch body

```json
{
  "batchId": "2026-07-01-digalert-1",
  "scrapedAt": "2026-07-02T06:00:00Z",
  "tickets": [
    {
      "status": "OK",
      "message": "",
      "timestamp": "...",
      "data": { "ticket": "A252341234", "revision": "00A", "polygon_wkt": "POLYGON((...))" }
    }
  ]
}
```

### USAN CA / NV batch body

```json
{
  "batchId": "2026-07-01-usan-nv-1",
  "scrapedAt": "2026-07-02T06:00:00Z",
  "tickets": [
    {
      "payload": { "posrTicket": { "ticketNumber": "2026070100123-000" } },
      "polygonWkt": "POLYGON((...))"
    }
  ]
}
```

Upserts are idempotent — safe to retry a batch.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WORKER_URL` | production Worker URL | Ingest target |
| `INGEST_SECRET` | *(required)* | Bearer token for ingest |
| `THROTTLE_SEC` | `0.15` | Delay between ticket requests |
| `INGEST_BATCH_SIZE` | `50` | Tickets per POST (max 100) |
| `MAX_TICKETS_PER_DAY` | `3999` | Per-system daily cap |
| `CONSECUTIVE_MISS_LIMIT` | `2` | Misses before next day |
| `SYSTEMS` | `digalert,usan-ca,usan-nv` | Default systems for CLI |
| `DIGALERT_SESSION_COOKIES` | `{}` | JSON cookie dict for DigAlert |
| `SCRAPER_API_KEY` | unset | Protects `POST /scrape` |

## Test ingest with a file

```bash
node push-batch.mjs \
  --url https://ayocollect.thefieldmappinggroup.workers.dev \
  --secret "$INGEST_SECRET" \
  --system usan-nv \
  --batch-id 2026-07-01-usan-nv-test \
  --file ./samples/usan-batch.json
```

Worker-side scraping (`ENABLE_WORKER_SCRAPING`) defaults to **false**. Use this scraper as the primary collector.

## Cloudflare Container (deployed)

**URL:** https://ayocollect-scraper.thefieldmappinggroup.workers.dev

| Route | Purpose |
|---|---|
| `GET /health` | Worker status |
| `POST /run` | Start a scrape (`{"mode":"yesterday"}` or `{"start":"2026-05-01","end":"2026-05-31"}`) |

**Cron:** daily at 14:00 UTC (`0 14 * * *`) — runs yesterday for all systems.

### Deploy / update

```bash
cd scraper
npm install
# Docker Desktop must be running
npx wrangler deploy
```

Wrangler login must include the `containers:write` scope. If deploy fails with a scope error, run:

```bash
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write containers:write d1:write pages:write
```

### Required secrets (on `ayocollect-scraper` Worker)

```bash
cd scraper
npx wrangler secret put INGEST_SECRET   # same value as main ayocollect Worker
```

`INGEST_SECRET` is set on both Workers automatically during setup. Cloudflare does not let you read it back — rotate with `wrangler secret put` if needed.

**DigAlert cookies are not stored as secrets.** Paste fresh session cookies in the Fetch tab when starting a batch job that includes DigAlert. The daily cron runs USAN CA/NV only.
