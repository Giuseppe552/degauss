/**
 * Continuous monitoring — state persistence and delta computation.
 *
 * Tracks exposure over time, detects changes (new records, reappearances,
 * successful removals), and generates alerts.
 *
 * State is stored as a JSON file (default: ~/.degauss/state.json).
 * Permissions are set to 0600 (owner read/write only) because the
 * file contains PII.
 *
 * Usage:
 *   - `degauss watch --cron` — single scan + delta, for crontab
 *   - `degauss history` — show exposure trend
 */

import type { ExposureRecord, QIField } from '../quantify/types.js';
import type { RemovalTracker } from './verification.js';

/** A point-in-time exposure snapshot */
export interface ExposureSnapshot {
  /** ISO timestamp */
  date: string;
  /** total exposure bits */
  totalBits: number;
  /** anonymity set size */
  anonymitySet: number;
  /** number of active records */
  recordCount: number;
  /** which sources had active records */
  activeSources: string[];
}

/** Persistent state for the monitoring daemon */
export interface DaemonState {
  /** the target profile (name, fields to scan for) */
  profile: {
    name: string;
    city?: string;
    state?: string;
    country: string;
  };
  /** last scan timestamp */
  lastScan: string | null;
  /** exposure history (newest first) */
  history: ExposureSnapshot[];
  /** active removal trackers */
  removals: RemovalTracker[];
  /** known records from the latest scan */
  currentRecords: ExposureRecord[];
}

/** Alert severity levels */
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A monitoring alert */
export interface MonitorAlert {
  severity: AlertSeverity;
  type: string;
  message: string;
  /** which source triggered the alert */
  source?: string;
  /** timestamp */
  timestamp: string;
}

/** Create a fresh daemon state */
export function createState(profile: DaemonState['profile']): DaemonState {
  return {
    profile,
    lastScan: null,
    history: [],
    removals: [],
    currentRecords: [],
  };
}

/** Compute the delta between two scans.
 *  Identifies new records, removed records, and reappearances. */
export function computeDelta(
  previousRecords: ExposureRecord[],
  currentRecords: ExposureRecord[],
  removals: RemovalTracker[]
): {
  newRecords: ExposureRecord[];
  removedRecords: ExposureRecord[];
  reappearances: ExposureRecord[];
  unchanged: ExposureRecord[];
} {
  const prevSources = new Map<string, ExposureRecord>();
  for (const r of previousRecords) {
    prevSources.set(r.source, r);
  }

  const currSources = new Map<string, ExposureRecord>();
  for (const r of currentRecords) {
    currSources.set(r.source, r);
  }

  const removedSources = new Set(
    removals
      .filter(r => r.state === 'verified_removed')
      .map(r => r.source)
  );

  const newRecords: ExposureRecord[] = [];
  const reappearances: ExposureRecord[] = [];
  const unchanged: ExposureRecord[] = [];

  for (const [source, record] of currSources) {
    if (!prevSources.has(source)) {
      // not in previous scan
      if (removedSources.has(source)) {
        reappearances.push(record);
      } else {
        newRecords.push(record);
      }
    } else {
      unchanged.push(record);
    }
  }

  const removedRecords: ExposureRecord[] = [];
  for (const [source, record] of prevSources) {
    if (!currSources.has(source)) {
      removedRecords.push(record);
    }
  }

  return { newRecords, removedRecords, reappearances, unchanged };
}

/** Generate alerts from a scan delta. */
export function generateAlerts(
  delta: ReturnType<typeof computeDelta>,
  previousSnapshot: ExposureSnapshot | null,
  currentSnapshot: ExposureSnapshot
): MonitorAlert[] {
  const alerts: MonitorAlert[] = [];
  const now = new Date().toISOString();

  // critical: anonymity set dropped to 1
  if (currentSnapshot.anonymitySet <= 1 &&
      previousSnapshot && previousSnapshot.anonymitySet > 1) {
    alerts.push({
      severity: 'critical',
      type: 'uniquely_identifiable',
      message: `Anonymity set dropped from ${previousSnapshot.anonymitySet} to 1 — you are now uniquely identifiable`,
      timestamp: now,
    });
  }

  // high: reappearances
  for (const record of delta.reappearances) {
    alerts.push({
      severity: 'high',
      type: 'reappearance',
      message: `Previously removed data reappeared on ${record.source}`,
      source: record.source,
      timestamp: now,
    });
  }

  // high: new data broker with address or phone
  for (const record of delta.newRecords) {
    const hasAddress = record.qis.some(q => q.field === 'address');
    const hasPhone = record.qis.some(q => q.field === 'phone');
    if (hasAddress || hasPhone) {
      alerts.push({
        severity: 'high',
        type: 'new_sensitive_record',
        message: `New record on ${record.source} exposing ${hasAddress ? 'address' : 'phone'}`,
        source: record.source,
        timestamp: now,
      });
    }
  }

  // medium: new records (non-sensitive)
  for (const record of delta.newRecords) {
    const hasAddress = record.qis.some(q => q.field === 'address');
    const hasPhone = record.qis.some(q => q.field === 'phone');
    if (!hasAddress && !hasPhone) {
      alerts.push({
        severity: 'medium',
        type: 'new_record',
        message: `New record found on ${record.source}`,
        source: record.source,
        timestamp: now,
      });
    }
  }

  // low: exposure increased
  if (previousSnapshot && currentSnapshot.totalBits > previousSnapshot.totalBits + 1) {
    const delta_ = currentSnapshot.totalBits - previousSnapshot.totalBits;
    alerts.push({
      severity: 'low',
      type: 'exposure_increased',
      message: `Total exposure increased by ${delta_.toFixed(1)} bits`,
      timestamp: now,
    });
  }

  return alerts;
}

/** Update state after a scan. */
export function updateState(
  state: DaemonState,
  newRecords: ExposureRecord[],
  snapshot: ExposureSnapshot
): DaemonState {
  return {
    ...state,
    lastScan: new Date().toISOString(),
    currentRecords: newRecords,
    history: [snapshot, ...state.history].slice(0, 365), // keep 1 year
  };
}

/** Compute exposure trend from history. */
export function exposureTrend(history: ExposureSnapshot[]): {
  direction: 'improving' | 'worsening' | 'stable';
  bitsChange: number;
  anonymityChange: number;
  periodDays: number;
} {
  if (history.length < 2) {
    return { direction: 'stable', bitsChange: 0, anonymityChange: 0, periodDays: 0 };
  }

  const newest = history[0];
  const oldest = history[history.length - 1];

  const bitsChange = newest.totalBits - oldest.totalBits;
  const anonymityChange = newest.anonymitySet - oldest.anonymitySet;
  const periodDays = Math.floor(
    (new Date(newest.date).getTime() - new Date(oldest.date).getTime()) /
    (1000 * 60 * 60 * 24)
  );

  let direction: 'improving' | 'worsening' | 'stable';
  if (bitsChange < -1) direction = 'improving';
  else if (bitsChange > 1) direction = 'worsening';
  else direction = 'stable';

  return { direction, bitsChange, anonymityChange, periodDays };
}
