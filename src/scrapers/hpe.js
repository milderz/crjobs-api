import { getBrowser } from '../browser.js';

const BASE_URL = 'https://careers.hpe.com';
const DEFAULT_TIMEOUT = 60_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function newPage() {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-US' });
  return { context, page: await context.newPage() };
}

/**
 * Scrapes HPE careers job listings for a location page.
 * HPE uses the Phenom platform; job cards are `div.phw-card-block`.
 *
 * @param {object} options
 * @param {string} [options.location='costa-rica'] - Location slug (e.g. 'costa-rica')
 * @param {number} [options.maxItems=100]
 * @param {number} [options.timeout]
 * @returns {Promise<object[]>}
 */
export async function scrapeHpeJobs({
  location = 'costa-rica',
  maxItems = 100,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  const slug = location.toLowerCase().trim().replace(/\s+/g, '-');
  const url = `${BASE_URL}/us/en/locations-${slug}`;

  const { context, page } = await newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('a[href*="/us/en/job/"]', { timeout });
    await page.waitForTimeout(3000); // let Phenom widgets hydrate

    const jobs = new Map();

    const extractCards = async () => {
      const cards = await page.evaluate((baseUrl) => {
        const nodes = Array.from(document.querySelectorAll('div.phw-card-block'));
        return nodes
          .filter((card) => card.querySelector('a[href*="/us/en/job/"]'))
          .map((card) => {
            const linkEl = card.querySelector('a[href*="/us/en/job/"]');
            const titleEl = card.querySelector('h3 a') || linkEl;

            // Card text layout:
            // Title\n<snippet>\nLocation:\nX\nCategory:\nY\nJob ID:\nZ\nApply Now
            const lines = (card.innerText || '')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);

            const field = (label) => {
              const idx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
              return idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : null;
            };

            const title = (titleEl?.innerText || '').trim();
            const locIdx = lines.findIndex((l) => l.toLowerCase() === 'location:');
            const snippet =
              locIdx > 1 ? lines.slice(1, locIdx).join(' ').slice(0, 500) : null;

            const href = linkEl.getAttribute('href');
            const idMatch = href.match(/\/job\/(\d+)/);

            return {
              id: idMatch ? idMatch[1] : null,
              title,
              link: href ? new URL(href, baseUrl).toString() : null,
              location: field('Location:'),
              category: field('Category:'),
              company: 'HPE',
              description: snippet,
            };
          });
      }, BASE_URL);

      for (const job of cards) {
        if (job.id && !jobs.has(job.id)) jobs.set(job.id, job);
      }
    };

    await extractCards();

    // Follow "View More" to the targeted-jobs search page, then keep
    // clicking "Load more" until we hit maxItems or pagination ends.
    const viewMore = page.locator('a:has-text("View More"), a:has-text("View more")').first();
    if (await viewMore.count()) {
      await viewMore.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      await extractCards();
    }

    for (let i = 0; i < 30 && jobs.size < maxItems; i++) {
      const before = jobs.size;
      const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a')).find((el) =>
          /^\s*(load more|show more|view more)\s*$/i.test(el.innerText || '')
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (!clicked) break;
      await page.waitForTimeout(2500);
      await extractCards();
      if (jobs.size === before) break; // clicked but nothing new loaded
    }

    return Array.from(jobs.values()).slice(0, maxItems);
  } finally {
    await context.close();
  }
}

/**
 * Fetches full details for a single HPE job posting.
 *
 * @param {string} jobRef - Full job URL or numeric job ID
 * @param {object} [options]
 * @param {number} [options.timeout]
 * @returns {Promise<object>}
 */
export async function getHpeJobDetails(jobRef, { timeout = DEFAULT_TIMEOUT } = {}) {
  const url = /^https?:\/\//.test(jobRef)
    ? jobRef
    : `${BASE_URL}/us/en/job/${jobRef}`;

  const { context, page } = await newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector('h1', { timeout });
    await page.waitForTimeout(3000); // let Phenom widgets hydrate

    const details = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/ /g, ' ').trim();

      const result = {
        id: null,
        title: clean(document.querySelector('h1')?.innerText),
        url: location.href,
        company: 'HPE',
        location: null,
        category: null,
        description: null,
      };

      const idMatch = location.pathname.match(/\/job\/(\d+)/);
      if (idMatch) result.id = idMatch[1];

      // Labeled fields in the job header: "Location:\nX\nCategory:\nY\nJob ID:\nZ"
      const bodyText = clean(document.body.innerText);
      const field = (label) => {
        const re = new RegExp(`${label}:\\s*\\n?([^\\n]+)`, 'i');
        const m = bodyText.match(re);
        return m ? m[1].trim() : null;
      };
      result.location = field('Location');
      result.category = field('Category');

      // Full description lives in the Phenom job-description widget
      const descEl =
        document.querySelector('.phw-job-description') ||
        document.querySelector('.jd-job-details-description');
      result.description = descEl ? clean(descEl.innerText) : null;

      return result;
    });

    return details;
  } finally {
    await context.close();
  }
}
