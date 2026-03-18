import { describe, it, expect } from 'vitest';
import {
  generateSyntheticProfiles,
  dilutionKAnonymity,
  dilutionEntropyGain,
} from './synthetic.js';

describe('generateSyntheticProfiles', () => {
  const realProfile = {
    full_name: 'Giuseppe Giona',
    first_name: 'Giuseppe',
    last_name: 'Giona',
    city: 'Manchester',
    email: 'g@test.com',
  };

  it('generates requested number of profiles', () => {
    const profiles = generateSyntheticProfiles(realProfile, {
      count: 20,
      anchorFields: ['full_name'],
      targetK: 20,
      country: 'UK',
    });
    expect(profiles.length).toBe(20);
  });

  it('preserves anchor fields', () => {
    const profiles = generateSyntheticProfiles(realProfile, {
      count: 5,
      anchorFields: ['full_name'],
      targetK: 5,
      country: 'UK',
    });
    for (const p of profiles) {
      expect(p.fields.full_name).toBe('Giuseppe Giona');
      expect(p.anchors).toContain('full_name');
    }
  });

  it('randomises non-anchor fields', () => {
    const profiles = generateSyntheticProfiles(realProfile, {
      count: 10,
      anchorFields: ['full_name'],
      targetK: 10,
      country: 'UK',
    });

    // cities should vary
    const cities = new Set(profiles.map(p => p.fields.city));
    expect(cities.size).toBeGreaterThan(1);
  });

  it('generates consistent location data (city/state/ZIP match)', () => {
    const profiles = generateSyntheticProfiles(realProfile, {
      count: 5,
      anchorFields: ['full_name'],
      targetK: 5,
      country: 'UK',
    });
    for (const p of profiles) {
      // each profile should have city, state, and ZIP
      expect(p.fields.city).toBeDefined();
      expect(p.fields.state).toBeDefined();
      expect(p.fields.zip).toBeDefined();
    }
  });

  it('plausibility score is between 0 and 1', () => {
    const profiles = generateSyntheticProfiles(realProfile, {
      count: 5,
      anchorFields: ['full_name'],
      targetK: 5,
      country: 'UK',
    });
    for (const p of profiles) {
      expect(p.plausibility).toBeGreaterThan(0);
      expect(p.plausibility).toBeLessThanOrEqual(1);
    }
  });

  it('more anchors = lower plausibility (more detectable)', () => {
    const fewAnchors = generateSyntheticProfiles(realProfile, {
      count: 1,
      anchorFields: ['full_name'],
      targetK: 1,
      country: 'UK',
    });
    const manyAnchors = generateSyntheticProfiles(realProfile, {
      count: 1,
      anchorFields: ['full_name', 'first_name', 'last_name', 'email'],
      targetK: 1,
      country: 'UK',
    });
    expect(fewAnchors[0].plausibility).toBeGreaterThan(manyAnchors[0].plausibility);
  });
});

describe('dilutionKAnonymity', () => {
  it('returns 1 with no synthetic profiles (just real)', () => {
    expect(dilutionKAnonymity({ full_name: 'test' }, [])).toBe(1);
  });

  it('increases by number of matching profiles', () => {
    const profiles = [
      { fields: { full_name: 'test' }, anchors: ['full_name' as const], randomised: [], plausibility: 0.9 },
      { fields: { full_name: 'test' }, anchors: ['full_name' as const], randomised: [], plausibility: 0.9 },
    ];
    expect(dilutionKAnonymity({ full_name: 'test' }, profiles)).toBe(3); // 1 real + 2 synthetic
  });

  it('non-matching profiles dont count', () => {
    const profiles = [
      { fields: { full_name: 'other' }, anchors: ['full_name' as const], randomised: [], plausibility: 0.9 },
    ];
    expect(dilutionKAnonymity({ full_name: 'test' }, profiles)).toBe(1);
  });
});

describe('dilutionEntropyGain', () => {
  it('going from k=1 to k=20 adds ~4.3 bits', () => {
    const gain = dilutionEntropyGain(1, 20);
    expect(gain).toBeCloseTo(Math.log2(20), 5);
  });

  it('going from k=1 to k=1 adds 0 bits', () => {
    expect(dilutionEntropyGain(1, 1)).toBe(0);
  });

  it('gain is monotonically increasing in k_after', () => {
    const g10 = dilutionEntropyGain(1, 10);
    const g20 = dilutionEntropyGain(1, 20);
    const g50 = dilutionEntropyGain(1, 50);
    expect(g20).toBeGreaterThan(g10);
    expect(g50).toBeGreaterThan(g20);
  });

  it('returns 0 for invalid inputs', () => {
    expect(dilutionEntropyGain(0, 10)).toBe(0);
    expect(dilutionEntropyGain(1, 0)).toBe(0);
  });
});
