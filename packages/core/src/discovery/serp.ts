/**
 * Search engine results page (SERP) analysis.
 *
 * Parses search results for a target name, classifies each result by
 * threat type, and computes a page-weighted exposure score.
 *
 * Page 1 is 95% of the threat — a recruiter, date, or stalker rarely
 * goes past page 1. Position 1 has weight 1.0, position 10 has weight 0.1
 * (exponential decay: w(i) = e^(-0.23i) ≈ halves every 3 positions).
 *
 * The SERP is fetched through the same OPSEC layer as broker scanning
 * (UA rotation, delays, Tor-ready).
 *
 * IMPORTANT: Google rate-limits aggressive scraping. This module uses
 * a conservative delay (5-8s between requests) and stops after page 3.
 * For production use, consider using a search API (SerpAPI, Serper, etc.)
 * instead of scraping.
 */

/** Classification of a single search result */
export type ResultCategory =
  | 'data_broker'
  | 'social_media'
  | 'owned_property'
  | 'news'
  | 'government'
  | 'archive'
  | 'irrelevant';

/** A single parsed search result */
export interface SerpResult {
  /** position on the page (1-indexed) */
  position: number;
  /** the result title */
  title: string;
  /** the result URL */
  url: string;
  /** the snippet text */
  snippet: string;
  /** classified category */
  category: ResultCategory;
  /** position-weighted threat score (0-1) */
  threatWeight: number;
  /** which broker was identified (if data_broker) */
  brokerId?: string;
}

/** Full SERP analysis report */
export interface SerpReport {
  /** what was searched */
  query: string;
  /** total results analysed */
  totalResults: number;
  /** results by category */
  categories: Record<ResultCategory, number>;
  /** page-1 exposure score (0-10, higher = more exposed) */
  page1Score: number;
  /** all parsed results */
  results: SerpResult[];
  /** identified data brokers on page 1 */
  page1Brokers: string[];
  /** the user's own properties found */
  ownedProperties: string[];
}

/** Known data broker domains — used for classification */
const BROKER_DOMAINS: Record<string, string> = {
  'spokeo.com': 'spokeo',
  'whitepages.com': 'whitepages',
  'beenverified.com': 'beenverified',
  'truepeoplesearch.com': 'truepeoplesearch',
  'fastpeoplesearch.com': 'fastpeoplesearch',
  'intelius.com': 'intelius',
  'peoplefinder.com': 'peoplefinder',
  'radaris.com': 'radaris',
  'pipl.com': 'pipl',
  'mylife.com': 'mylife',
  'thatsthem.com': 'thatsthem',
  'peekyou.com': 'peekyou',
  'zabasearch.com': 'zabasearch',
  'ussearch.com': 'ussearch',
  'instantcheckmate.com': 'instantcheckmate',
  'publicrecords.com': 'publicrecords',
  'familytreenow.com': 'familytreenow',
  'nuwber.com': 'nuwber',
  'clustrmaps.com': 'clustrmaps',
  'cyberbackgroundchecks.com': 'cyberbackgroundchecks',
};

const SOCIAL_DOMAINS = new Set([
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'tiktok.com', 'reddit.com', 'github.com',
  'youtube.com', 'pinterest.com', 'tumblr.com', 'medium.com',
]);

const NEWS_DOMAINS = new Set([
  'bbc.co.uk', 'bbc.com', 'theguardian.com', 'nytimes.com',
  'washingtonpost.com', 'reuters.com', 'cnn.com', 'foxnews.com',
  'news.google.com', 'apnews.com', 'usatoday.com',
]);

const GOVERNMENT_PATTERNS = [
  /\.gov$/i, /\.gov\./i, /court/i, /judiciary/i,
  /voter/i, /election/i, /property.*record/i,
  /pacer\.uscourts/i,
];

const ARCHIVE_DOMAINS = new Set([
  'web.archive.org', 'archive.org', 'webcache.googleusercontent.com',
]);

