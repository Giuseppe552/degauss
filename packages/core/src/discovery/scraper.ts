/**
 * Discovery engine — automated exposure scanning.
 *
 * Searches people-search broker sites for a target's PII and extracts
 * quasi-identifiers from the results. This is what makes the tool
 * usable — without it, users have to hand-craft profile JSON.
 *
 * OPSEC considerations:
 *   - Searches are proxied through Tor or SOCKS5 when available
 *   - User-Agent rotates between common browser fingerprints
 *   - Request timing uses randomised delays (not fixed intervals)
 *   - No cookies persisted between requests
 *   - The tool itself should not create more tracking surface than it removes
 *
 * Architecture:
 *   Each broker has a ScanTarget definition (search URL template, CSS selectors
 *   for extracting QIs). The scanner hits each target, parses results, and
 *   returns ExposureRecord[]. Parsing is done with regex on raw HTML —
 *   no headless browser dependency in the core library.
 *
 *   Headless browser scanning (for JS-rendered pages) lives in apps/cli
 *   as an optional Playwright-based scanner.
 */

import type { ExposureRecord, QIField, QuasiIdentifier } from '../quantify/types.js';

/** Definition of a scannable data broker */
export interface ScanTarget {
  /** broker identifier */
  id: string;
  /** human-readable name */
  name: string;
  /** URL template — {name}, {city}, {state} are replaced */
  searchUrl: string;
  /** CSS-like patterns for extracting QIs from raw HTML */
  extractors: QIExtractor[];
  /** typical response delay to avoid rate limiting (ms) */
  delayMs: number;
  /** does this broker require JS rendering? */
  requiresJS: boolean;
  /** difficulty of removal (0-1) */
  removalDifficulty: number;
}

export interface QIExtractor {
  field: QIField;
  /** regex pattern to extract the value from HTML */
  pattern: RegExp;
  /** which capture group contains the value (default 1) */
  group?: number;
}

/** Result of scanning a single broker */
export interface ScanResult {
  target: ScanTarget;
  /** was a matching profile found? */
  found: boolean;
  /** the extracted record, if found */
  record?: ExposureRecord;
  /** raw URL that was scanned */
  url: string;
  /** HTTP status code */
  status: number;
  /** error if the scan failed */
  error?: string;
  /** time taken (ms) */
  durationMs: number;
}

/** User-Agent strings for rotation — common browsers, recent versions.
 *  A privacy tool with a unique UA is self-defeating. */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
];

/** Known people-search broker scan targets.
 *  These are the clearnet people-search sites that aggregate PII.
 *  Each has a search URL and extraction patterns.
 *
 *  IMPORTANT: patterns are fragile — broker sites change layouts frequently.
 *  These represent the general structure as of 2026. */
