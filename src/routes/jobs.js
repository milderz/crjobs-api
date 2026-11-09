import { Router } from 'express';
import { PORTALS } from '../portals.js';
import { queryJobs, getJob } from '../db.js';
import { cacheGet, cacheSet } from '../cache.js';

export const jobsRouter = Router({ mergeParams: true });

const DETAIL_CONCURRENCY = 4;

/**
 * Visits each job's detail page and attaches the full posting under `details`.
 * Used only in live mode (?live=true).
 */
async function enrichJobsWithDetails(jobs, portal, detailsLimit) {
  const targets = jobs.slice(0, detailsLimit);

  for (let i = 0; i < targets.length; i += DETAIL_CONCURRENCY) {
    const batch = targets.slice(i, i + DETAIL_CONCURRENCY);
    await Promise.all(
      batch.map(async (job) => {
        try {
          const details = await portal.getJobDetails(job.id || job.link);
          job.details = details;
          if (details?.description) {
            job.summary = job.description;
            job.description = details.description;
          }
        } catch (err) {
          job.detailsError = err.message;
        }
      })
    );
  }

  return jobs;
}

function parseDetailsParams(req, limit) {
  const enabled = req.query.details === 'true';
  const detailsLimit = Math.min(parseInt(req.query.detailsLimit, 10) || 20, 100);
  return { enabled, detailsLimit: enabled ? Math.min(detailsLimit, limit) : 0 };
}

function parsePortals(req) {
  if (!req.query.portals) return null;
  return req.query.portals
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => PORTALS[p]);
}

// GET /api/jobs?location=costa-rica&limit=50&offset=0&q=engineer&portals=amazon,hpe&live=true
// Default: serves stored data from SQLite. Add &live=true to scrape on demand.
jobsRouter.get('/', async (req, res, next) => {
  try {
    const location = req.query.location || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const q = req.query.q || null;
    const portals = parsePortals(req);
    const live = req.query.live === 'true';

    if (!live) {
      const { total, jobs } = queryJobs({ portals, location, q, limit, offset });
      return res.json({
        location,
        count: jobs.length,
        total,
        offset,
        limit,
        jobs,
        source: 'database',
      });
    }

    // --- live mode: scrape all portals on demand ---
    const requested = portals || Object.keys(PORTALS);
    const { enabled: wantDetails, detailsLimit } = parseDetailsParams(req, limit);
    const cacheKey = `jobs:all:${location || 'any'}:${limit}:${requested.sort().join(',')}:d${wantDetails ? detailsLimit : 0}`;

    if (req.query.refresh !== 'true') {
      const cached = cacheGet(cacheKey);
      if (cached) return res.json({ ...cached, cached: true });
    }

    const results = await Promise.allSettled(
      requested.map(async (key) => {
        const portal = PORTALS[key];
        let jobs = await portal.listJobs({ location: location || 'costa-rica', maxItems: limit });
        jobs = jobs.map((job) => ({ ...job, portal: key, source: portal.name }));
        if (wantDetails) jobs = await enrichJobsWithDetails(jobs, portal, detailsLimit);
        return jobs;
      })
    );

    const jobs = [];
    const errors = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') jobs.push(...result.value);
      else errors.push({ portal: requested[i], error: result.reason?.message || 'failed' });
    });

    const payload = {
      location,
      count: jobs.length,
      jobs,
      errors: errors.length ? errors : undefined,
      scrapedAt: new Date().toISOString(),
      cached: false,
      source: 'live',
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

function getPortal(req, res, next) {
  const portal = PORTALS[req.params.portal?.toLowerCase()];
  if (!portal) {
    return res.status(404).json({
      error: 'Unknown portal',
      message: `Supported portals: ${Object.keys(PORTALS).join(', ')}`,
    });
  }
  req.portal = portal;
  req.portalKey = req.params.portal.toLowerCase();
  next();
}

// GET /api/jobs/:portal?location=costa-rica&limit=50&live=true
jobsRouter.get('/:portal', getPortal, async (req, res, next) => {
  try {
    const location = req.query.location || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const live = req.query.live === 'true';

    if (!live) {
      const { total, jobs } = queryJobs({
        portals: [req.portalKey],
        location,
        limit,
        offset,
      });
      return res.json({
        source: req.portal.name,
        portal: req.portalKey,
        location,
        count: jobs.length,
        total,
        offset,
        limit,
        jobs,
        dataSource: 'database',
      });
    }

    // --- live mode ---
    const refresh = req.query.refresh === 'true';
    const { enabled: wantDetails, detailsLimit } = parseDetailsParams(req, limit);
    const cacheKey = `jobs:${req.portalKey}:${location || 'any'}:${limit}:d${wantDetails ? detailsLimit : 0}`;

    if (!refresh) {
      const cached = cacheGet(cacheKey);
      if (cached) return res.json({ ...cached, cached: true });
    }

    let jobs = await req.portal.listJobs({ location: location || 'costa-rica', maxItems: limit });
    if (wantDetails) jobs = await enrichJobsWithDetails(jobs, req.portal, detailsLimit);

    const payload = {
      source: req.portal.name,
      portal: req.portalKey,
      location,
      count: jobs.length,
      jobs,
      scrapedAt: new Date().toISOString(),
      cached: false,
      dataSource: 'live',
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:portal/:jobId
// jobId can be a numeric ID or a URL-encoded full job URL.
// Default: serves stored data. Add &live=true to scrape the page on demand.
jobsRouter.get('/:portal/:jobId', getPortal, async (req, res, next) => {
  try {
    const jobRef = decodeURIComponent(req.params.jobId);
    const live = req.query.live === 'true';

    if (!live) {
      // Extract numeric ID if a full URL was passed
      const idMatch = jobRef.match(/(\d{5,})/);
      const jobId = idMatch ? idMatch[1] : jobRef;
      const job = getJob(req.portalKey, jobId);
      if (!job) return res.status(404).json({ error: 'Job not found', jobRef });
      return res.json({
        source: req.portal.name,
        portal: req.portalKey,
        dataSource: 'database',
        job,
      });
    }

    const cacheKey = `job:${req.portalKey}:${jobRef}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const job = await req.portal.getJobDetails(jobRef);
    if (!job || !job.title) {
      return res.status(404).json({ error: 'Job not found', jobRef });
    }

    const payload = {
      source: req.portal.name,
      portal: req.portalKey,
      scrapedAt: new Date().toISOString(),
      cached: false,
      dataSource: 'live',
      job,
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});
