import { describe, it, expect } from 'vitest';
import {
  createUrlCanary,
  createEmailCanary,
  createDnsCanary,
  createCanarySet,
  canaryStats,
} from './canary.js';
import type { CanaryTrigger } from './canary.js';

const config = {
  urlDomain: 'mysite.com',
  emailDomain: 'mysite.com',
};

describe('createUrlCanary', () => {
  it('generates a valid URL', () => {
    const canary = createUrlCanary('spokeo', config);
    expect(canary.value).toMatch(/^https:\/\/mysite\.com\/contact\/[a-f0-9]+$/);
    expect(canary.type).toBe('url');
    expect(canary.plantedIn).toBe('spokeo');
  });

  it('generates unique IDs', () => {
    const a = createUrlCanary('spokeo', config);
    const b = createUrlCanary('spokeo', config);
    expect(a.id).not.toBe(b.id);
    expect(a.value).not.toBe(b.value);
  });
});

describe('createEmailCanary', () => {
  it('generates a valid email address', () => {
    const canary = createEmailCanary('whitepages', config);
    expect(canary.value).toMatch(/^contact\+[a-f0-9]+@mysite\.com$/);
    expect(canary.type).toBe('email');
  });
});

describe('createDnsCanary', () => {
  it('generates a subdomain', () => {
    const canary = createDnsCanary('radaris', config);
    expect(canary.value).toMatch(/^[a-f0-9]+\.mysite\.com$/);
    expect(canary.type).toBe('dns');
  });
});

describe('createCanarySet', () => {
  it('creates 2 canaries per broker (URL + email)', () => {
    const canaries = createCanarySet(['spokeo', 'whitepages'], config);
    expect(canaries.length).toBe(4); // 2 brokers × 2 types
  });

  it('all canaries have unique IDs', () => {
    const canaries = createCanarySet(['a', 'b', 'c'], config);
    const ids = canaries.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('canaryStats', () => {
  it('counts triggers correctly', () => {
    const canaries = createCanarySet(['spokeo', 'whitepages'], config);
    const triggers: CanaryTrigger[] = [
      { canaryId: canaries[0].id, triggeredAt: Date.now(), sourceIp: '1.2.3.4' },
      { canaryId: canaries[0].id, triggeredAt: Date.now(), sourceIp: '5.6.7.8' },
      { canaryId: canaries[2].id, triggeredAt: Date.now(), sourceIp: '1.2.3.4' },
    ];

    const stats = canaryStats(canaries, triggers);
    expect(stats.totalTriggers).toBe(3);
    expect(stats.brokersTriggered).toBe(2); // spokeo + whitepages
    expect(stats.uniqueSourceIps).toBe(2); // 1.2.3.4 + 5.6.7.8
  });

  it('returns zero stats when no triggers', () => {
    const canaries = createCanarySet(['spokeo'], config);
    const stats = canaryStats(canaries, []);
    expect(stats.totalTriggers).toBe(0);
    expect(stats.brokersTriggered).toBe(0);
  });
});
