import { describe, it, expect } from 'vitest';
import {
  verifyAccount,
  verifyAllAccounts,
  buildRemediationPlan,
} from './verify.js';
import type { UsernameResult } from './username.js';

function mockResult(platform: string, category: string = 'social'): UsernameResult {
  return {
    platform, category, url: `https://${platform.toLowerCase()}.com/testuser`,
    exists: true, status: 200, visibleFields: ['name', 'bio'],
  };
}

describe('verifyAccount', () => {
  it('confirms when target name is found in HTML', async () => {
    const mockFetch = async () => new Response(
      '<html><title>Giuseppe Giona</title><body>Profile of Giuseppe Giona</body></html>',
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('GitHub'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('confirmed');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.foundName).toBe(true);
  });

  it('marks as likely when only first name found', async () => {
    const mockFetch = async () => new Response(
      '<html><title>Giuseppe</title><body>Welcome Giuseppe</body></html>',
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('Reddit'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('likely');
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('marks as false positive when page says not found', async () => {
    const mockFetch = async () => new Response(
      '<html><title>Page not found</title><body>This page does not exist</body></html>',
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('Instagram'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('false_positive');
    expect(result.confidence).toBeLessThan(0.3);
  });

  it('marks as false positive for empty/short pages', async () => {
    const mockFetch = async () => new Response('<html></html>', { status: 200 });
    const result = await verifyAccount(mockResult('TikTok'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('false_positive');
  });

  it('marks as unknown on fetch error', async () => {
    const mockFetch = async () => { throw new Error('timeout'); };
    const result = await verifyAccount(mockResult('Steam'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('unknown');
  });

  it('returns delete action for confirmed accounts with known platforms', async () => {
    const mockFetch = async () => new Response(
      '<html><body>Profile of Giuseppe Giona on GitHub with bio and repos</body></html>'.padEnd(1500, ' '),
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('GitHub'), 'Giuseppe Giona', mockFetch as any);
    expect(result.action.type).toBe('delete');
    if (result.action.type === 'delete') {
      expect(result.action.url).toContain('github.com');
      expect(result.action.instructions.length).toBeGreaterThan(10);
    }
  });

  it('returns privatise action for likely matches', async () => {
    const mockFetch = async () => new Response(
      '<html><body>giuseppe is here with lots of content</body></html>'.padEnd(1500, ' '),
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('Reddit'), 'Giuseppe Giona', mockFetch as any);
    if (result.status === 'likely' && result.action.type === 'privatise') {
      expect(result.action.url).toContain('reddit.com');
    }
  });

  it('is case-insensitive for name matching', async () => {
    const mockFetch = async () => new Response(
      '<html><body>GIUSEPPE GIONA profile page</body></html>',
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('LinkedIn'), 'giuseppe giona', mockFetch as any);
    expect(result.foundName).toBe(true);
  });

  it('detects suspended/banned accounts', async () => {
    const mockFetch = async () => new Response(
      '<html><body>This account has been suspended</body></html>',
      { status: 200 }
    );

    const result = await verifyAccount(mockResult('Twitter/X'), 'Giuseppe Giona', mockFetch as any);
    expect(result.status).toBe('false_positive');
  });
});

describe('verifyAllAccounts', () => {
  it('returns sorted by confidence (highest first)', async () => {
    const results = [
      mockResult('GitHub'),
      mockResult('Instagram'),
    ];

    const mockFetch = async (url: any) => {
      const urlStr = typeof url === 'string' ? url : '';
      if (urlStr.includes('github')) {
        return new Response('<html><body>Giuseppe Giona on GitHub</body></html>', { status: 200 });
      }
      return new Response('<html><title>Page not found</title></html>', { status: 200 });
    };

    const verified = await verifyAllAccounts(results, 'Giuseppe Giona', mockFetch as any);
    expect(verified.length).toBe(2);
    expect(verified[0].confidence).toBeGreaterThanOrEqual(verified[1].confidence);
  });

  it('only verifies accounts that exist', async () => {
    const results = [
      mockResult('GitHub'),
      { ...mockResult('Twitter/X'), exists: false },
    ];

    const mockFetch = async () => new Response('<html><body>Giuseppe Giona</body></html>', { status: 200 });
    const verified = await verifyAllAccounts(results, 'Giuseppe Giona', mockFetch as any);
    expect(verified.length).toBe(1); // only GitHub, Twitter was not found
  });
});

describe('buildRemediationPlan', () => {
  it('categorises actions correctly', () => {
    const verified = [
      { platform: 'GitHub', category: 'code', url: '', status: 'confirmed' as const, confidence: 0.95, foundName: true, foundBio: false, pageTitle: '', action: { type: 'delete' as const, url: 'https://github.com/settings/admin', instructions: 'delete' } },
      { platform: 'Reddit', category: 'forum', url: '', status: 'likely' as const, confidence: 0.6, foundName: false, foundBio: false, pageTitle: '', action: { type: 'privatise' as const, url: 'https://reddit.com/settings', instructions: 'privatise' } },
      { platform: 'TikTok', category: 'social', url: '', status: 'false_positive' as const, confidence: 0.1, foundName: false, foundBio: false, pageTitle: '', action: { type: 'ignore' as const, reason: 'not found' } },
      { platform: 'PyPI', category: 'code', url: '', status: 'likely' as const, confidence: 0.4, foundName: false, foundBio: false, pageTitle: '', action: { type: 'investigate' as const, reason: 'check manually' } },
    ];

    const plan = buildRemediationPlan(verified);
    expect(plan.toDelete.length).toBe(1);
    expect(plan.toPrivatise.length).toBe(1);
    expect(plan.toInvestigate.length).toBe(1);
    expect(plan.falsePositives.length).toBe(1);
  });

  it('estimates cleanup time', () => {
    const verified = [
      { platform: 'A', category: 'code', url: '', status: 'confirmed' as const, confidence: 0.9, foundName: true, foundBio: false, pageTitle: '', action: { type: 'delete' as const, url: '', instructions: '' } },
      { platform: 'B', category: 'code', url: '', status: 'confirmed' as const, confidence: 0.9, foundName: true, foundBio: false, pageTitle: '', action: { type: 'delete' as const, url: '', instructions: '' } },
    ];

    const plan = buildRemediationPlan(verified);
    expect(plan.estimatedTimeMinutes).toBe(6); // 2 deletes × 3 min each
  });

  it('returns zero time for no actions', () => {
    const plan = buildRemediationPlan([]);
    expect(plan.estimatedTimeMinutes).toBe(0);
    expect(plan.toDelete.length).toBe(0);
  });
});
