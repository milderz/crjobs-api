import { Router } from 'express';
import { runScrape, isScrapeRunning, getScrapeStatus } from '../scraperJob.js';
import { getLastRun, countJobs } from '../db.js';

export const adminRouter = Router();

// POST /api/admin/scrape — trigger a full scrape now (async)
adminRouter.post('/scrape', (req, res) => {
  if (isScrapeRunning()) {
    return res.status(409).json({ error: 'Scrape already running' });
  }
  const { location, maxItems, withDetails } = req.body || {};
  runScrape({
    location: location || 'costa-rica',
    maxItems: maxItems || 200,
    withDetails: withDetails !== false,
  });
  res.status(202).json({ status: 'started', message: 'Scrape running in background' });
});

// GET /api/admin/scrape/status — current run + last completed run
adminRouter.get('/scrape/status', (req, res) => {
  res.json({
    running: isScrapeRunning(),
    inMemory: getScrapeStatus(),
    lastRun: getLastRun(),
    totalJobs: countJobs(),
  });
});
