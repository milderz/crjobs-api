import cron from 'node-cron';
import { runScrape } from './scraperJob.js';
import { countJobs } from './db.js';

const CRON_SCHEDULE = process.env.SCRAPE_CRON || '0 6 * * *'; // daily at 06:00
const LOCATION = process.env.SCRAPE_LOCATION || 'costa-rica';
const MAX_ITEMS = parseInt(process.env.SCRAPE_MAX_ITEMS, 10) || 200;
const WITH_DETAILS = process.env.SCRAPE_WITH_DETAILS !== 'false';

export function startScheduler() {
  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      console.log(`[scheduler] starting daily scrape (${CRON_SCHEDULE})`);
      await runScrape({ location: LOCATION, maxItems: MAX_ITEMS, withDetails: WITH_DETAILS });
    },
    { timezone: process.env.SCRAPE_TIMEZONE || 'America/Costa_Rica' }
  );
  console.log(`[scheduler] daily scrape scheduled: ${CRON_SCHEDULE} (${process.env.SCRAPE_TIMEZONE || 'America/Costa_Rica'})`);

  // First boot with empty DB → scrape immediately in the background
  if (countJobs() === 0) {
    console.log('[scheduler] database empty, starting initial scrape');
    runScrape({ location: LOCATION, maxItems: MAX_ITEMS, withDetails: WITH_DETAILS });
  }
}
