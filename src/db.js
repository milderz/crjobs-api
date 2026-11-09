import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'jobs.db');

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    portal      TEXT NOT NULL,
    job_id      TEXT NOT NULL,
    title       TEXT,
    link        TEXT,
    location    TEXT,
    company     TEXT,
    category    TEXT,
    summary     TEXT,
    description TEXT,
    details     TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    PRIMARY KEY (portal, job_id)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_portal ON jobs(portal);
  CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location);

  CREATE TABLE IF NOT EXISTS scrape_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL,
    jobs_count   INTEGER DEFAULT 0,
    error        TEXT
  );
`);

const upsertJob = db.prepare(`
  INSERT INTO jobs (portal, job_id, title, link, location, company, category, summary, description, details, first_seen, last_seen)
  VALUES (@portal, @job_id, @title, @link, @location, @company, @category, @summary, @description, @details, @now, @now)
  ON CONFLICT(portal, job_id) DO UPDATE SET
    title       = excluded.title,
    link        = excluded.link,
    location    = excluded.location,
    company     = excluded.company,
    category    = excluded.category,
    summary     = excluded.summary,
    description = excluded.description,
    details     = excluded.details,
    last_seen   = excluded.last_seen
`);

const insertRun = db.prepare(
  'INSERT INTO scrape_runs (started_at, status) VALUES (?, ?)'
);
const finishRun = db.prepare(
  'UPDATE scrape_runs SET finished_at = ?, status = ?, jobs_count = ?, error = ? WHERE id = ?'
);
const lastRun = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1');

export function saveJobs(portal, jobs) {
  const now = new Date().toISOString();
  const tx = db.transaction((list) => {
    for (const job of list) {
      if (!job.id) continue;
      upsertJob.run({
        portal,
        job_id: String(job.id),
        title: job.title ?? null,
        link: job.link ?? null,
        location: job.location ?? null,
        company: job.company ?? null,
        category: job.category ?? null,
        summary: job.summary ?? job.description ?? null,
        description: job.description ?? null,
        details: job.details ? JSON.stringify(job.details) : null,
        now,
      });
    }
  });
  tx(jobs);
}

export function startRun() {
  const info = insertRun.run(new Date().toISOString(), 'running');
  return info.lastInsertRowid;
}

export function endRun(id, status, jobsCount = 0, error = null) {
  finishRun.run(new Date().toISOString(), status, jobsCount, error, id);
}

export function getLastRun() {
  return lastRun.get() || null;
}

export function countJobs() {
  return db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
}

export function queryJobs({ portals, location, q, limit = 50, offset = 0 }) {
  const where = [];
  const params = {};

  if (portals?.length) {
    where.push(`portal IN (${portals.map((_, i) => `@p${i}`).join(',')})`);
    portals.forEach((p, i) => (params[`p${i}`] = p));
  }
  if (location) {
    where.push('LOWER(location) LIKE @location');
    params.location = `%${location.toLowerCase()}%`;
  }
  if (q) {
    where.push('(LOWER(title) LIKE @q OR LOWER(description) LIKE @q)');
    params.q = `%${q.toLowerCase()}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.limit = limit;
  params.offset = offset;

  const rows = db
    .prepare(
      `SELECT portal, job_id AS id, title, link, location, company, category,
              summary, description, details, last_seen AS scrapedAt
       FROM jobs ${whereSql}
       ORDER BY last_seen DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params);

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM jobs ${whereSql}`)
    .get(params).c;

  return {
    total,
    jobs: rows.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : undefined,
    })),
  };
}

export function getJob(portal, jobId) {
  const row = db
    .prepare(
      `SELECT portal, job_id AS id, title, link, location, company, category,
              summary, description, details, first_seen, last_seen
       FROM jobs WHERE portal = ? AND job_id = ?`
    )
    .get(portal, String(jobId));

  if (!row) return null;
  return {
    ...row,
    details: row.details ? JSON.parse(row.details) : undefined,
  };
}
