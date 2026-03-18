import { describe, it, expect } from 'vitest';
import {
  shannonEntropy,
  minEntropy,
  anonymitySetSize,
  selfInfo,
  independentExposure,
  heuristicExposure,
  uniquenessThreshold,
  isUnique,
  uniqueProbability,
  removalGain,
  greedyRemovalOrder,
} from './entropy.js';

describe('shannonEntropy', () => {
  it('returns 0 for degenerate distribution', () => {
    expect(shannonEntropy([1])).toBe(0);
  });

  it('returns 1 bit for fair coin', () => {
    expect(shannonEntropy([0.5, 0.5])).toBeCloseTo(1.0, 10);
  });

  it('returns log₂(n) for uniform distribution over n', () => {
    const n = 8;
    const probs = new Array(n).fill(1 / n);
    expect(shannonEntropy(probs)).toBeCloseTo(3.0, 10); // log₂(8) = 3
  });

  it('is non-negative for any distribution', () => {
    expect(shannonEntropy([0.7, 0.2, 0.1])).toBeGreaterThanOrEqual(0);
    expect(shannonEntropy([0.99, 0.01])).toBeGreaterThanOrEqual(0);
  });

  it('is maximised by uniform distribution', () => {
    const uniform = shannonEntropy([0.25, 0.25, 0.25, 0.25]);
    const skewed = shannonEntropy([0.7, 0.1, 0.1, 0.1]);
    expect(uniform).toBeGreaterThan(skewed);
  });

  it('handles zero probabilities', () => {
    expect(shannonEntropy([1, 0, 0])).toBe(0);
  });

  it('handles empty array', () => {
    expect(shannonEntropy([])).toBe(0);
  });
});

describe('minEntropy', () => {
  it('returns 0 for degenerate distribution', () => {
    expect(minEntropy([1])).toBeCloseTo(0, 10);
  });

  it('returns 1 bit for fair coin', () => {
    expect(minEntropy([0.5, 0.5])).toBeCloseTo(1.0, 10);
  });

  it('is <= Shannon entropy for any distribution', () => {
    const probs = [0.5, 0.3, 0.2];
    expect(minEntropy(probs)).toBeLessThanOrEqual(shannonEntropy(probs) + 1e-10);
  });

  it('equals Shannon entropy for uniform distribution', () => {
    const probs = [0.25, 0.25, 0.25, 0.25];
    expect(minEntropy(probs)).toBeCloseTo(shannonEntropy(probs), 10);
  });
});

describe('anonymitySetSize', () => {
  it('returns 1 for zero entropy (uniquely identified)', () => {
    expect(anonymitySetSize(0)).toBe(1);
  });

  it('returns 2 for 1 bit', () => {
    expect(anonymitySetSize(1)).toBe(2);
  });

  it('returns 1024 for 10 bits', () => {
    expect(anonymitySetSize(10)).toBe(1024);
  });

  it('returns 1 for negative entropy', () => {
    expect(anonymitySetSize(-1)).toBe(1);
  });
});

describe('selfInfo', () => {
  it('returns 0 for frequency 1 (everyone has this value)', () => {
    expect(selfInfo(1)).toBe(0);
  });

  it('returns ~13.3 bits for 1-in-10000', () => {
    expect(selfInfo(1 / 10000)).toBeCloseTo(13.288, 2);
  });

  it('returns ~20 bits for 1-in-1M', () => {
    expect(selfInfo(1 / 1000000)).toBeCloseTo(19.932, 2);
  });

  it('returns 0 for invalid frequencies', () => {
    expect(selfInfo(0)).toBe(0);
    expect(selfInfo(-1)).toBe(0);
    expect(selfInfo(2)).toBe(0);
  });
});

describe('uniquenessThreshold', () => {
  it('returns ~28.3 bits for US population (330M)', () => {
    expect(uniquenessThreshold(330_000_000)).toBeCloseTo(28.3, 0);
  });

  it('returns ~26 bits for UK population (67.8M)', () => {
    expect(uniquenessThreshold(67_800_000)).toBeCloseTo(26.0, 0);
  });

  it('returns 0 for population 1', () => {
    expect(uniquenessThreshold(1)).toBe(0);
  });
});

describe('isUnique', () => {
  it('true when bits exceed threshold', () => {
    // 31.6 bits of QIs vs 28.3 bits needed for US pop
    expect(isUnique(31.6, 330_000_000)).toBe(true);
  });

  it('false when bits below threshold', () => {
    expect(isUnique(20, 330_000_000)).toBe(false);
  });

  it('true when bits exactly equal threshold', () => {
    const n = 1000;
    expect(isUnique(uniquenessThreshold(n), n)).toBe(true);
  });
});

describe('uniqueProbability', () => {
  it('near 1 when bits far exceed threshold', () => {
    expect(uniqueProbability(40, 330_000_000)).toBeGreaterThan(0.99);
  });

  it('near 0 when bits far below threshold', () => {
    expect(uniqueProbability(10, 330_000_000)).toBeLessThan(0.01);
  });

  it('is monotonically increasing in bits', () => {
    const p20 = uniqueProbability(20, 330_000_000);
    const p25 = uniqueProbability(25, 330_000_000);
    const p30 = uniqueProbability(30, 330_000_000);
    expect(p25).toBeGreaterThan(p20);
    expect(p30).toBeGreaterThan(p25);
  });
});

describe('heuristicExposure', () => {
  it('equals selfInfo when correlation is 0', () => {
    expect(heuristicExposure(0.001, 0)).toBeCloseTo(selfInfo(0.001), 10);
  });

  it('approaches 0 as correlation approaches 1', () => {
    expect(heuristicExposure(0.001, 0.99)).toBeLessThan(0.15);
  });

  it('is non-negative', () => {
    expect(heuristicExposure(0.5, 0.3)).toBeGreaterThanOrEqual(0);
  });
});

describe('greedyRemovalOrder', () => {
  it('returns indices sorted by efficiency (bits/difficulty)', () => {
    const attrs = [
      { bits: 5, difficulty: 0.5 },   // eff = 10
      { bits: 10, difficulty: 0.3 },   // eff = 33.3
      { bits: 3, difficulty: 0.9 },    // eff = 3.3
    ];
    const order = greedyRemovalOrder(attrs);
    expect(order).toEqual([1, 0, 2]); // highest efficiency first
  });

  it('handles zero difficulty by clamping to 0.01', () => {
    const attrs = [
      { bits: 5, difficulty: 0 },
      { bits: 10, difficulty: 0.5 },
    ];
    const order = greedyRemovalOrder(attrs);
    expect(order[0]).toBe(0); // 5/0.01 = 500 > 10/0.5 = 20
  });
});

describe('Sweeney replication', () => {
  it('{ZIP, DOB, sex} exceeds US uniqueness threshold', () => {
    // Sweeney (2000): 87% uniquely identified
    // ZIP ≈ 15.4 bits, DOB ≈ 14.8 bits, sex ≈ 1 bit = 31.2 bits
    // US threshold ≈ 28.3 bits
    const zipBits = selfInfo(1 / 42000);  // ~42k ZIPs
    const dobBits = selfInfo(1 / 29220);  // ~365.25 × 80
    const sexBits = selfInfo(0.5);        // ~50/50
    const total = zipBits + dobBits + sexBits;

    expect(total).toBeGreaterThan(uniquenessThreshold(330_000_000));
  });
});
