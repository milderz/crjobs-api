import { getBrowser } from '../browser.js';

const DEFAULT_TIMEOUT = 30_000;

/**
 * Generic Playwright scraper.
 *
 * @param {object} options
 * @param {string} options.url - Page URL to scrape
 * @param {object} options.selectors - CSS selectors for fields
 * @param {string} options.selectors.item - Selector matching each repeated item (required)
 * @param {string} [options.selectors.title] - Title field within an item
 * @param {string} [options.selectors.link] - Link field within an item
 * @param {string} [options.selectors.location] - Location field within an item
 * @param {string} [options.selectors.company] - Company field within an item
 * @param {string} [options.selectors.description] - Description field within an item
 * @param {string} [options.waitFor] - Selector to wait for before extracting (defaults to item selector)
 * @param {number} [options.maxItems] - Cap on number of items returned
 * @param {number} [options.timeout] - Navigation timeout in ms
 * @returns {Promise<object[]>}
 */
export async function scrapePage({
  url,
  selectors,
  waitFor,
  maxItems = 100,
  timeout = DEFAULT_TIMEOUT,
}) {
  if (!url) throw new Error('url is required');
  if (!selectors?.item) throw new Error('selectors.item is required');

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForSelector(waitFor || selectors.item, { timeout });

    const items = await page.$$eval(
      selectors.item,
      (nodes, { selectors, maxItems }) => {
        const text = (el, sel) => {
          if (!sel) return null;
          const target = sel === ':scope' ? el : el.querySelector(sel);
          return target ? target.innerText.trim() : null;
        };
        const href = (el, sel) => {
          if (!sel) return null;
          const target = el.querySelector(sel);
          if (!target) return null;
          return target.href || target.getAttribute('href');
        };

        return nodes.slice(0, maxItems).map((el) => ({
          title: text(el, selectors.title),
          link: href(el, selectors.link),
          location: text(el, selectors.location),
          company: text(el, selectors.company),
          description: text(el, selectors.description),
        }));
      },
      { selectors, maxItems }
    );

    return items.filter((i) => i.title || i.link);
  } finally {
    await context.close();
  }
}
