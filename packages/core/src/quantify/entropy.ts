/**
 * Information-theoretic primitives for identity exposure quantification.
 *
 * H(X) = -Σ p(x) log₂ p(x)                  — Shannon entropy
 * I(X;Y) = H(X) - H(X|Y)                     — mutual information
 * Anonymity set = 2^H                         — effective group size
 *
 * References:
 *   Shannon, "A Mathematical Theory of Communication" (1948)
 *   Sweeney, "Simple Demographics Often Identify People Uniquely" (2000)
 *   Díaz et al., "Towards Measuring Anonymity" (2002, PET)
 */

const LN2 = Math.LN2;

/** Shannon entropy of a probability distribution (bits).
 *  H(X) = -Σ p(x) log₂ p(x)
 *  Returns 0 for empty or degenerate distributions. */
export function shannonEntropy(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0 && p <= 1) h -= p * Math.log(p) / LN2;
  }
  return h;
}

/** Min-entropy — captures the adversary's best single guess.
 *  H_∞(X) = -log₂(max p(x))
 *  More conservative than Shannon: a distribution with one dominant value
 *  has low min-entropy even if Shannon entropy is moderate.
 *  Smith, "On the Foundations of Quantitative Information Flow" (2009) */
export function minEntropy(probs: number[]): number {
  let max = 0;
  for (const p of probs) {
    if (p > max) max = p;
  }
  if (max <= 0 || max >= 1) return 0;
  return -Math.log(max) / LN2;
}

/** Effective anonymity set size: 2^H.
 *  A non-uniform distribution over 1000 people might have H=6.3,
 *  giving an effective anonymity set of 2^6.3 ≈ 79.
 *  Díaz et al. (2002) — better metric than raw set cardinality. */
export function anonymitySetSize(entropyBits: number): number {
  if (entropyBits <= 0) return 1;
  return Math.pow(2, entropyBits);
}

/** Self-information (surprisal) of a specific value.
 *  I(x) = -log₂ p(x)
 *  A name shared by 1 in 10,000 people contributes ~13.3 bits.
 *  A name shared by 1 in 10 contributes ~3.3 bits. */
export function selfInfo(frequency: number): number {
  if (frequency <= 0 || frequency >= 1) return 0;
  return -Math.log(frequency) / LN2;
}

/** Joint self-information of independent quasi-identifiers.
 *  If QIs are independent: I(q1, q2, ...) = Σ I(qi)
 *  This OVERESTIMATES exposure when QIs are correlated
 *  (name correlates with ethnicity, ZIP correlates with income). */
export function independentExposure(frequencies: number[]): number {
  let total = 0;
  for (const f of frequencies) {
    total += selfInfo(f);
  }
  return total;
}

/** Heuristic exposure contribution of a new QI given existing ones.
 *
 *  NOT true conditional mutual information — computing I(Identity; QI_new | QIs_known)
 *  requires the joint distribution P(Identity, QI_new, QIs_known), which we don't have.
 *
 *  Instead: dampen by a pairwise correlation factor ρ estimated from population
 *  structure. ρ=0 means independent (full contribution), ρ=1 means redundant (zero).
 *
 *  This is a conservative upper bound when ρ is underestimated —
 *  overestimating exposure is safer than underestimating it. */
export function heuristicExposure(
  newFreq: number,
  correlationFactor: number = 0
): number {
  const raw = selfInfo(newFreq);
  return raw * (1 - Math.min(correlationFactor, 0.99));
}

/** Uniqueness threshold: log₂(N) bits needed to identify one person
 *  in a population of N. */
export function uniquenessThreshold(populationSize: number): number {
  if (populationSize <= 1) return 0;
  return Math.log(populationSize) / LN2;
}

/** Is the subject uniquely identifiable?
 *  True when total exposed bits >= uniqueness threshold.
 *  Sweeney (2000): 31.6 bits from {ZIP, DOB, sex} vs 28.3 bits for US pop. */
export function isUnique(totalBits: number, populationSize: number): boolean {
  return totalBits >= uniquenessThreshold(populationSize);
}

/** Estimated probability of unique identification.
 *
 *  Given B bits of exposed quasi-identifiers and a population of N:
 *    - If B < log₂(N): expected group size ≈ N / 2^B, P(unique) is low
 *    - If B ≈ log₂(N): transition zone
 *    - If B > log₂(N): expected group size < 1, almost certainly unique
 *
 *  We model this as P(unique) ≈ 1 - e^(-2^(B - log₂N)).
 *  This is a sigmoid-like heuristic — NOT derived from the birthday problem.
 *  It has the right asymptotic behaviour: approaches 0 for B << log₂N,
 *  approaches 1 for B >> log₂N, and transitions near B = log₂N. */
export function uniqueProbability(totalBits: number, populationSize: number): number {
  const threshold = uniquenessThreshold(populationSize);
  const excess = totalBits - threshold;
  if (excess < -10) return 0;
  if (excess > 10) return 1;
  return 1 - Math.exp(-Math.pow(2, excess));
}

/** Marginal privacy gain from removing a quasi-identifier.
 *  Approximate: selfInfo(freq) × (1 - correlation with remaining QIs). */
export function removalGain(
  removedFreq: number,
  correlationWithRemaining: number = 0
): number {
  return heuristicExposure(removedFreq, correlationWithRemaining);
}

/** Greedy removal ordering: sort attributes by efficiency
 *  (bits reduced per unit of removal difficulty).
 *
 *  If the exposure function is submodular (diminishing returns from
 *  each additional removal), greedy achieves (1-1/e) ≈ 63% of optimal.
 *  We don't prove submodularity here — the guarantee is aspirational.
 *  Krause & Golovin, "Submodular Function Maximization" in Tractability (2014). */
export function greedyRemovalOrder(
  attributes: Array<{ bits: number; difficulty: number }>
): number[] {
  const indices = attributes.map((_, i) => i);
  indices.sort((a, b) => {
    const effA = attributes[a].bits / Math.max(attributes[a].difficulty, 0.01);
    const effB = attributes[b].bits / Math.max(attributes[b].difficulty, 0.01);
    return effB - effA;
  });
  return indices;
}
