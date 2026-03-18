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
  if (frequency === 1) return 0;
  return -Math.log(frequency) / LN2;
}

/** Joint self-information of independent quasi-identifiers.
 *  If QIs are independent: I(q1, q2, ...) = Σ I(qi)
 *  This OVERESTIMATES exposure when QIs are correlated
 *  (name correlates with ethnicity, ZIP correlates with income).
 *  Use conditionalExposure() for correlated QIs. */
export function independentExposure(frequencies: number[]): number {
  let total = 0;
  for (const f of frequencies) {
    total += selfInfo(f);
  }
  return total;
}

/** Conditional mutual information: I(Identity; QI_new | QIs_known).
 *  How many additional bits does QI_new reveal, given what the adversary
 *  already knows from QIs_known?
 *
 *  Under independence assumption:
 *    I(Identity; QI_new | QIs_known) = I(QI_new) = selfInfo(freq_new)
 *
 *  With correlation factor ρ (0=independent, 1=fully redundant):
 *    I_cond ≈ selfInfo(freq_new) × (1 - ρ)
 *
 *  The correlation factor should be estimated from population data.
 *  Without population data, we use field-level heuristic correlations. */
export function conditionalMI(
  newFreq: number,
  knownFreqs: number[],
  correlationFactor: number = 0
): number {
  const raw = selfInfo(newFreq);
  const dampened = raw * (1 - Math.min(correlationFactor, 0.99));
  return dampened;
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

/** Probability of unique identification given exposed bits and population.
 *  Under uniform assumption: P(unique) ≈ 1 - e^(-2^(bits - log₂N))
 *  This follows from the birthday problem generalisation. */
export function uniqueProbability(totalBits: number, populationSize: number): number {
  const threshold = uniquenessThreshold(populationSize);
  const excess = totalBits - threshold;
  if (excess < -10) return 0; // far from unique
  if (excess > 10) return 1;  // overwhelmingly unique
  // birthday approximation: expected collisions ≈ N / 2^bits
  // P(unique) ≈ 1 - exp(-1 / (2^excess))
  return 1 - Math.exp(-Math.pow(2, excess));
}

/** Marginal privacy gain from removing a quasi-identifier.
 *  ΔH = I(Identity; QI_removed | remaining QIs)
 *  This is the number of bits the adversary LOSES. */
export function removalGain(
  removedFreq: number,
  correlationWithRemaining: number = 0
): number {
  return conditionalMI(removedFreq, [], correlationWithRemaining);
}

/** Submodular greedy ordering: sort attributes by efficiency
 *  (bits reduced per unit of removal difficulty).
 *  Greedy achieves (1-1/e) ≈ 63% of optimal for submodular functions.
 *  Krause & Golovin, "Submodular Function Maximization" (2014). */
export function greedyRemovalOrder(
  attributes: Array<{ bits: number; difficulty: number }>
): number[] {
  const indices = attributes.map((_, i) => i);
  indices.sort((a, b) => {
    const effA = attributes[a].bits / Math.max(attributes[a].difficulty, 0.01);
    const effB = attributes[b].bits / Math.max(attributes[b].difficulty, 0.01);
    return effB - effA; // descending efficiency
  });
  return indices;
}
