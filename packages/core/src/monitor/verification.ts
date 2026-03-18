/**
 * Removal verification loop.
 *
 * After sending a removal request, re-scan the broker after the legal
 * deadline to verify the data was actually deleted. If it's still there,
 * generate an escalation complaint to the relevant regulator.
 *
 * State machine:
 *   ACTIVE → REMOVAL_REQUESTED(date) → DEADLINE_PENDING(deadline)
 *     → VERIFIED_REMOVED | STILL_PRESENT → ESCALATED | REAPPEARED
 *
 * The verification compares before/after scan results at the QI level:
 * which fields were removed, which remain, which are new.
 */

import type { ExposureRecord, QIField, Jurisdiction } from '../quantify/types.js';

/** State of a removal request */
export type RemovalState =
  | 'active'
  | 'removal_requested'
  | 'deadline_pending'
  | 'verified_removed'
  | 'still_present'
  | 'escalated'
  | 'reappeared';

/** A tracked removal request */
export interface RemovalTracker {
  /** broker/source identifier */
  source: string;
  /** URL where the record was found */
  url?: string;
  /** current state */
  state: RemovalState;
  /** QIs that were present before removal request */
  beforeQIs: Array<{ field: QIField; value: string }>;
  /** QIs found in latest verification scan (empty if not yet verified) */
  afterQIs: Array<{ field: QIField; value: string }>;
  /** jurisdiction of the request */
  jurisdiction: Jurisdiction;
  /** when the removal request was sent */
  requestedAt: string;
  /** legal deadline for compliance */
  deadlineAt: string;
  /** when verification was last run */
  verifiedAt?: string;
  /** if escalated, when */
  escalatedAt?: string;
}

/** Result of verifying a single removal */
export interface VerificationResult {
  tracker: RemovalTracker;
  /** is the deadline past? */
  deadlinePassed: boolean;
  /** days since request */
  daysSinceRequest: number;
  /** fields that were removed */
  removedFields: QIField[];
  /** fields still present */
  remainingFields: QIField[];
  /** new fields not seen before */
  newFields: QIField[];
  /** overall: was it removed? */
  fullyRemoved: boolean;
  /** should escalate to regulator? */
  shouldEscalate: boolean;
}

/** Legal deadline in calendar days by jurisdiction.
 *  GDPR: 30 days (extendable by 60 with notice)
 *  UK DPA: 30 days
 *  CCPA: 45 days (extendable by 45 with notice) */
const DEADLINE_DAYS: Record<Jurisdiction, number> = {
  gdpr: 30,
  uk_dpa: 30,
  ccpa: 45,
  state_us: 45,
  dmca: 14,
  unknown: 30,
};

/** Create a new removal tracker when a request is sent. */
export function createTracker(
  source: string,
  beforeRecord: ExposureRecord,
  jurisdiction: Jurisdiction,
  requestDate: Date = new Date()
): RemovalTracker {
  const deadlineDays = DEADLINE_DAYS[jurisdiction];
  const deadline = new Date(requestDate);
  deadline.setDate(deadline.getDate() + deadlineDays);

  return {
    source,
    url: beforeRecord.url,
    state: 'removal_requested',
    beforeQIs: beforeRecord.qis.map(q => ({ field: q.field, value: q.value })),
    afterQIs: [],
    jurisdiction,
    requestedAt: requestDate.toISOString(),
    deadlineAt: deadline.toISOString(),
  };
}

/** Compute the deadline date for a request. */
export function computeDeadline(
  requestDate: Date,
  jurisdiction: Jurisdiction
): Date {
  const days = DEADLINE_DAYS[jurisdiction];
  const deadline = new Date(requestDate);
  deadline.setDate(deadline.getDate() + days);
  return deadline;
}

/** Verify whether a removal was successful.
 *  Compare the before snapshot (stored in tracker) with a fresh scan result.
 *
 *  afterRecord: the result of re-scanning the broker. Pass null if the
 *  profile was not found (which means successful removal). */
export function verifyRemoval(
  tracker: RemovalTracker,
  afterRecord: ExposureRecord | null,
  now: Date = new Date()
): VerificationResult {
  const requestDate = new Date(tracker.requestedAt);
  const deadlineDate = new Date(tracker.deadlineAt);
  const daysSinceRequest = Math.floor(
    (now.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const deadlinePassed = now >= deadlineDate;

  if (!afterRecord || afterRecord.qis.length === 0) {
    // profile not found — fully removed
    tracker.state = 'verified_removed';
    tracker.afterQIs = [];
    tracker.verifiedAt = now.toISOString();

    return {
      tracker,
      deadlinePassed,
      daysSinceRequest,
      removedFields: tracker.beforeQIs.map(q => q.field),
      remainingFields: [],
      newFields: [],
      fullyRemoved: true,
      shouldEscalate: false,
    };
  }

  // compare before/after at the field level
  const beforeFields = new Set(tracker.beforeQIs.map(q => q.field));
  const afterFields = new Set(afterRecord.qis.map(q => q.field));

  const removedFields: QIField[] = [];
  const remainingFields: QIField[] = [];
  const newFields: QIField[] = [];

  for (const f of beforeFields) {
    if (afterFields.has(f)) remainingFields.push(f);
    else removedFields.push(f);
  }
  for (const f of afterFields) {
    if (!beforeFields.has(f)) newFields.push(f);
  }

  const fullyRemoved = remainingFields.length === 0 && newFields.length === 0;

  // should escalate if: deadline passed AND data still present
  const shouldEscalate = deadlinePassed && !fullyRemoved;

  tracker.afterQIs = afterRecord.qis.map(q => ({ field: q.field, value: q.value }));
  tracker.verifiedAt = now.toISOString();
  tracker.state = fullyRemoved ? 'verified_removed' : 'still_present';

  return {
    tracker,
    deadlinePassed,
    daysSinceRequest,
    removedFields,
    remainingFields,
    newFields,
    fullyRemoved,
    shouldEscalate,
  };
}

/** Check if it's time to verify a tracker (deadline has passed or is near). */
export function shouldVerifyNow(tracker: RemovalTracker, now: Date = new Date()): boolean {
  if (tracker.state !== 'removal_requested' && tracker.state !== 'deadline_pending') {
    return false;
  }
  const deadline = new Date(tracker.deadlineAt);
  // verify starting 5 days before deadline
  const verifyAfter = new Date(deadline);
  verifyAfter.setDate(verifyAfter.getDate() - 5);
  return now >= verifyAfter;
}

/** Get all trackers that are due for verification. */
export function dueForVerification(
  trackers: RemovalTracker[],
  now: Date = new Date()
): RemovalTracker[] {
  return trackers.filter(t => shouldVerifyNow(t, now));
}