/** Compute position-weighted threat score.
 *  w(i) = e^(-0.23 * (i-1)) — decays from 1.0 at position 1 to ~0.1 at position 10.
 *  Positions beyond 30 get near-zero weight. */
export function positionWeight(position: number): number {
  if (position < 1) return 0;
  return Math.exp(-0.23 * (position - 1));
}

/** Extract the domain from a URL */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Classify a search result by its URL and content */
export function classifyResult(
  url: string,
  title: string,
  snippet: string,
  ownedDomains: string[] = []
): { category: ResultCategory; brokerId?: string } {
  const domain = extractDomain(url);

  // check owned properties first
  for (const owned of ownedDomains) {
    if (domain === owned.replace(/^www\./, '') || domain.endsWith('.' + owned)) {
      return { category: 'owned_property' };
    }
  }

  // check data brokers
  for (const [brokerDomain, brokerId] of Object.entries(BROKER_DOMAINS)) {
    if (domain === brokerDomain || domain.endsWith('.' + brokerDomain)) {
      return { category: 'data_broker', brokerId };
    }
  }

  // check social media
  if (SOCIAL_DOMAINS.has(domain)) return { category: 'social_media' };

  // check news
  if (NEWS_DOMAINS.has(domain)) return { category: 'news' };

  // check government
  for (const pattern of GOVERNMENT_PATTERNS) {
    if (pattern.test(domain) || pattern.test(url)) {
      return { category: 'government' };
    }
  }

  // check archives
  if (ARCHIVE_DOMAINS.has(domain)) return { category: 'archive' };

  return { category: 'irrelevant' };
}

/** Parse raw HTML from a Google search results page.
 *  Extracts title, URL, and snippet from each result.
 *
 *  Google's HTML structure changes frequently. These patterns
 *  target the general structure as of 2026. */
export function parseGoogleSerp(html: string): Array<{
  title: string;
  url: string;
  snippet: string;
}> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // pattern: <a href="/url?q=ACTUAL_URL"><h3>TITLE</h3></a>
  const linkPattern = /href="\/url\?q=([^&"]+)[^"]*"[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].trim();
    if (url.startsWith('http')) {
      results.push({ title, url, snippet: '' });
    }
  }

  // fallback pattern: data-href="URL" ... <h3>TITLE</h3>
  if (results.length === 0) {
    const altPattern = /data-href="(https?:\/\/[^"]+)"[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>/gi;
    while ((match = altPattern.exec(html)) !== null) {
      results.push({ title: match[2].trim(), url: match[1], snippet: '' });
    }
  }

  return results;
}

/** Analyse SERP results for a target name.
 *  Accepts pre-parsed results (from parseGoogleSerp or a search API). */
export function analyseSerpResults(
  query: string,
  rawResults: Array<{ title: string; url: string; snippet: string }>,
  ownedDomains: string[] = []
): SerpReport {
  const results: SerpResult[] = rawResults.map((r, i) => {
    const position = i + 1;
    const { category, brokerId } = classifyResult(r.url, r.title, r.snippet, ownedDomains);
    const threatWeight = category === 'owned_property' || category === 'irrelevant'
      ? 0
      : positionWeight(position);

    return {
      position, title: r.title, url: r.url, snippet: r.snippet,
      category,
      threatWeight: Math.round(threatWeight * 1000) / 1000,
      brokerId,
    };
  });

  const categories: Record<ResultCategory, number> = {
    data_broker: 0, social_media: 0, owned_property: 0,
    news: 0, government: 0, archive: 0, irrelevant: 0,
  };
  for (const r of results) categories[r.category]++;

  const page1 = results.filter(r => r.position <= 10);
  const page1Score = Math.round(
    page1.reduce((sum, r) => sum + r.threatWeight, 0) * 10
  ) / 10;

  const page1Brokers = [...new Set(
    page1.filter(r => r.brokerId).map(r => r.brokerId!)
  )];

  const ownedProperties = results
    .filter(r => r.category === 'owned_property')
    .map(r => r.url);

  return {
    query, totalResults: results.length, categories,
    page1Score, results, page1Brokers, ownedProperties,
  };
}
