/**
 * Wayback Machine + Google Cache forensics.
 *
 * Data brokers remove your listing but cached copies survive:
 *   - Wayback Machine (archive.org) — historical snapshots
 *   - Google Cache — recent cached version
 *   - Common paste sites — leaked PII dumps
 *
 * These are "zombie records" — technically removed but still findable.
 * This module checks for them and reports what's still accessible.
 *
 * Uses the Wayback Machine CDX API (no auth required, free, rate-limited).
 * Reference: web.archive.org/cdx/search/cdx
 */

/** A cached snapshot of a URL */
export interface CachedSnapshot {
  /** where the cache is from */
  source: 'wayback' | 'google_cache';
  /** the original URL that was cached */
  originalUrl: string;
  /** URL to access the cached version */
  cacheUrl: string;
  /** when the snapshot was taken */
  timestamp: string;
  /** HTTP status at time of capture */
  statusCode: number;
  /** MIME type */
  mimeType: string;
}

/** Full archive forensics report */
export interface ArchiveReport {
  /** URLs that were checked */
  urlsChecked: string[];
  /** cached snapshots found */
  snapshots: CachedSnapshot[];
  /** URLs with no cached versions (clean) */
  clean: string[];
  /** URLs with cached versions (zombie data) */
  zombies: string[];
  /** total snapshot count */
  totalSnapshots: number;
}

/** Parse a Wayback Machine CDX API response.
 *
 *  CDX format (one line per capture):
 *    urlkey timestamp original mimetype statuscode digest length
 *
 *  Example:
 *    com,spokeo)/jane-doe 20250315120000 https://spokeo.com/Jane-Doe text/html 200 ABC123 45678
 */
export function parseCdxResponse(
  cdxText: string,
  originalUrl: string
): CachedSnapshot[] {
  const lines = cdxText.trim().split('\n').filter(l => l.length > 0);
  const snapshots: CachedSnapshot[] = [];

  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length < 7) continue;

    const [, timestamp, original, mimeType, statusStr] = parts;
    const statusCode = parseInt(statusStr);

    // only include successful captures
    if (isNaN(statusCode) || statusCode >= 400) continue;

    // format timestamp: 20250315120000 → 2025-03-15T12:00:00Z
    const ts = timestamp.length >= 14
      ? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`
      : timestamp;

    snapshots.push({
      source: 'wayback',
      originalUrl: original || originalUrl,
      cacheUrl: `https://web.archive.org/web/${timestamp}/${original || originalUrl}`,
      timestamp: ts,
      statusCode,
      mimeType: mimeType || 'text/html',
    });
  }

  return snapshots;
}

/** Build the CDX API URL for a given target URL.
 *  Queries the Wayback Machine for all captures of this URL. */
export function buildCdxUrl(targetUrl: string, options?: {
  /** only return captures after this date (YYYYMMDD) */
  from?: string;
  /** max number of results */
  limit?: number;
}): string {
  const encoded = encodeURIComponent(targetUrl);
  let url = `https://web.archive.org/cdx/search/cdx?url=${encoded}&output=text`;

  if (options?.from) url += `&from=${options.from}`;
  if (options?.limit) url += `&limit=${options.limit}`;

  // collapse consecutive identical captures to reduce noise
  url += '&collapse=timestamp:6'; // collapse to monthly

  return url;
}

/** Build a Google Cache URL for a given page. */
export function buildGoogleCacheUrl(targetUrl: string): string {
  return `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(targetUrl)}`;
}

/** Check the Wayback Machine for cached snapshots of a URL.
 *  Returns all captures, newest first. */
export async function checkWayback(
  targetUrl: string,
  fetchFn: typeof fetch = globalThis.fetch,
  options?: { from?: string; limit?: number }
): Promise<CachedSnapshot[]> {
  const cdxUrl = buildCdxUrl(targetUrl, {
    from: options?.from,
    limit: options?.limit ?? 50,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetchFn(cdxUrl, {
      headers: { 'User-Agent': 'degauss-privacy-tool' },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Wayback Machine rate limit — wait before retrying');
      }
      return [];
    }

    const text = await response.text();
    const snapshots = parseCdxResponse(text, targetUrl);

    // sort newest first
    snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return snapshots;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Wayback Machine request timed out (10s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Check multiple URLs for cached/archived versions.
 *  Returns a full archive forensics report. */
export async function archiveForensics(
  urls: string[],
  fetchFn?: typeof fetch,
  options?: { from?: string }
): Promise<ArchiveReport> {
  const allSnapshots: CachedSnapshot[] = [];
  const zombies: string[] = [];
  const clean: string[] = [];

  for (const url of urls) {
    try {
      const snapshots = await checkWayback(url, fetchFn, {
        from: options?.from,
        limit: 20,
      });

      if (snapshots.length > 0) {
        zombies.push(url);
        allSnapshots.push(...snapshots);
      } else {
        clean.push(url);
      }
    } catch {
      // CDX failed for this URL — treat as unknown, not clean
    }

    // rate limit: 1s between CDX requests
    if (url !== urls[urls.length - 1]) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return {
    urlsChecked: urls,
    snapshots: allSnapshots,
    clean,
    zombies,
    totalSnapshots: allSnapshots.length,
  };
}
