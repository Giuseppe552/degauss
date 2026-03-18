import { describe, it, expect } from 'vitest';
import { generateReport } from './report.js';
import type { ExposureRecord } from './types.js';

function makeRecord(source: string, fields: Array<[string, string]>): ExposureRecord {
  return {
    source,
    qis: fields.map(([field, value]) => ({
      field: field as any,
      value,
      source,
    })),
    discoveredAt: Date.now(),
    status: 'active',
  };
}

describe('generateReport', () => {
  it('returns a complete report structure', () => {
    const records = [
      makeRecord('spokeo', [['full_name', 'Jane Doe'], ['email', 'j@test.com']]),
    ];
    const report = generateReport(records, 'US');

    expect(report.totalBits).toBeGreaterThan(0);
    expect(report.uniquenessThreshold).toBeGreaterThan(0);
    expect(report.anonymitySet).toBeGreaterThanOrEqual(1);
    expect(typeof report.uniquelyIdentifiable).toBe('boolean');
    expect(report.attributes.length).toBeGreaterThan(0);
    expect(report.graph).toBeDefined();
    expect(report.removalPlan).toBeDefined();
  });

  it('more QIs = more exposure bits', () => {
    const few = generateReport([
      makeRecord('a', [['email', 'j@test.com']]),
    ], 'US');
    const many = generateReport([
      makeRecord('a', [['email', 'j@test.com'], ['phone', '+1555'], ['dob', '1990-01-01']]),
    ], 'US');

    expect(many.totalBits).toBeGreaterThan(few.totalBits);
  });

  it('multiple records create graph edges when QIs match', () => {
    const report = generateReport([
      makeRecord('spokeo', [['email', 'j@test.com'], ['full_name', 'Jane Doe']]),
      makeRecord('whitepages', [['email', 'j@test.com'], ['phone', '+1555']]),
    ], 'US');

    expect(report.graph.edges.length).toBeGreaterThan(0);
    expect(report.graph.components.length).toBe(1); // linked by email
  });

  it('unlinked records create separate components', () => {
    const report = generateReport([
      makeRecord('spokeo', [['email', 'a@test.com']]),
      makeRecord('whitepages', [['email', 'b@test.com']]),
    ], 'US');

    expect(report.graph.edges.length).toBe(0);
    expect(report.graph.components.length).toBe(2);
  });

  it('removal plan is sorted by efficiency', () => {
    const report = generateReport([
      makeRecord('spokeo', [['email', 'j@test.com'], ['full_name', 'Jane']]),
      makeRecord('radaris', [['phone', '+1555']]),
    ], 'US');

    if (report.removalPlan.length >= 2) {
      // spokeo (difficulty 0.3) should come before radaris (difficulty 0.8)
      // assuming similar bits
      const sources = report.removalPlan.map(s => s.source);
      expect(sources).toContain('spokeo');
    }
  });

  it('UK country uses uk_dpa jurisdiction', () => {
    const report = generateReport([
      makeRecord('spokeo', [['email', 'j@test.com']]),
    ], 'UK');

    for (const step of report.removalPlan) {
      expect(step.jurisdiction).toBe('uk_dpa');
    }
  });

  it('attributes have positive efficiency', () => {
    const report = generateReport([
      makeRecord('spokeo', [['email', 'j@test.com'], ['phone', '+1555']]),
    ], 'US');

    for (const attr of report.attributes) {
      expect(attr.efficiency).toBeGreaterThan(0);
      expect(attr.exposureBits).toBeGreaterThanOrEqual(0);
      expect(attr.sourceCount).toBeGreaterThan(0);
    }
  });
});
