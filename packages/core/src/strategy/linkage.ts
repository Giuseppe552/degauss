/**
 * Probabilistic record linkage using the Fellegi-Sunter model.
 *
 * Computes the probability that two records refer to the same person,
 * based on agreement/disagreement patterns across quasi-identifiers.
 *
 * The log-likelihood ratio for each field:
 *   w(agree) = log₂(m / u)
 *   w(disagree) = log₂((1-m) / (1-u))
 *
 * where:
 *   m = P(agree | true match)   — typically 0.90-0.99
 *   u = P(agree | not a match)  — the field's population frequency
 *
 * Composite score W = Σ w_i. Higher W = more likely a match.
 *
 * References:
 *   Fellegi & Sunter, "A Theory for Record Linkage" (1969, JASA 64(328))
 *   Jaro, "Advances in Record-Linkage Methodology" (1989, JASA 84(406))
 *   Winkler, "Overview of Record Linkage" (2006, US Census Bureau)
 */

import type { QIField } from '../quantify/types.js';
import { estimateFrequency } from '../quantify/population.js';

/** Match probabilities (m-values) by field type.
 *  P(fields agree | records are a true match).
 *  Less than 1.0 because of typos, name variants, format differences. */
const M_PROB: Record<QIField, number> = {
  full_name: 0.92,    // variants: "Giuseppe Giona" vs "G. Giona"
  first_name: 0.95,
  last_name: 0.95,
  dob: 0.98,          // rarely wrong if present
  birth_year: 0.99,
  sex: 0.99,
  email: 0.99,        // near-unique, rarely has errors
  phone: 0.95,        // changes over time
  zip: 0.90,          // people move
  city: 0.90,
  state: 0.95,
  country: 0.98,
  address: 0.85,      // changes frequently
  employer: 0.80,     // changes with jobs
  job_title: 0.75,    // varies even for same role
  username: 0.95,
  ip_address: 0.50,   // changes frequently, shared via NAT
  device_id: 0.90,
  photo: 0.85,        // different photos of same person
  ssn_last4: 0.99,
  other: 0.85,
};

/** Comparison result for a single field */
export interface FieldComparison {
  field: QIField;
  agrees: boolean;
  /** Fellegi-Sunter weight: positive for agreement, negative for disagreement */
  weight: number;
  /** m-probability used */
  mProb: number;
  /** u-probability (population frequency) */
  uProb: number;
}

/** Full linkage result between two records */
export interface LinkageResult {
  /** composite weight — sum of field weights */
  compositeWeight: number;
  /** posterior probability of match (sigmoid of composite weight) */
  matchProbability: number;
  /** per-field breakdown */
  fields: FieldComparison[];
  /** classification: match / possible / non-match */
  classification: 'match' | 'possible' | 'non_match';
}

/** Thresholds for classification (in bits, approximately) */
const MATCH_THRESHOLD = 10;    // above this = definite match
const POSSIBLE_THRESHOLD = 3;  // above this = possible match

/** Compute the Fellegi-Sunter linkage weight for a single field. */
export function fieldWeight(
  field: QIField,
  agrees: boolean,
  uOverride?: number
): FieldComparison {
  const m = M_PROB[field] ?? M_PROB.other;
  const u = uOverride ?? estimateFrequency(field);

  let weight: number;
  if (agrees) {
    // w(agree) = log₂(m / u)
    // agreement on a rare field (low u) gives a high positive weight
    weight = Math.log2(m / Math.max(u, 1e-15));
  } else {
    // w(disagree) = log₂((1-m) / (1-u))
    // disagreement on a field that almost always matches (high m)
    // gives a large negative weight
    weight = Math.log2((1 - m) / Math.max(1 - u, 1e-15));
  }

  return { field, agrees, weight, mProb: m, uProb: u };
}

/** Compute linkage between two sets of QI values.
 *  Returns the composite weight, match probability, and per-field breakdown. */
export function computeLinkage(
  recordA: Array<{ field: QIField; value: string }>,
  recordB: Array<{ field: QIField; value: string }>
): LinkageResult {
  const fields: FieldComparison[] = [];
  const fieldsInA = new Set(recordA.map(q => q.field));
  const fieldsInB = new Set(recordB.map(q => q.field));

  // for each field present in both records, compare
  for (const field of fieldsInA) {
    if (!fieldsInB.has(field)) continue;

    const valA = recordA.find(q => q.field === field)!.value;
    const valB = recordB.find(q => q.field === field)!.value;
    const agrees = normaliseCompare(valA, valB, field);

    fields.push(fieldWeight(field, agrees));
  }

  const compositeWeight = fields.reduce((sum, f) => sum + f.weight, 0);

  // convert composite weight to probability via sigmoid
  // P(match | W) = σ(W) = 1 / (1 + 2^(-W))
  // this is a calibrated estimate when m and u probabilities are accurate
  const matchProbability = 1 / (1 + Math.pow(2, -compositeWeight));

  let classification: LinkageResult['classification'];
  if (compositeWeight >= MATCH_THRESHOLD) classification = 'match';
  else if (compositeWeight >= POSSIBLE_THRESHOLD) classification = 'possible';
  else classification = 'non_match';

  return { compositeWeight, matchProbability, fields, classification };
}

/** Jaro-Winkler similarity for approximate string matching.
 *  Jaro, "Advances in Record-Linkage Methodology" (1989)
 *  Winkler extended it with a prefix bonus. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (matches / a.length + matches / b.length +
    (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function normaliseCompare(a: string, b: string, field: QIField): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();

  // exact fields: email, phone, SSN — must match exactly after normalisation
  if (['email', 'phone', 'ssn_last4', 'dob', 'birth_year', 'device_id'].includes(field)) {
    const cleanA = na.replace(/[\s\-\(\)\+\.]/g, '');
    const cleanB = nb.replace(/[\s\-\(\)\+\.]/g, '');
    return cleanA === cleanB;
  }

  // name fields: use Jaro-Winkler with 0.85 threshold
  if (['full_name', 'first_name', 'last_name'].includes(field)) {
    return jaroWinkler(na, nb) >= 0.85;
  }

  // location fields: exact after normalisation
  return na === nb;
}
