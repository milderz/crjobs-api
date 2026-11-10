import { PORTALS } from './portals.js';
import { saveJobs, startRun, endRun, countJobs } from './db.js';
import { closeBrowser } from './browser.js';

const DETAIL_CONCURRENCY = parseInt(process.env.SCRAPE_DETAIL_CONCURRENCY, 10) || 4;

let running = false;
let lastResult = null;

export function isScrapeRunning() {
  return running;
}

export function getScrapeStatus() {
  return { running, lastResult };
}

/**
 * Runs a full scrape across all portals and persists results to SQLite.
 * Safe to call concurrently — returns immediately if a run is in progress.
 */
export async function runScrape({ location = 'costa-rica', maxItems = 200, withDetails = true } = {}) {
  if (running) {
    return { skipped: true, reason: 'scrape already running' };
  }
  running = true;
  const runId = startRun();
  let totalSaved = 0;

  try {
    for (const [key, portal] of Object.entries(PORTALS)) {
      try {
        const jobs = await portal.listJobs({ location, maxItems });

        if (withDetails) {
          for (let i = 0; i < jobs.length; i += DETAIL_CONCURRENCY) {
            const batch = jobs.slice(i, i + DETAIL_CONCURRENCY);
            await Promise.all(
              batch.map(async (job) => {
                try {
                  const details = await portal.getJobDetails(job.id || job.link);
                  job.details = details;
                  if (details?.description) {
                    job.summary = job.description;
                    job.description = details.description;
                  }
                } catch {
                  // keep card data if detail fetch fails
                }
              })
            );
          }
        }

        saveJobs(key, jobs);
        totalSaved += jobs.length;
        console.log(`[scrape] ${key}: saved ${jobs.length} jobs`);
      } catch (err) {
        console.error(`[scrape] ${key} failed:`, err.message);
      }
    }

    endRun(runId, 'success', totalSaved);
    lastResult = { status: 'success', jobs: totalSaved, finishedAt: new Date().toISOString() };
    return lastResult;
  } catch (err) {
    endRun(runId, 'error', totalSaved, err.message);
    lastResult = { status: 'error', error: err.message, finishedAt: new Date().toISOString() };
    return lastResult;
  } finally {
    running = false;
    await closeBrowser();
  }
}
