import { describe, it, expect } from 'vitest';
import {
  parseCdxResponse,
  buildCdxUrl,
  buildGoogleCacheUrl,
} from './archive.js';

describe('parseCdxResponse', () => {
  it('parses a valid CDX line', () => {
    const cdx = 'com,spokeo)/jane-doe 20250315120000 https://spokeo.com/Jane-Doe text/html 200 ABC123 45678';
    const snapshots = parseCdxResponse(cdx, 'https://spokeo.com/Jane-Doe');
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].source).toBe('wayback');
    expect(snapshots[0].originalUrl).toBe('https://spokeo.com/Jane-Doe');
    expect(snapshots[0].statusCode).toBe(200);
    expect(snapshots[0].timestamp).toBe('2025-03-15T12:00:00Z');
    expect(snapshots[0].cacheUrl).toContain('web.archive.org');
  });

  it('filters out 404 captures', () => {
    const cdx = 'com,spokeo)/jane-doe 20250315120000 https://spokeo.com/Jane-Doe text/html 404 ABC123 45678';
    expect(parseCdxResponse(cdx, '')).toEqual([]);
  });

  it('handles multiple lines', () => {
    const cdx = [
      'com,spokeo)/x 20250101000000 https://spokeo.com/x text/html 200 A 100',
      'com,spokeo)/x 20250201000000 https://spokeo.com/x text/html 200 B 200',
      'com,spokeo)/x 20250301000000 https://spokeo.com/x text/html 200 C 300',
    ].join('\n');
    expect(parseCdxResponse(cdx, '')).toHaveLength(3);
  });

  it('handles empty response', () => {
    expect(parseCdxResponse('', '')).toEqual([]);
    expect(parseCdxResponse('\n', '')).toEqual([]);
  });

  it('skips malformed lines', () => {
    const cdx = 'too few fields\ncom,spokeo)/x 20250101000000 https://spokeo.com/x text/html 200 A 100';
    expect(parseCdxResponse(cdx, '')).toHaveLength(1);
  });
});

describe('buildCdxUrl', () => {
  it('encodes the target URL', () => {
    const url = buildCdxUrl('https://spokeo.com/Jane Doe');
    expect(url).toContain('web.archive.org/cdx/search/cdx');
    expect(url).toContain(encodeURIComponent('https://spokeo.com/Jane Doe'));
  });

  it('adds from parameter', () => {
    const url = buildCdxUrl('https://example.com', { from: '20250101' });
    expect(url).toContain('from=20250101');
  });

  it('adds limit parameter', () => {
    const url = buildCdxUrl('https://example.com', { limit: 10 });
    expect(url).toContain('limit=10');
  });

  it('collapses to monthly by default', () => {
    const url = buildCdxUrl('https://example.com');
    expect(url).toContain('collapse=timestamp:6');
  });
});

describe('buildGoogleCacheUrl', () => {
  it('constructs a valid cache URL', () => {
    const url = buildGoogleCacheUrl('https://spokeo.com/Jane-Doe');
    expect(url).toContain('webcache.googleusercontent.com');
    expect(url).toContain(encodeURIComponent('https://spokeo.com/Jane-Doe'));
  });
});
