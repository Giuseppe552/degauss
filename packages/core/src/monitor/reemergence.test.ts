import { describe, it, expect } from 'vitest';
import { predictReemergence, monitoringSchedule } from './reemergence.js';

describe('predictReemergence', () => {
  it('probability increases with time', () => {
    const est = predictReemergence('spokeo');
    expect(est.probabilities.days30).toBeLessThan(est.probabilities.days60);
    expect(est.probabilities.days60).toBeLessThan(est.probabilities.days90);
    expect(est.probabilities.days90).toBeLessThan(est.probabilities.days180);
  });

  it('probability is between 0 and 1', () => {
    const est = predictReemergence('whitepages');
    for (const [, p] of Object.entries(est.probabilities)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('DROP compliance slows re-emergence', () => {
    const without = predictReemergence('spokeo', { dropCompliant: false });
    const withDrop = predictReemergence('spokeo', { dropCompliant: true });
    expect(withDrop.probabilities.days90).toBeLessThan(without.probabilities.days90);
  });

  it('non-existent public record slows re-emergence', () => {
    const exists = predictReemergence('spokeo', { publicRecordExists: true });
    const gone = predictReemergence('spokeo', { publicRecordExists: false });
    expect(gone.probabilities.days90).toBeLessThan(exists.probabilities.days90);
  });

  it('more upstream sources accelerate re-emergence', () => {
    const few = predictReemergence('spokeo', { upstreamSources: 1 });
    const many = predictReemergence('spokeo', { upstreamSources: 10 });
    expect(many.probabilities.days90).toBeGreaterThan(few.probabilities.days90);
  });

  it('expected days until reappearance is positive', () => {
    const est = predictReemergence('whitepages');
    expect(est.expectedDaysUntilReappearance).toBeGreaterThan(0);
  });

  it('recheck interval is shorter than expected reappearance', () => {
    const est = predictReemergence('spokeo');
    expect(est.recheckInterval).toBeLessThan(est.expectedDaysUntilReappearance);
  });
});

describe('monitoringSchedule', () => {
  it('sorts by recheck interval (soonest first)', () => {
    const schedule = monitoringSchedule(['lexisnexis', 'truepeoplesearch', 'spokeo']);
    expect(schedule[0].recheckDays).toBeLessThanOrEqual(schedule[1].recheckDays);
    expect(schedule[1].recheckDays).toBeLessThanOrEqual(schedule[2].recheckDays);
  });

  it('returns one entry per source', () => {
    const schedule = monitoringSchedule(['spokeo', 'whitepages']);
    expect(schedule.length).toBe(2);
  });
});
