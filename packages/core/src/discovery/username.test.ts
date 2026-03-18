import { describe, it, expect } from 'vitest';
import {
  checkPlatform,
  enumerateUsername,
  getAllPlatforms,
} from './username.js';
import type { Platform } from './username.js';

describe('getAllPlatforms', () => {
  it('returns 30+ platforms', () => {
    expect(getAllPlatforms().length).toBeGreaterThanOrEqual(30);
  });

  it('each platform has required fields', () => {
    for (const p of getAllPlatforms()) {
      expect(p.name).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.urlTemplate).toContain('{username}');
      expect(p.existsStatus).toBeGreaterThan(0);
      expect(p.visibleFields.length).toBeGreaterThan(0);
    }
  });

  it('covers all major categories', () => {
    const cats = new Set(getAllPlatforms().map(p => p.category));
    expect(cats.has('social')).toBe(true);
    expect(cats.has('professional')).toBe(true);
    expect(cats.has('code')).toBe(true);
    expect(cats.has('media')).toBe(true);
  });

  it('no duplicate platform names', () => {
    const names = getAllPlatforms().map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('checkPlatform', () => {
  it('returns exists=true when fetch returns 200', async () => {
    const platform: Platform = {
      name: 'TestPlatform', category: 'other',
      urlTemplate: 'https://example.com/{username}',
      existsStatus: 200, visibleFields: ['name'],
    };

    const mockFetch = async () => new Response('ok', { status: 200 });
    const result = await checkPlatform(platform, 'testuser', mockFetch as any);
    expect(result.exists).toBe(true);
    expect(result.status).toBe(200);
    expect(result.visibleFields).toContain('name');
  });

  it('returns exists=false when fetch returns 404', async () => {
    const platform: Platform = {
      name: 'TestPlatform', category: 'other',
      urlTemplate: 'https://example.com/{username}',
      existsStatus: 200, visibleFields: ['name'],
    };

    const mockFetch = async () => new Response('not found', { status: 404 });
    const result = await checkPlatform(platform, 'testuser', mockFetch as any);
    expect(result.exists).toBe(false);
    expect(result.visibleFields).toEqual([]);
  });

  it('handles fetch errors gracefully', async () => {
    const platform: Platform = {
      name: 'TestPlatform', category: 'other',
      urlTemplate: 'https://example.com/{username}',
      existsStatus: 200, visibleFields: ['name'],
    };

    const mockFetch = async () => { throw new Error('network down'); };
    const result = await checkPlatform(platform, 'testuser', mockFetch as any);
    expect(result.exists).toBe(false);
    expect(result.error).toContain('network down');
  });

  it('replaces {username} in URL', async () => {
    const platform: Platform = {
      name: 'Test', category: 'other',
      urlTemplate: 'https://example.com/user/{username}/profile',
      existsStatus: 200, visibleFields: [],
    };

    let capturedUrl = '';
    const mockFetch = async (url: any) => {
      capturedUrl = typeof url === 'string' ? url : '';
      return new Response('', { status: 404 });
    };

    await checkPlatform(platform, 'john123', mockFetch as any);
    expect(capturedUrl).toContain('john123');
  });
});

describe('enumerateUsername', () => {
  it('returns report with correct structure', async () => {
    const mockFetch = async () => new Response('', { status: 404 });
    const report = await enumerateUsername('testuser', mockFetch as any);

    expect(report.username).toBe('testuser');
    expect(report.platformsChecked).toBeGreaterThan(0);
    expect(report.accountsFound).toBe(0);
    expect(Array.isArray(report.results)).toBe(true);
  });

  it('counts found accounts correctly', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      // first 3 return 200, rest return 404
      return new Response('', { status: callCount <= 3 ? 200 : 404 });
    };

    const report = await enumerateUsername('testuser', mockFetch as any);
    expect(report.accountsFound).toBe(3);
  });

  it('computes category counts', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response('', { status: callCount <= 2 ? 200 : 404 });
    };

    const report = await enumerateUsername('testuser', mockFetch as any);
    const totalCats = Object.values(report.categoryCounts).reduce((s, n) => s + n, 0);
    expect(totalCats).toBe(report.accountsFound);
  });

  it('collects exposed fields from found accounts', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response('', { status: callCount === 1 ? 200 : 404 });
    };

    const report = await enumerateUsername('testuser', mockFetch as any);
    if (report.accountsFound > 0) {
      expect(report.exposedFields.length).toBeGreaterThan(0);
    }
  });
});
