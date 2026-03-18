import { describe, it, expect } from 'vitest';
import {
  createState,
  computeDelta,
  generateAlerts,
  updateState,
  exposureTrend,
} from './daemon.js';
import type { ExposureRecord } from '../quantify/types.js';
import type { ExposureSnapshot } from './daemon.js';

function makeRecord(source: string, fields: string[] = ['full_name']): ExposureRecord {
  return {
    source,
    qis: fields.map(f => ({ field: f as any, value: 'test', source })),
    discoveredAt: Date.now(),
    status: 'active',
  };
}

function makeSnapshot(overrides: Partial<ExposureSnapshot> = {}): ExposureSnapshot {
  return {
    date: new Date().toISOString(),
    totalBits: 30,
    anonymitySet: 1,
    recordCount: 3,
    activeSources: ['spokeo', 'whitepages'],
    ...overrides,
  };
}

describe('createState', () => {
  it('creates empty state with profile', () => {
    const state = createState({ name: 'Jane Doe', country: 'US' });
    expect(state.profile.name).toBe('Jane Doe');
    expect(state.history).toEqual([]);
    expect(state.currentRecords).toEqual([]);
    expect(state.lastScan).toBeNull();
  });
});

describe('computeDelta', () => {
  it('detects new records', () => {
    const prev = [makeRecord('spokeo')];
    const curr = [makeRecord('spokeo'), makeRecord('whitepages')];
    const delta = computeDelta(prev, curr, []);
    expect(delta.newRecords.length).toBe(1);
    expect(delta.newRecords[0].source).toBe('whitepages');
  });

  it('detects removed records', () => {
    const prev = [makeRecord('spokeo'), makeRecord('whitepages')];
    const curr = [makeRecord('spokeo')];
    const delta = computeDelta(prev, curr, []);
    expect(delta.removedRecords.length).toBe(1);
    expect(delta.removedRecords[0].source).toBe('whitepages');
  });

  it('detects reappearances', () => {
    const prev: ExposureRecord[] = [];
    const curr = [makeRecord('spokeo')];
    const removals = [{
      source: 'spokeo',
      state: 'verified_removed' as const,
      beforeQIs: [],
      afterQIs: [],
      jurisdiction: 'uk_dpa' as const,
      requestedAt: '',
      deadlineAt: '',
      url: '',
    }];
    const delta = computeDelta(prev, curr, removals);
    expect(delta.reappearances.length).toBe(1);
    expect(delta.newRecords.length).toBe(0);
  });

  it('identifies unchanged records', () => {
    const records = [makeRecord('spokeo'), makeRecord('whitepages')];
    const delta = computeDelta(records, records, []);
    expect(delta.unchanged.length).toBe(2);
    expect(delta.newRecords.length).toBe(0);
    expect(delta.removedRecords.length).toBe(0);
  });
});

describe('generateAlerts', () => {
  it('critical alert when anonymity set drops to 1', () => {
    const prev = makeSnapshot({ anonymitySet: 50 });
    const curr = makeSnapshot({ anonymitySet: 1 });
    const delta = computeDelta([], [], []);
    const alerts = generateAlerts(delta, prev, curr);
    expect(alerts.some(a => a.severity === 'critical')).toBe(true);
  });

  it('high alert for reappearances', () => {
    const delta = {
      newRecords: [],
      removedRecords: [],
      reappearances: [makeRecord('spokeo')],
      unchanged: [],
    };
    const alerts = generateAlerts(delta, makeSnapshot(), makeSnapshot());
    expect(alerts.some(a => a.severity === 'high' && a.type === 'reappearance')).toBe(true);
  });

  it('high alert for new sensitive record', () => {
    const delta = {
      newRecords: [makeRecord('radaris', ['full_name', 'address'])],
      removedRecords: [],
      reappearances: [],
      unchanged: [],
    };
    const alerts = generateAlerts(delta, makeSnapshot(), makeSnapshot());
    expect(alerts.some(a => a.severity === 'high' && a.type === 'new_sensitive_record')).toBe(true);
  });

  it('no alerts when nothing changed', () => {
    const snapshot = makeSnapshot();
    const delta = { newRecords: [], removedRecords: [], reappearances: [], unchanged: [] };
    const alerts = generateAlerts(delta, snapshot, snapshot);
    expect(alerts.length).toBe(0);
  });
});

describe('updateState', () => {
  it('updates lastScan and history', () => {
    const state = createState({ name: 'Jane', country: 'US' });
    const snapshot = makeSnapshot();
    const updated = updateState(state, [makeRecord('spokeo')], snapshot);
    expect(updated.lastScan).not.toBeNull();
    expect(updated.history.length).toBe(1);
    expect(updated.currentRecords.length).toBe(1);
  });

  it('caps history at 365 entries', () => {
    const state = createState({ name: 'Jane', country: 'US' });
    state.history = new Array(365).fill(makeSnapshot());
    const updated = updateState(state, [], makeSnapshot());
    expect(updated.history.length).toBe(365);
  });
});

describe('exposureTrend', () => {
  it('stable when no history', () => {
    expect(exposureTrend([]).direction).toBe('stable');
  });

  it('improving when bits decreased', () => {
    const history = [
      makeSnapshot({ totalBits: 20, date: '2026-03-18' }),
      makeSnapshot({ totalBits: 30, date: '2026-03-01' }),
    ];
    expect(exposureTrend(history).direction).toBe('improving');
  });

  it('worsening when bits increased', () => {
    const history = [
      makeSnapshot({ totalBits: 40, date: '2026-03-18' }),
      makeSnapshot({ totalBits: 30, date: '2026-03-01' }),
    ];
    expect(exposureTrend(history).direction).toBe('worsening');
  });

  it('stable when change is < 1 bit', () => {
    const history = [
      makeSnapshot({ totalBits: 30.5, date: '2026-03-18' }),
      makeSnapshot({ totalBits: 30, date: '2026-03-01' }),
    ];
    expect(exposureTrend(history).direction).toBe('stable');
  });
});