export const SCAN_TARGETS: ScanTarget[] = [
  {
    id: 'fastpeoplesearch',
    name: 'FastPeopleSearch',
    searchUrl: 'https://www.fastpeoplesearch.com/name/{name}_{city}-{state}',
    extractors: [
      { field: 'full_name', pattern: /<h2[^>]*class="[^"]*card-title[^"]*"[^>]*>([^<]+)<\/h2>/i },
      { field: 'address', pattern: /<span[^>]*class="[^"]*full-address[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'phone', pattern: /href="tel:([+\d\-]+)"/i },
      { field: 'city', pattern: /<span[^>]*class="[^"]*locality[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'state', pattern: /<span[^>]*class="[^"]*region[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'birth_year', pattern: /Age\s+(\d{2,3})/i },
    ],
    delayMs: 3000,
    requiresJS: false,
    removalDifficulty: 0.3,
  },
  {
    id: 'truepeoplesearch',
    name: 'TruePeopleSearch',
    searchUrl: 'https://www.truepeoplesearch.com/results?name={name}&citystatezip={city}+{state}',
    extractors: [
      { field: 'full_name', pattern: /<div[^>]*class="[^"]*h4[^"]*"[^>]*><a[^>]*>([^<]+)<\/a>/i },
      { field: 'address', pattern: /<span[^>]*class="[^"]*curr-address[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'phone', pattern: />\s*\((\d{3})\)\s*(\d{3})-(\d{4})\s*</i },
      { field: 'birth_year', pattern: /Age\s+(\d+)/i },
    ],
    delayMs: 4000,
    requiresJS: false,
    removalDifficulty: 0.3,
  },
  {
    id: 'spokeo',
    name: 'Spokeo',
    searchUrl: 'https://www.spokeo.com/{name}',
    extractors: [
      { field: 'full_name', pattern: /<h1[^>]*>([^<]+)<\/h1>/i },
      { field: 'city', pattern: /<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'birth_year', pattern: /Age\s*:?\s*(\d+)/i },
    ],
    delayMs: 5000,
    requiresJS: true, // Spokeo renders with JS
    removalDifficulty: 0.3,
  },
  {
    id: 'whitepages',
    name: 'WhitePages',
    searchUrl: 'https://www.whitepages.com/name/{name}/{city}-{state}',
    extractors: [
      { field: 'full_name', pattern: /<a[^>]*class="[^"]*person-name[^"]*"[^>]*>([^<]+)<\/a>/i },
      { field: 'address', pattern: /<span[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)<\/span>/i },
      { field: 'phone', pattern: />\s*(\(\d{3}\)\s*\d{3}-\d{4})\s*</i },
    ],
    delayMs: 4000,
    requiresJS: false,
    removalDifficulty: 0.3,
  },
  {
    id: 'beenverified',
    name: 'BeenVerified',
    searchUrl: 'https://www.beenverified.com/people/{name}/',
    extractors: [
      { field: 'full_name', pattern: /<h2[^>]*>([^<]+)<\/h2>/i },
      { field: 'city', pattern: /<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)<\/span>/i },
    ],
    delayMs: 5000,
    requiresJS: true,
    removalDifficulty: 0.4,
  },
  {
    id: 'radaris',
    name: 'Radaris',
    searchUrl: 'https://radaris.com/p/{name}/',
    extractors: [
      { field: 'full_name', pattern: /<h1[^>]*>([^<]+)<\/h1>/i },
      { field: 'address', pattern: /<div[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)<\/div>/i },
      { field: 'phone', pattern: /(\d{3}[-.)]\s*\d{3}[-.)]\s*\d{4})/i },
    ],
    delayMs: 5000,
    requiresJS: true,
    removalDifficulty: 0.8,
  },
];

/** Scan configuration */
export interface ScanConfig {
  /** target name to search for */
  name: string;
  /** city (optional, improves accuracy) */
  city?: string;
  /** state/region (optional) */
  state?: string;
  /** SOCKS5 proxy URL for Tor routing (e.g., socks5://127.0.0.1:9050) */
  proxy?: string;
  /** which brokers to scan (default: all non-JS targets) */
  targets?: string[];
  /** skip JS-rendered sites (default: true — no headless browser in core) */
  skipJS?: boolean;
  /** custom fetch function (for testing or proxy injection) */
  fetchFn?: typeof fetch;
  /** max concurrent requests */
  concurrency?: number;
}

/** Build the search URL for a target */
export function buildSearchUrl(target: ScanTarget, config: ScanConfig): string {
  const nameParts = config.name.trim().split(/\s+/);
  const nameSlug = nameParts.join('-');
  const nameEncoded = encodeURIComponent(config.name);

  return target.searchUrl
    .replace('{name}', target.id === 'fastpeoplesearch' ? nameSlug : nameEncoded)
    .replace('{city}', encodeURIComponent(config.city ?? ''))
    .replace('{state}', encodeURIComponent(config.state ?? ''));
}

