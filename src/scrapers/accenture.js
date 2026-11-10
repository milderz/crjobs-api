const API_URL = 'https://www.accenture.com/api/accenture/elastic/findjobs';
const DETAIL_URL = 'https://www.accenture.com/cr-en/careers/jobdetails';
const DEFAULT_TIMEOUT = 30_000;
const PAGE_SIZE = 50;

// Maps our location slug → Accenture's jobCountry + countrySite params
const LOCATIONS = {
  'costa-rica': { country: 'Costa Rica', site: 'cr-en' },
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function locFor(location) {
  const slug = (location || 'costa-rica').toLowerCase().trim().replace(/\s+/g, '-');
  return LOCATIONS[slug] || { country: 'Costa Rica', site: 'cr-en' };
}

async function findJobs({ startIndex, maxResultSize, country, site }) {
  const fd = new FormData();
  const fields = {
    startIndex: String(startIndex),
    maxResultSize: String(maxResultSize),
    jobKeyword: '',
    jobCountry: country,
    jobLanguage: 'en',
    countrySite: site,
    sortBy: '2',
    searchType: 'vectorSearch',
    enableQueryBoost: 'true',
    minScore: '0.6',
    getFeedbackJudgmentEnabled: 'true',
    useCleanEmbedding: 'true',
    score: 'true',
    totalHits: 'true',
    debugQuery: 'false',
    jobFilters: '[]',
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: 'https://www.accenture.com',
      Referer: `https://www.accenture.com/${site}/careers/jobsearch`,
    },
    body: fd,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Accenture API ${res.status}`);
  return res.json();
}

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Scrapes Accenture job listings via their elastic search API.
 * Paginates with startIndex (equivalent to clicking "next").
 *
 * @param {object} options
 * @param {string} [options.location='costa-rica']
 * @param {number} [options.maxItems=200]
 * @returns {Promise<object[]>}
 */
export async function scrapeAccentureJobs({ location = 'costa-rica', maxItems = 200 } = {}) {
  const { country, site } = locFor(location);
  const jobs = [];
  const seen = new Set();

  for (let start = 0; jobs.length < maxItems; start += PAGE_SIZE) {
    const data = await findJobs({ startIndex: start, maxResultSize: PAGE_SIZE, country, site });
    const batch = data.data || [];
    if (!batch.length) break;

    for (const j of batch) {
      if (!j.guid || seen.has(j.guid)) continue;
      seen.add(j.guid);

      const locs = Array.isArray(j.location) ? j.location.filter(Boolean) : [];
      const link = (j.jobDetailUrl || '').replace('{0}', site);
      const summary =
        j.staticExtractiveSummary ||
        j.azureopenaiSummary ||
        (j.jobDescriptionClean || '').slice(0, 400);

      jobs.push({
        id: j.guid,
        title: j.title,
        link,
        location: locs.join(', ') || j.feedCity || j.country || null,
        company: 'Accenture',
        category: (j.jobFamilyGroup || []).join(', ') || j.businessArea || null,
        employmentType: j.jobScheduleDescription || j.employeeType || null,
        postedDate: j.postedDateText || null,
        summary: summary || null,
        description: j.jobDescriptionClean || null,
      });
      if (jobs.length >= maxItems) break;
    }

    const total = data.totalHits?.total;
    if (typeof total === 'number' && start + PAGE_SIZE >= total) break;
    if (batch.length < PAGE_SIZE) break;
  }

  return jobs;
}

/**
 * Fetches full details for a single Accenture posting.
 * The jobdetails page is server-rendered with schema.org JobPosting JSON-LD.
 *
 * @param {string} jobId - guid, e.g. "R00360211_en"
 * @returns {Promise<object>}
 */
export async function getAccentureJobDetails(jobId) {
  const url = `${DETAIL_URL}?id=${encodeURIComponent(jobId)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Accenture detail ${res.status}`);
  const html = await res.text();

  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No JobPosting JSON-LD found');

  const ld = JSON.parse(match[1]);
  const loc = ld.jobLocation?.[0]?.address || {};

  return {
    id: jobId,
    title: ld.title || null,
    url,
    company: 'Accenture',
    description: stripHtml(ld.description) || null,
    qualifications: stripHtml(ld.qualifications) || null,
    location: [loc.addressLocality, loc.addressCountry].filter((v) => v && v !== 'unavailable').join(', ') || null,
    employmentType: ld.employmentType || null,
    postedDate: ld.datePosted || null,
    category: ld.occupationalCategory || null,
  };
}
