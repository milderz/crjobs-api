import { scrapeAmazonJobs, getAmazonJobDetails } from './scrapers/amazonJobs.js';
import { scrapeHpeJobs, getHpeJobDetails } from './scrapers/hpe.js';

// Registry of supported job portals.
// Each portal exposes: listJobs({location, maxItems}) and getJobDetails(jobRef)
export const PORTALS = {
  amazon: {
    name: 'amazon.jobs',
    listJobs: scrapeAmazonJobs,
    getJobDetails: getAmazonJobDetails,
  },
  hpe: {
    name: 'HPE Careers',
    listJobs: scrapeHpeJobs,
    getJobDetails: getHpeJobDetails,
  },
  accenture: {
    name: 'Accenture Careers',
    listJobs: scrapeAccentureJobs,
    getJobDetails: getAccentureJobDetails,
  },
};
