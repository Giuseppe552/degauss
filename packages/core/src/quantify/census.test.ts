import { describe, it, expect } from 'vitest';
import {
  surnameFrequency,
  firstNameFrequency,
  fullNameFrequency,
  zipFrequency,
} from './census.js';
import { selfInfo } from './entropy.js';

describe('surnameFrequency', () => {
  it('Smith is the most common US surname (~0.88%)', () => {
    expect(surnameFrequency('Smith', 'US')).toBeCloseTo(0.00881, 4);
  });

  it('case-insensitive', () => {
    expect(surnameFrequency('SMITH')).toBe(surnameFrequency('smith'));
  });

  it('Smith is more common in UK (~1.21%)', () => {
    expect(surnameFrequency('Smith', 'UK')).toBeGreaterThan(surnameFrequency('Smith', 'US'));
  });

  it('rare surname falls back to long-tail estimate', () => {
    const freq = surnameFrequency('Giona', 'US');
    expect(freq).toBeLessThan(0.0001); // not in top 50
    expect(freq).toBeGreaterThan(0);
  });

  it('rare surname contributes more bits than common one', () => {
    const smithBits = selfInfo(surnameFrequency('Smith'));
    const gionaBits = selfInfo(surnameFrequency('Giona'));
    expect(gionaBits).toBeGreaterThan(smithBits);
    // Smith ≈ 6.8 bits, Giona ≈ 17.6 bits
    expect(smithBits).toBeGreaterThan(5);
    expect(gionaBits).toBeGreaterThan(15);
  });
});

describe('firstNameFrequency', () => {
  it('James is common in US (~3.2%)', () => {
    expect(firstNameFrequency('James', 'US')).toBeCloseTo(0.032, 3);
  });

  it('Giuseppe is very rare in US', () => {
    expect(firstNameFrequency('Giuseppe', 'US')).toBeLessThan(0.001);
  });

  it('rare name gives more bits', () => {
    const jamesBits = selfInfo(firstNameFrequency('James'));
    const giuseppeBits = selfInfo(firstNameFrequency('Giuseppe'));
    expect(giuseppeBits).toBeGreaterThan(jamesBits + 5); // much more identifying
  });
});

describe('fullNameFrequency', () => {
  it('John Smith is relatively common', () => {
    const freq = fullNameFrequency('John Smith', 'US');
    // ~0.0291 × 0.00881 ≈ 0.000256
    expect(freq).toBeGreaterThan(0.0001);
    expect(freq).toBeLessThan(0.001);
  });

  it('Giuseppe Giona is extremely rare', () => {
    const freq = fullNameFrequency('Giuseppe Giona', 'US');
    // ~0.000015 × 0.000005 = 7.5e-11
    expect(freq).toBeLessThan(1e-8);
  });

  it('rare full name gives many more bits', () => {
    const smithBits = selfInfo(fullNameFrequency('John Smith'));
    const gionaBits = selfInfo(fullNameFrequency('Giuseppe Giona'));
    // John Smith ≈ 12 bits, Giuseppe Giona ≈ 34 bits
    expect(gionaBits).toBeGreaterThan(smithBits + 10);
  });

  it('single-word name treated as surname', () => {
    const freq = fullNameFrequency('Smith');
    expect(freq).toBe(surnameFrequency('Smith'));
  });
});

describe('zipFrequency', () => {
  it('US ZIP gives small frequency', () => {
    const freq = zipFrequency('97201', 'US');
    expect(freq).toBeGreaterThan(0);
    expect(freq).toBeLessThan(0.001);
  });

  it('UK full postcode is more identifying than outcode', () => {
    const full = zipFrequency('M1 1AA', 'UK');
    const outcode = zipFrequency('M1', 'UK');
    expect(full).toBeLessThan(outcode); // lower freq = more identifying
  });

  it('UK full postcode is very identifying', () => {
    const bits = selfInfo(zipFrequency('M1 1AA', 'UK'));
    expect(bits).toBeGreaterThan(20); // ~40 people out of 67.8M
  });
});

describe('value-aware estimateFrequency integration', () => {
  // test that estimateFrequency in population.ts now uses census data
  it('Smith vs Giona should differ', async () => {
    const { estimateFrequency } = await import('./population.js');
    const smith = estimateFrequency('last_name', 'Smith');
    const giona = estimateFrequency('last_name', 'Giona');
    expect(smith).toBeGreaterThan(giona); // Smith more common
    expect(smith / giona).toBeGreaterThan(100); // orders of magnitude different
  });
});
