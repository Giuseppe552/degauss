import { describe, it, expect } from 'vitest';
import {
  predictBrokerCoverage,
  predictAllBrokers,
  expectedExposure,
  getAllBrokers,
} from './coverage.js';

describe('getAllBrokers', () => {
  it('returns 12+ brokers', () => {
    expect(getAllBrokers().length).toBeGreaterThanOrEqual(12);
  });

  it('each broker has required fields', () => {
    for (const b of getAllBrokers()) {
      expect(b.id).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.baseCoverage).toBeGreaterThan(0);
      expect(b.baseCoverage).toBeLessThanOrEqual(1);
      expect(b.optOutUrl).toContain('http');
      expect(b.optOutMethod.length).toBeGreaterThan(10);
      expect(b.typicalFields.length).toBeGreaterThan(0);
    }
  });
});

describe('predictBrokerCoverage', () => {
  const spokeo = getAllBrokers().find(b => b.id === 'spokeo')!;

  it('US name on US broker has high probability', () => {
    const pred = predictBrokerCoverage(spokeo, 'John Smith', 'US');
    expect(pred.probability).toBeGreaterThan(0.5);
  });

  it('UK name on US broker has low probability', () => {
    const pred = predictBrokerCoverage(spokeo, 'John Smith', 'UK');
    expect(pred.probability).toBeLessThan(0.2);
  });

  it('extremely rare name has lower coverage', () => {
    const common = predictBrokerCoverage(spokeo, 'John Smith', 'US');
    const rare = predictBrokerCoverage(spokeo, 'Xylophon Zq', 'US');
    expect(rare.probability).toBeLessThan(common.probability);
  });

  it('returns opt-out URL and method', () => {
    const pred = predictBrokerCoverage(spokeo, 'Jane Doe', 'US');
    expect(pred.optOutUrl).toContain('spokeo.com');
    expect(pred.optOutMethod.length).toBeGreaterThan(10);
  });

  it('probability is capped at 0.99', () => {
    const pred = predictBrokerCoverage(spokeo, 'John Smith', 'US');
    expect(pred.probability).toBeLessThanOrEqual(0.99);
  });
});

describe('predictAllBrokers', () => {
  it('returns predictions sorted by probability descending', () => {
    const preds = predictAllBrokers('John Smith', 'US');
    for (let i = 1; i < preds.length; i++) {
      expect(preds[i].probability).toBeLessThanOrEqual(preds[i - 1].probability);
    }
  });

  it('US name returns more high-probability brokers than UK name', () => {
    const us = predictAllBrokers('John Smith', 'US').filter(p => p.probability > 0.5);
    const uk = predictAllBrokers('John Smith', 'UK').filter(p => p.probability > 0.5);
    expect(us.length).toBeGreaterThan(uk.length);
  });
});

describe('expectedExposure', () => {
  it('returns positive expected bits', () => {
    const exp = expectedExposure('John Smith', 'US');
    expect(exp.expectedBits).toBeGreaterThan(0);
  });

  it('US resident has higher expected exposure than UK resident (on US brokers)', () => {
    const us = expectedExposure('John Smith', 'US');
    const uk = expectedExposure('John Smith', 'UK');
    expect(us.expectedBits).toBeGreaterThan(uk.expectedBits);
  });

  it('returns top brokers sorted by probability', () => {
    const exp = expectedExposure('John Smith', 'US');
    expect(exp.topBrokers.length).toBeGreaterThan(0);
    for (const b of exp.topBrokers) {
      expect(b.probability).toBeGreaterThan(0.3);
      expect(b.optOutUrl).toContain('http');
    }
  });

  it('expected broker count is reasonable', () => {
    const exp = expectedExposure('John Smith', 'US');
    expect(exp.expectedBrokers).toBeGreaterThan(2);
    expect(exp.expectedBrokers).toBeLessThan(15);
  });
});
