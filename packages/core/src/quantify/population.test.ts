import { describe, it, expect } from 'vitest';
import {
  fieldEntropy,
  fieldCorrelation,
  populationModel,
  totalExposureBits,
  buildDistribution,
  estimateFrequency,
} from './population.js';

describe('fieldEntropy', () => {
  it('email is near-unique (~28 bits)', () => {
    expect(fieldEntropy('email')).toBeGreaterThan(25);
  });

  it('sex has ~1 bit', () => {
    expect(fieldEntropy('sex')).toBe(1.0);
  });

  it('full_name has moderate entropy', () => {
    expect(fieldEntropy('full_name')).toBeGreaterThan(15);
    expect(fieldEntropy('full_name')).toBeLessThan(25);
  });

  it('returns a default for unknown fields', () => {
    expect(fieldEntropy('other')).toBeGreaterThan(0);
  });
});

describe('fieldCorrelation', () => {
  it('ZIP and city are highly correlated', () => {
    expect(fieldCorrelation('zip', 'city')).toBeGreaterThan(0.7);
  });

  it('ZIP and state are very highly correlated', () => {
    expect(fieldCorrelation('zip', 'state')).toBeGreaterThan(0.9);
  });

  it('name and phone are independent (0)', () => {
    expect(fieldCorrelation('first_name', 'phone')).toBe(0);
  });

  it('self-correlation is 1', () => {
    expect(fieldCorrelation('email', 'email')).toBe(1.0);
  });

  it('is symmetric', () => {
    expect(fieldCorrelation('zip', 'city')).toBe(fieldCorrelation('city', 'zip'));
  });
});

describe('totalExposureBits', () => {
  it('returns 0 for no fields', () => {
    expect(totalExposureBits([])).toBe(0);
  });

  it('single field returns its entropy', () => {
    expect(totalExposureBits(['email'])).toBe(fieldEntropy('email'));
  });

  it('uncorrelated fields sum their entropies', () => {
    // name and phone are independent
    const combined = totalExposureBits(['first_name', 'phone']);
    const sum = fieldEntropy('first_name') + fieldEntropy('phone');
    expect(combined).toBeCloseTo(sum, 5);
  });

  it('correlated fields contribute less than their sum', () => {
    // ZIP and city are highly correlated
    const combined = totalExposureBits(['zip', 'city']);
    const sum = fieldEntropy('zip') + fieldEntropy('city');
    expect(combined).toBeLessThan(sum);
  });

  it('deduplicates fields', () => {
    const once = totalExposureBits(['email']);
    const twice = totalExposureBits(['email', 'email']);
    expect(twice).toBeCloseTo(once, 10);
  });

  it('typical combo exceeds UK threshold', () => {
    // name + email + phone + city = easily identifiable
    const bits = totalExposureBits(['full_name', 'email', 'phone', 'city']);
    const threshold = Math.log2(67_800_000); // UK pop
    expect(bits).toBeGreaterThan(threshold);
  });
});

describe('populationModel', () => {
  it('returns UK population for "UK"', () => {
    expect(populationModel('UK').size).toBe(67_800_000);
  });

  it('returns US population for "US"', () => {
    expect(populationModel('US').size).toBe(335_000_000);
  });

  it('returns global for unknown country', () => {
    expect(populationModel('XX').size).toBe(8_100_000_000);
  });
});

describe('buildDistribution', () => {
  it('computes correct frequencies', () => {
    const dist = buildDistribution(['a', 'a', 'b', 'c']);
    expect(dist.frequencies.get('a')).toBe(0.5);
    expect(dist.frequencies.get('b')).toBe(0.25);
    expect(dist.frequencies.get('c')).toBe(0.25);
  });

  it('computes correct entropy', () => {
    const dist = buildDistribution(['a', 'b']); // uniform binary
    expect(dist.entropy).toBeCloseTo(1.0, 10);
  });

  it('entropy is 0 for single value', () => {
    expect(buildDistribution(['x', 'x', 'x']).entropy).toBe(0);
  });
});

describe('estimateFrequency', () => {
  it('returns 2^(-H) for any field', () => {
    const f = estimateFrequency('email');
    expect(f).toBeCloseTo(Math.pow(2, -fieldEntropy('email')), 15);
  });

  it('email frequency is very small (near-unique)', () => {
    expect(estimateFrequency('email')).toBeLessThan(1e-7);
  });

  it('sex frequency is ~0.5', () => {
    expect(estimateFrequency('sex')).toBeCloseTo(0.5, 1);
  });
});
