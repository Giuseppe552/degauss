import { describe, it, expect } from 'vitest';
import { fieldWeight, computeLinkage, jaroWinkler } from './linkage.js';

describe('fieldWeight', () => {
  it('agreement on rare field gives high positive weight', () => {
    // email agreement: m ≈ 0.99, u ≈ 2^-28
    const w = fieldWeight('email', true);
    expect(w.weight).toBeGreaterThan(20); // very strong evidence of match
    expect(w.agrees).toBe(true);
  });

  it('agreement on common field gives lower weight', () => {
    // sex agreement: m ≈ 0.99, u ≈ 0.5
    const w = fieldWeight('sex', true);
    expect(w.weight).toBeLessThan(2); // weak evidence
  });

  it('disagreement on reliable field gives negative weight', () => {
    // DOB disagreement: m ≈ 0.98, so (1-m)=0.02 vs (1-u)≈1
    const w = fieldWeight('dob', false);
    expect(w.weight).toBeLessThan(-3); // strong evidence of non-match
  });

  it('disagreement on unreliable field gives small negative weight', () => {
    // IP disagreement: m ≈ 0.50, not very reliable
    const w = fieldWeight('ip_address', false);
    expect(Math.abs(w.weight)).toBeLessThan(5); // weaker evidence than reliable fields
  });
});

describe('computeLinkage', () => {
  it('matching email + name = definite match', () => {
    const result = computeLinkage(
      [{ field: 'email', value: 'g@test.com' }, { field: 'full_name', value: 'Giuseppe Giona' }],
      [{ field: 'email', value: 'g@test.com' }, { field: 'full_name', value: 'Giuseppe Giona' }]
    );
    expect(result.classification).toBe('match');
    expect(result.matchProbability).toBeGreaterThan(0.99);
  });

  it('mismatched email = non-match despite matching name', () => {
    const result = computeLinkage(
      [{ field: 'email', value: 'a@test.com' }, { field: 'full_name', value: 'Giuseppe Giona' }],
      [{ field: 'email', value: 'b@test.com' }, { field: 'full_name', value: 'Giuseppe Giona' }]
    );
    // email disagreement should pull weight down significantly
    expect(result.compositeWeight).toBeLessThan(
      computeLinkage(
        [{ field: 'full_name', value: 'Giuseppe Giona' }],
        [{ field: 'full_name', value: 'Giuseppe Giona' }]
      ).compositeWeight
    );
  });

  it('no shared fields = neutral', () => {
    const result = computeLinkage(
      [{ field: 'email', value: 'g@test.com' }],
      [{ field: 'phone', value: '+447000000' }]
    );
    expect(result.compositeWeight).toBe(0);
    expect(result.classification).toBe('non_match');
  });

  it('match probability is between 0 and 1', () => {
    const result = computeLinkage(
      [{ field: 'city', value: 'Manchester' }],
      [{ field: 'city', value: 'Manchester' }]
    );
    expect(result.matchProbability).toBeGreaterThan(0);
    expect(result.matchProbability).toBeLessThan(1);
  });

  it('case-insensitive name matching', () => {
    const result = computeLinkage(
      [{ field: 'full_name', value: 'GIUSEPPE GIONA' }],
      [{ field: 'full_name', value: 'giuseppe giona' }]
    );
    expect(result.fields[0].agrees).toBe(true);
  });
});

describe('jaroWinkler', () => {
  it('identical strings = 1.0', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1.0);
  });

  it('empty strings = 0', () => {
    expect(jaroWinkler('hello', '')).toBe(0);
    expect(jaroWinkler('', 'hello')).toBe(0);
  });

  it('similar names score high', () => {
    expect(jaroWinkler('giuseppe', 'giusepe')).toBeGreaterThan(0.9);
  });

  it('different strings score low', () => {
    expect(jaroWinkler('abc', 'xyz')).toBeLessThan(0.5);
  });

  it('prefix bonus: "martha" vs "marhta" > "martha" vs "amrtha"', () => {
    const a = jaroWinkler('martha', 'marhta');
    const b = jaroWinkler('martha', 'amrtha');
    expect(a).toBeGreaterThan(b);
  });

  it('is symmetric', () => {
    expect(jaroWinkler('abc', 'abd')).toBeCloseTo(jaroWinkler('abd', 'abc'), 10);
  });

  it('classic Jaro-Winkler test: MARTHA vs MARHTA', () => {
    // known result: Jaro ≈ 0.944, JW ≈ 0.961
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.95);
  });
});
