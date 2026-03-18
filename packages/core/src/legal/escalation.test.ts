import { describe, it, expect } from 'vitest';
import { generateEscalation } from './escalation.js';
import { createTracker, verifyRemoval } from '../monitor/verification.js';
import type { ExposureRecord } from '../quantify/types.js';

const mockRecord: ExposureRecord = {
  source: 'spokeo',
  qis: [
    { field: 'full_name', value: 'Jane Doe', source: 'spokeo' },
    { field: 'email', value: 'j@test.com', source: 'spokeo' },
  ],
  discoveredAt: Date.now(),
  status: 'active',
};

describe('generateEscalation', () => {
  it('generates ICO complaint for UK DPA', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2025-01-01'));
    const verification = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));

    const complaint = generateEscalation(verification, 'Jane Doe', 'j@test.com');
    expect(complaint.regulator).toContain('ICO');
    expect(complaint.body).toContain('UK GDPR Article 17');
    expect(complaint.body).toContain('Jane Doe');
    expect(complaint.body).toContain('full_name');
    expect(complaint.articlesViolated).toContain('UK GDPR Art 17(1)');
    expect(complaint.submissionUrl).toContain('ico.org.uk');
  });

  it('generates CPPA complaint for CCPA', () => {
    const tracker = createTracker('spokeo', mockRecord, 'ccpa',
      new Date('2025-01-01'));
    const verification = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));

    const complaint = generateEscalation(verification, 'Jane Doe', 'j@test.com');
    expect(complaint.regulator).toContain('CPPA');
    expect(complaint.body).toContain('CCPA');
    expect(complaint.body).toContain('1798.105');
    expect(complaint.penalty).toContain('$2,500');
  });

  it('generates EDPB complaint for GDPR', () => {
    const tracker = createTracker('spokeo', mockRecord, 'gdpr',
      new Date('2025-01-01'));
    const verification = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));

    const complaint = generateEscalation(verification, 'Hans Mueller', 'h@test.com');
    expect(complaint.body).toContain('GDPR Article 77');
    expect(complaint.body).toContain('Hans Mueller');
    expect(complaint.penalty).toContain('EUR 20');
  });

  it('includes remaining fields as evidence', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2025-01-01'));
    const verification = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));

    const complaint = generateEscalation(verification, 'Jane', 'j@test.com');
    expect(complaint.body).toContain('STILL PRESENT');
    expect(complaint.body).toContain('full_name');
  });
});
