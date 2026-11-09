import { getBrowser } from '../browser.js';

const BASE_URL = 'https://amazon.jobs';
const DEFAULT_TIMEOUT = 45_000;

/**
 * Scrapes Amazon.jobs job listings for a location page.
 * The site is a JS SPA using CSS modules, so selectors match on
 * stable class-name fragments (e.g. [class*="job-card-module_root"]).
 *
 * @param {object} options
 * @param {string} [options.location='costa-rica'] - Location slug used in the URL
 * @param {number} [options.maxItems=100] - Max jobs to return
 * @param {number} [options.timeout] - Navigation timeout in ms
 * @returns {Promise<object[]>}
 */
export async function scrapeAmazonJobs({
  location = 'costa-rica',
  maxItems = 100,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  const slug = location.toLowerCase().trim().replace(/\s+/g, '-');
  const url = `${BASE_URL}/content/en/locations/${slug}`;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('a[href^="/jobs/"]', { timeout });

    // Click "Load more"-style pagination until we have enough items or it stops
    for (let i = 0; i < 20; i++) {
      const count = await page.locator('[class*="job-card-module_root"]').count();
      if (count >= maxItems) break;

      const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a')).find((el) =>
          /load more|show more|next|see more/i.test(el.innerText || '')
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (!clicked) break;
      await page.waitForTimeout(1500);
    }

    const jobs = await page.evaluate((baseUrl) => {
      const cards = Array.from(document.querySelectorAll('[class*="job-card-module_root"]'));

      return cards.map((card) => {
        const linkEl = card.querySelector('a[href^="/jobs/"]');
        const titleEl = card.querySelector('h3') || linkEl;
        const headerRoot = card.querySelector('[class*="header-module_root"]');

        // Header root text looks like: "Title\nSan Jose, CRI\nUpdated: 11/6/2026"
        let jobLocation = null;
        if (headerRoot) {
          const lines = (headerRoot.innerText || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          const titleText = (titleEl?.innerText || '').trim();
          jobLocation =
            lines.find((l) => !l.startsWith('Updated') && l !== titleText) || null;
        }

        // Card text layout: title, location, "Updated: ...", description..., "Read more"
        const lines = (card.innerText || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const updatedIdx = lines.findIndex((l) => l.startsWith('Updated'));
        const description =
          updatedIdx >= 0
            ? lines
                .slice(updatedIdx + 1)
                .filter((l) => !/^read more$/i.test(l))
                .join(' ')
                .slice(0, 500) || null
            : null;

        const jobId = linkEl ? linkEl.getAttribute('href').match(/\/jobs\/(\d+)/)?.[1] : null;

        return {
          id: jobId,
          title: (titleEl?.innerText || '').trim(),
          link: jobId ? `${baseUrl}/en/jobs/${jobId}` : null,
          location: jobLocation,
          company: 'Amazon',
          description,
        };
      });
    }, BASE_URL);

    const deduped = new Map();
    for (const job of jobs) {
      if (job.id && !deduped.has(job.id)) deduped.set(job.id, job);
    }

    return Array.from(deduped.values()).slice(0, maxItems);
  } finally {
    await context.close();
  }
}

/**
 * Fetches full details for a single Amazon.jobs posting.
 *
 * @param {string|number} jobId - Numeric job ID (e.g. 10598009)
 * @param {object} [options]
 * @param {number} [options.timeout]
 * @returns {Promise<object>}
 */
export async function getAmazonJobDetails(jobId, { timeout = DEFAULT_TIMEOUT } = {}) {
  const url = `${BASE_URL}/en/jobs/${jobId}`;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('h1.title', { timeout });
    await page.waitForTimeout(1500); // let lazy sections settle

    const details = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/ /g, ' ').trim();

      const result = {
        id: null,
        title: clean(document.querySelector('h1.title')?.innerText),
        url: location.href,
        company: 'Amazon',
        description: null,
        basicQualifications: null,
        preferredQualifications: null,
        location: null,
        team: null,
        category: null,
      };

      const idMatch = location.pathname.match(/\/jobs\/(\d+)/);
      if (idMatch) result.id = idMatch[1];

      // Sections: each h2 is followed by a <p> with the content
      for (const h2 of Array.from(document.querySelectorAll('h2'))) {
        const heading = clean(h2.innerText).toLowerCase();
        const content = h2.nextElementSibling?.innerText;
        if (!content) continue;

        if (heading === 'description') result.description = clean(content);
        else if (heading === 'basic qualifications')
          result.basicQualifications = clean(content);
        else if (heading === 'preferred qualifications')
          result.preferredQualifications = clean(content);
      }

      // Job details associations (location / team / category icons)
      const assoc = (iconClass) => {
        const el = document.querySelector(`.association.${iconClass} .association-content`);
        return el ? clean(el.innerText) : null;
      };
      result.location = assoc('location-icon');
      result.team = assoc('team-icon');
      result.category = assoc('job-category-icon');

      return result;
    });

    return details;
  } finally {
    await context.close();
  }
}
