# ayocollect

811 ticket analytics for excavators. Sequential scraping pulls ticket detail and dig-site polygons from **USAN** (Northern CA + Nevada) and **DigAlert** (Southern CA), then scores utility response timeliness.

## Features

- **On-time response rate** — late if `999` appears before first acceptable code
- **Polygon overlap** — detect overlapping dig sites between tickets
- **Historical backfill** — dashboard UI to sync past dates (per system)
- **Multi-region scrape** — USAN NV, USAN CA, and DigAlert via sequential enumeration

## Architecture

One Cloudflare Worker (`ayocollect`) handles everything:

| Handler | Role |
|---|---|
| `fetch` | REST API for the dashboard + backfill |
| `queue` | Scrape jobs + D1 ingest |
| `scheduled` | EOD sync (07:00 UTC) + overlap scan (08:00 UTC) |

The dashboard is a separate Cloudflare Pages site.

## Quick start

```bash
npm install
npm run db:migrate:local

# Terminal 1 — worker (http://127.0.0.1:8790)
npm run dev:app

# Terminal 2 — dashboard (http://localhost:5190)
npm run dev:dashboard
```

Deploy:

```bash
npm run deploy
```

## Configuration

| Variable | Description |
|---|---|
| `ORG_CREATED_BY_FILTER` | Comma-separated usernames/callers (optional) |
| `SYNC_REGIONS` | Regions for daily cron: `NV,CA,DA` |
| `DIGALERT_SESSION_COOKIES` | JSON cookie object if DigAlert requires auth (secret) |
| `VITE_API_BASE` | Dashboard API URL in production |

## License

Private — ayocollect
