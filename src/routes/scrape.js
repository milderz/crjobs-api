import { Router } from 'express';
import { scrapePage } from '../scrapers/generic.js';

export const scrapeRouter = Router();

// POST /api/scrape
// Body: {
//   "url": "https://example.com/jobs",
//   "selectors": {
//     "item": ".job-card",
//     "title": ".job-card h2",
//     "link": "a.job-link",
//     "location": ".job-card .location",
//     "company": ".job-card .company"
//   },
//   "waitFor": ".job-card",       // optional
//   "maxItems": 50,               // optional
//   "timeout": 30000              // optional
// }
scrapeRouter.post('/', async (req, res, next) => {
  try {
    const { url, selectors, waitFor, maxItems, timeout } = req.body || {};

    if (!url || !selectors?.item) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Body must include "url" and "selectors.item"',
      });
    }

    const jobs = await scrapePage({ url, selectors, waitFor, maxItems, timeout });

    res.json({
      source: url,
      count: jobs.length,
      jobs,
      scrapedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
