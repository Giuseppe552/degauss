/**
 * Population frequency models for quasi-identifier uniqueness estimation.
 *
 * Computing "how identifiable are you" requires knowing how common your
 * attributes are in the reference population. A rare name in a small city
 * is more identifying than a common name in a large city.
 *
 * Sources for population frequencies:
 *   - US Census: surname frequencies, ZIP population counts
 *   - ONS (UK): name frequencies, postcode populations
 *   - General demographic distributions for DOB, sex
 *
 * When exact frequencies aren't available, we use conservative estimates
 * from published demographic research.
 *
 * References:
 *   Sweeney, "Simple Demographics Often Identify People Uniquely" (2000)
 *   Golle, "Revisiting the Uniqueness of Simple Demographics" (2006)
 */

import type { QIField, PopulationModel, FrequencyDistribution } from './types.js';
import { shannonEntropy } from './entropy.js';

/** Default population sizes by country */
const POPULATIONS: Record<string, number> = {
  US: 335_000_000,
  UK: 67_800_000,
  CA: 40_500_000,
  AU: 26_500_000,
  EU: 448_000_000,
  GLOBAL: 8_100_000_000,
};

/** Heuristic entropy estimates for QI fields (bits).
 *  These are CONSERVATIVE — they assume the adversary has no other info.
 *  Actual conditional entropy is lower when fields are correlated.
 *
 *  Derived from:
 *    - US Census surname list: ~150k distinct surnames, Zipf distribution
 *    - ZIP codes: ~42k in US, ~1.7M postcodes in UK
 *    - DOB: ~365.25 × 80 year range ≈ 29,220 values
 *    - Phone: 10^10 possible, but ~330M active US numbers */
const FIELD_ENTROPY: Record<QIField, number> = {
  full_name: 18.5,    // first × last, highly variable. top 1% of surnames cover 17% of pop
  first_name: 10.2,   // ~4k common names, long tail. Zipf α≈1.1
  last_name: 12.8,    // ~150k surnames in US census, Zipf α≈1.4
  dob: 14.8,          // 365.25 × 80 ≈ 29,220 values, near-uniform
  birth_year: 6.3,    // ~80 values, slight skew toward younger
  sex: 1.0,           // ~50/50
  email: 28.0,        // effectively unique — ~4.5B active addresses
  phone: 25.0,        // effectively unique — ~7B active numbers
  zip: 15.4,          // ~42k US ZIPs, non-uniform (varies 0 to 110k people)
  city: 12.0,         // ~31k US cities, highly non-uniform
  state: 5.7,         // 50 states + DC, non-uniform
  country: 7.9,       // ~195 countries, very non-uniform
  address: 25.0,      // street + number ≈ unique
  employer: 16.0,     // ~6M US employers, non-uniform
  job_title: 12.0,    // ~10k distinct titles, clustered
  username: 22.0,     // high uniqueness, often reused across platforms
  ip_address: 20.0,   // ~4B IPv4, shared via NAT but still identifying
  device_id: 32.0,    // effectively unique
  photo: 30.0,        // biometric — facial recognition makes this very identifying
  ssn_last4: 13.3,    // 10,000 values, near-uniform
  other: 8.0,         // conservative fallback
};

/** Known correlation factors between QI field pairs.
 *  ρ=0 means independent (adds full bits), ρ=1 means redundant (adds nothing).
 *
 *  These are approximate — true correlations vary by population.
 *  Better to overestimate exposure (ρ too low) than underestimate. */
const CORRELATIONS: Array<[QIField, QIField, number]> = [
  // name components are partially correlated (ethnicity link)
  ['first_name', 'last_name', 0.05],
  // ZIP and city are highly correlated
  ['zip', 'city', 0.85],
  ['zip', 'state', 0.95],
  ['city', 'state', 0.70],
  // address contains ZIP and city
  ['address', 'zip', 0.95],
  ['address', 'city', 0.95],
  ['address', 'state', 0.98],
  // full_name subsumes first_name and last_name
  ['full_name', 'first_name', 0.95],
  ['full_name', 'last_name', 0.95],
  // DOB contains birth_year
  ['dob', 'birth_year', 0.95],
  // employer and job_title have weak correlation
  ['employer', 'job_title', 0.15],
  // email often contains name
  ['email', 'full_name', 0.30],
  ['email', 'first_name', 0.20],
  ['email', 'last_name', 0.20],
  // username may correlate with name
  ['username', 'full_name', 0.15],
];

/** Get the heuristic entropy for a QI field (bits). */
export function fieldEntropy(field: QIField): number {
  return FIELD_ENTROPY[field] ?? FIELD_ENTROPY.other;
}

/** Get the correlation factor between two QI fields. */
export function fieldCorrelation(a: QIField, b: QIField): number {
  if (a === b) return 1.0;
  for (const [f1, f2, rho] of CORRELATIONS) {
    if ((f1 === a && f2 === b) || (f1 === b && f2 === a)) return rho;
  }
  return 0; // assume independent if unknown
}

/** Get a population model for a country code. */
export function populationModel(country: string = 'UK'): PopulationModel {
  return {
    size: POPULATIONS[country.toUpperCase()] ?? POPULATIONS.GLOBAL,
    distributions: {},
  };
}

/** Compute the effective frequency of a value for a QI field.
 *  If the exact frequency is known (from population data), use it.
 *  Otherwise, estimate from the field's entropy: f ≈ 2^(-H_field).
 *  This is a worst-case estimate (assumes uniform distribution). */
export function estimateFrequency(field: QIField, value?: string): number {
  // for effectively-unique fields, frequency ≈ 1/N
  const h = fieldEntropy(field);
  return Math.pow(2, -h);
}

/** Compute total exposure bits from a set of observed QI fields,
 *  accounting for correlations between fields.
 *
 *  Uses greedy conditional MI accumulation:
 *  1. Sort fields by raw entropy (descending)
 *  2. For each field, compute conditional MI given already-accumulated fields
 *  3. Sum the conditional MIs
 *
 *  This avoids double-counting correlated attributes
 *  (e.g., ZIP and city both contribute ~15 bits independently,
 *  but together only contribute ~17 bits, not 30). */
export function totalExposureBits(
  fields: QIField[],
  population: PopulationModel = populationModel()
): number {
  if (fields.length === 0) return 0;

  // deduplicate
  const unique = [...new Set(fields)];

  // sort by raw entropy descending (greedy: take highest-value first)
  unique.sort((a, b) => fieldEntropy(b) - fieldEntropy(a));

  let total = 0;
  const accumulated: QIField[] = [];

  for (const field of unique) {
    const rawBits = fieldEntropy(field);

    // find max correlation with any already-accumulated field
    let maxCorr = 0;
    for (const prev of accumulated) {
      const corr = fieldCorrelation(field, prev);
      if (corr > maxCorr) maxCorr = corr;
    }

    // conditional contribution: raw bits × (1 - correlation)
    const contribution = rawBits * (1 - maxCorr);
    total += contribution;
    accumulated.push(field);
  }

  return total;
}

/** Build a frequency distribution from an array of values. */
export function buildDistribution(values: string[]): FrequencyDistribution {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const n = values.length;
  const frequencies = new Map<string, number>();
  const probs: number[] = [];
  for (const [k, c] of counts) {
    const p = c / n;
    frequencies.set(k, p);
    probs.push(p);
  }
  return {
    frequencies,
    entropy: shannonEntropy(probs),
  };
}
