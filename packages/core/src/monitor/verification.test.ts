import { describe, it, expect } from 'vitest';
import {
  createTracker,
  computeDeadline,
  verifyRemoval,
  shouldVerifyNow,
  dueForVerification,
} from './verification.js';
import type { ExposureRecord } from '../quantify/types.js';

const mockRecord: ExposureRecord = {
  source: 'spokeo',
  url: 'https://spokeo.com/Jane-Doe',
  qis: [
    { field: 'full_name', value: 'Jane Doe', source: 'spokeo' },
    { field: 'email', value: 'j@test.com', source: 'spokeo' },
    { field: 'phone', value: '+1555', source: 'spokeo' },
  ],
  discoveredAt: Date.now(),
  status: 'active',
};

describe('createTracker', () => {
  it('creates a tracker with correct state', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa');
    expect(tracker.state).toBe('removal_requested');
    expect(tracker.source).toBe('spokeo');
    expect(tracker.beforeQIs.length).toBe(3);
    expect(tracker.jurisdiction).toBe('uk_dpa');
  });

  it('computes correct deadline for UK DPA (30 days)', () => {
    const date = new Date('2026-01-15T00:00:00Z'); // avoid DST transition
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa', date);
    expect(tracker.deadlineAt.slice(0, 10)).toBe('2026-02-14');
  });

  it('computes correct deadline for CCPA (45 days)', () => {
    const date = new Date('2026-03-01');
    const tracker = createTracker('spokeo', mockRecord, 'ccpa', date);
    const deadline = new Date(tracker.deadlineAt);
    expect(deadline.getDate()).toBe(15); // March 1 + 45 = April 15
    expect(deadline.getMonth()).toBe(3); // April
  });
});

describe('computeDeadline', () => {
  it('GDPR = 30 calendar days', () => {
    const d = computeDeadline(new Date('2026-01-01'), 'gdpr');
    expect(d.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('DMCA = 14 days', () => {
    const d = computeDeadline(new Date('2026-01-01'), 'dmca');
    expect(d.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('verifyRemoval', () => {
  it('null afterRecord = fully removed', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa');
    const result = verifyRemoval(tracker, null);
    expect(result.fullyRemoved).toBe(true);
    expect(result.removedFields).toContain('full_name');
    expect(result.remainingFields).toEqual([]);
    expect(result.shouldEscalate).toBe(false);
    expect(tracker.state).toBe('verified_removed');
  });

  it('all fields still present = not removed', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2025-01-01')); // deadline long passed
    const result = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));
    expect(result.fullyRemoved).toBe(false);
    expect(result.remainingFields.length).toBe(3);
    expect(result.shouldEscalate).toBe(true); // deadline passed + not removed
    expect(tracker.state).toBe('still_present');
  });

  it('partial removal detected', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2025-01-01'));
    const partialRecord: ExposureRecord = {
      ...mockRecord,
      qis: [{ field: 'full_name', value: 'Jane Doe', source: 'spokeo' }],
    };
    const result = verifyRemoval(tracker, partialRecord, new Date('2026-03-18'));
    expect(result.fullyRemoved).toBe(false);
    expect(result.removedFields).toContain('email');
    expect(result.removedFields).toContain('phone');
    expect(result.remainingFields).toContain('full_name');
  });

  it('does not escalate before deadline', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2026-03-15'));
    const result = verifyRemoval(tracker, mockRecord, new Date('2026-03-18'));
    expect(result.deadlinePassed).toBe(false);
    expect(result.shouldEscalate).toBe(false);
  });

  it('detects new fields added after request', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa');
    const expanded: ExposureRecord = {
      ...mockRecord,
      qis: [
        ...mockRecord.qis,
        { field: 'address', value: '123 Main St', source: 'spokeo' },
      ],
    };
    const result = verifyRemoval(tracker, expanded);
    expect(result.newFields).toContain('address');
  });
});

describe('shouldVerifyNow', () => {
  it('true when deadline is approaching (within 5 days)', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2026-02-15'));
    // deadline = March 17, check on March 14 (3 days before)
    expect(shouldVerifyNow(tracker, new Date('2026-03-14'))).toBe(true);
  });

  it('false when deadline is far away', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2026-03-15'));
    // deadline = April 14, check on March 18 (27 days before)
    expect(shouldVerifyNow(tracker, new Date('2026-03-18'))).toBe(false);
  });

  it('false for already verified trackers', () => {
    const tracker = createTracker('spokeo', mockRecord, 'uk_dpa');
    tracker.state = 'verified_removed';
    expect(shouldVerifyNow(tracker)).toBe(false);
  });
});

describe('dueForVerification', () => {
  it('filters trackers that are ready', () => {
    const ready = createTracker('spokeo', mockRecord, 'uk_dpa',
      new Date('2026-02-01')); // deadline March 3
    const notReady = createTracker('whitepages', mockRecord, 'uk_dpa',
      new Date('2026-03-15')); // deadline April 14

    const due = dueForVerification([ready, notReady], new Date('2026-03-01'));
    expect(due.length).toBe(1);
    expect(due[0].source).toBe('spokeo');
  });
});
