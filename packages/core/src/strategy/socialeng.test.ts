import { describe, it, expect } from 'vitest';
import { analyseAttackSurface, attackSummary } from './socialeng.js';
import type { QIField } from '../quantify/types.js';

describe('analyseAttackSurface', () => {
  it('returns all attack scenarios', () => {
    const scenarios = analyseAttackSurface([]);
    expect(scenarios.length).toBeGreaterThan(8);
  });

  it('no exposed QIs = all feasibility near 0', () => {
    const scenarios = analyseAttackSurface([]);
    for (const s of scenarios) {
      expect(s.feasibility).toBe(0);
    }
  });

  it('full exposure = multiple critical attacks feasible', () => {
    const allFields: QIField[] = [
      'full_name', 'dob', 'address', 'phone', 'email',
      'employer', 'job_title', 'ssn_last4', 'city', 'zip',
    ];
    const scenarios = analyseAttackSurface(allFields);
    const critical = scenarios.filter(s => s.feasibility >= 0.7 && s.impact === 'critical');
    expect(critical.length).toBeGreaterThan(2);
  });

  it('email-only exposure enables credential stuffing', () => {
    const scenarios = analyseAttackSurface(['email']);
    const credStuffing = scenarios.find(s => s.id === 'credential_stuffing');
    expect(credStuffing).toBeDefined();
    expect(credStuffing!.feasibility).toBeGreaterThanOrEqual(0.7);
  });

  it('name+address enables physical stalking', () => {
    const scenarios = analyseAttackSurface(['full_name', 'address']);
    const stalking = scenarios.find(s => s.id === 'physical_stalking');
    expect(stalking).toBeDefined();
    expect(stalking!.feasibility).toBeGreaterThanOrEqual(0.7);
  });

  it('sorted by feasibility descending', () => {
    const scenarios = analyseAttackSurface(['full_name', 'email', 'dob', 'phone']);
    for (let i = 1; i < scenarios.length; i++) {
      expect(scenarios[i].feasibility).toBeLessThanOrEqual(scenarios[i - 1].feasibility);
    }
  });

  it('enhancing QIs increase feasibility', () => {
    const base = analyseAttackSurface(['full_name', 'dob', 'address']);
    const enhanced = analyseAttackSurface(['full_name', 'dob', 'address', 'ssn_last4', 'phone', 'email']);

    const baseBank = base.find(s => s.id === 'bank_phone_takeover')!;
    const enhancedBank = enhanced.find(s => s.id === 'bank_phone_takeover')!;
    expect(enhancedBank.feasibility).toBeGreaterThan(baseBank.feasibility);
  });

  it('feasibility is between 0 and 1', () => {
    const scenarios = analyseAttackSurface(['full_name', 'email', 'dob', 'phone', 'address']);
    for (const s of scenarios) {
      expect(s.feasibility).toBeGreaterThanOrEqual(0);
      expect(s.feasibility).toBeLessThanOrEqual(1);
    }
  });
});

describe('attackSummary', () => {
  it('counts feasible attacks correctly', () => {
    const scenarios = analyseAttackSurface([
      'full_name', 'email', 'dob', 'phone', 'address', 'employer',
    ]);
    const summary = attackSummary(scenarios);
    expect(summary.totalScenarios).toBe(scenarios.length);
    expect(summary.fullyFeasible).toBeGreaterThan(0);
    expect(summary.topThreats.length).toBeLessThanOrEqual(3);
  });

  it('returns zero counts for no exposure', () => {
    const scenarios = analyseAttackSurface([]);
    const summary = attackSummary(scenarios);
    expect(summary.fullyFeasible).toBe(0);
    expect(summary.criticalFeasible).toBe(0);
  });
});
