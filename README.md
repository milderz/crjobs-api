# crjobs-api

Multi-portal job board scraping API built with Node.js, Express, Playwright, and SQLite.

Scrapers run **once a day** (scheduled) and store results in a local SQLite database. The API serves stored data instantly — no scraping on request.

## Setup

```bash
npm install
npm run install:browsers   # downloads Chromium for Playwright
node src/server.js          # or: npm run dev
```

API listens on `http://localhost:3000` (override with `PORT`).

On first boot with an empty database, an initial scrape starts automatically in the background.

## How it works

- **Scheduler** (`src/scheduler.js`) — runs a full scrape daily at 06:00 (`America/Costa_Rica`, configurable via env).
- **Scrape job** (`src/scraperJob.js`) — for each portal: fetches listings, visits every job's detail page, upserts into SQLite.
- **API** — reads from SQLite; sub-millisecond responses.

## Endpoints

### All job listings (stored)

```
GET /api/jobs?location=costa-rica&limit=50&offset=0&q=engineer&portals=amazon,hpe
```

| Param    | Default | Description                                |
|----------|---------|--------------------------------------------|
| location | —       | Filter by location (partial match)         |
| q        | —       | Full-text search in title/description      |
| portals  | all     | Comma-separated: `amazon`, `hpe`           |
| limit    | 50      | Max results (cap 200)                      |
| offset   | 0       | Pagination offset                          |

Response includes `total` for pagination. Each job has `id`, `title`, `link`, `location`, `company`, `category`, `summary`, `description` (full text), `details` (raw page data), `scrapedAt`.

### Single portal listings (stored)

```
GET /api/jobs/amazon?location=costa-rica&limit=50
GET /api/jobs/hpe?limit=50
```

### Job details (stored)

```
GET /api/jobs/amazon/10598009
GET /api/jobs/hpe/1213007
```

`jobId` can be the numeric ID or a URL-encoded full job URL.

### Live scraping (on demand)

Add `&live=true` to any listing/detail endpoint to scrape the portal in real time instead of reading the DB:

```
GET /api/jobs?live=true&details=true&detailsLimit=20
GET /api/jobs/hpe/1213007?live=true
```

Live mode supports `details=true` + `detailsLimit` (default 20, cap 100) and the in-memory cache.

### Scrape administration

```
POST /api/admin/scrape          → trigger a full scrape now (async, 202)
GET  /api/admin/scrape/status   → running flag, last run, total jobs
```

`POST /api/admin/scrape` body (optional): `{ "location": "costa-rica", "maxItems": 200, "withDetails": true }`

### Health

```
GET /api/health
```

### Generic scraper (no storage)

```
POST /api/scrape
Content-Type: application/json

{
  "url": "https://example.com/jobs",
  "selectors": {
    "item": ".job-card",
    "title": ".job-card h2",
    "link": "a.job-link",
    "location": ".job-card .location",
    "company": ".job-card .company",
    "description": ".job-card .desc"
  },
  "waitFor": ".job-card",
  "maxItems": 50,
  "timeout": 30000
}
```

Only `url` and `selectors.item` are required.

## Configuration (.env)

| Var                | Default              | Description                          |
|--------------------|----------------------|--------------------------------------|
| PORT               | 3000                 | HTTP port                            |
| DB_PATH            | ./jobs.db            | SQLite database file                 |
| SCRAPE_CRON        | `0 6 * * *`          | Cron schedule for daily scrape       |
| SCRAPE_TIMEZONE    | America/Costa_Rica   | Timezone for the schedule            |
| SCRAPE_LOCATION    | costa-rica           | Location slug to scrape              |
| SCRAPE_MAX_ITEMS   | 200                  | Max jobs per portal per run          |
| SCRAPE_WITH_DETAILS| true                 | Visit each job page during scrape    |

## Adding a new portal

1. Create `src/scrapers/<portal>.js` exporting `scrape<Portal>Jobs({location, maxItems})` and `get<Portal>JobDetails(jobRef)`.
2. Register it in `PORTALS` in `src/portals.js`.
3. It is automatically included in the daily scrape and all API endpoints.

## Notes

- Playwright runs headless Chromium; each scrape gets a fresh browser context.
- Playwright is pinned to 1.49.x and better-sqlite3 to 11.x for Node 18 compatibility.
- Jobs are upserted by `(portal, job_id)` — `first_seen`/`last_seen` track freshness; jobs that disappear from a portal remain in the DB.
- Respect each site's `robots.txt` and terms of service.