/** Extract QIs from raw HTML using a target's extractors */
export function extractQIs(
  html: string,
  target: ScanTarget,
  targetName: string
): QuasiIdentifier[] {
  const qis: QuasiIdentifier[] = [];

  for (const ext of target.extractors) {
    const match = html.match(ext.pattern);
    if (match) {
      const value = (match[ext.group ?? 1] ?? '').trim();
      if (value && value.length > 1) {
        // for birth_year extractor: convert age to year
        let finalValue = value;
        if (ext.field === 'birth_year' && /^\d{2,3}$/.test(value)) {
          const age = parseInt(value);
          if (age > 0 && age < 120) {
            finalValue = String(new Date().getFullYear() - age);
          }
        }

        // for phone: normalise capture groups
        if (ext.field === 'phone' && match[2]) {
          finalValue = `(${match[1]}) ${match[2]}-${match[3]}`;
        }

        qis.push({
          field: ext.field,
          value: finalValue,
          source: target.id,
        });
      }
    }
  }

  // verify the result actually matches the target name (not a random person)
  const nameQI = qis.find(q => q.field === 'full_name');
  if (nameQI) {
    const found = nameQI.value.toLowerCase();
    const target_ = targetName.toLowerCase();
    // fuzzy: at least the last name should match
    const targetParts = target_.split(/\s+/);
    const lastName = targetParts[targetParts.length - 1];
    if (!found.includes(lastName)) {
      return []; // wrong person — don't return false matches
    }
  }

  return qis;
}

/** Pick a random user agent deterministically from the seed */
function pickUA(seed: number): string {
  return USER_AGENTS[((seed * 2654435761) >>> 0) % USER_AGENTS.length];
}

/** Randomised delay with jitter (±30%) */
function jitteredDelay(baseMs: number): number {
  const jitter = baseMs * 0.3;
  // deterministic-ish but varied per call
  return baseMs + (Math.random() * 2 - 1) * jitter;
}

/** Scan a single broker target.
 *  Returns a ScanResult with extracted QIs if found. */
export async function scanTarget(
  target: ScanTarget,
  config: ScanConfig
): Promise<ScanResult> {
  const url = buildSearchUrl(target, config);
  const start = Date.now();

  if (config.skipJS !== false && target.requiresJS) {
    return {
      target,
      found: false,
      url,
      status: 0,
      error: 'skipped — requires JS rendering (use --browser flag)',
      durationMs: 0,
    };
  }

  try {
    const fetchFn = config.fetchFn ?? globalThis.fetch;
    const ua = pickUA(start);

    const response = await fetchFn(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'DNT': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      redirect: 'follow',
    });

    const html = await response.text();
    const qis = extractQIs(html, target, config.name);

    const found = qis.length > 0;
    const record: ExposureRecord | undefined = found ? {
      source: target.id,
      url,
      qis,
      discoveredAt: Date.now(),
      status: 'active',
    } : undefined;

    return {
      target,
      found,
      record,
      url,
      status: response.status,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      target,
      found: false,
      url,
      status: 0,
      error: err.message ?? 'unknown error',
      durationMs: Date.now() - start,
    };
  }
}

/** Scan all configured broker targets sequentially with delays.
 *  Returns results for each target. */
export async function scanAll(config: ScanConfig): Promise<ScanResult[]> {
  const targets = config.targets
    ? SCAN_TARGETS.filter(t => config.targets!.includes(t.id))
    : SCAN_TARGETS;

  const results: ScanResult[] = [];

  for (const target of targets) {
    const result = await scanTarget(target, config);
    results.push(result);

    // delay between requests to avoid rate limiting
    if (target !== targets[targets.length - 1]) {
      const delay = jitteredDelay(target.delayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}

/** Convert scan results to ExposureRecord[] for the scoring engine */
export function resultsToRecords(results: ScanResult[]): ExposureRecord[] {
  return results
    .filter(r => r.found && r.record)
    .map(r => r.record!);
}
