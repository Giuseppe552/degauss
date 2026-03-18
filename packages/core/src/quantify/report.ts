/**
 * Exposure report generation.
 *
 * Combines entropy quantification, identity graph analysis, and
 * submodular greedy optimization into a single actionable report.
 *
 * The report answers:
 *   1. How identifiable am I? (bits of exposure vs uniqueness threshold)
 *   2. What's my anonymity set? (2^(remaining uncertainty))
 *   3. What should I remove first? (greedy ordering by efficiency)
 *   4. How much will each removal help? (conditional MI per step)
 */

import type {
  ExposureRecord,
  ExposureReport,
  AttributeExposure,
  RemovalStep,
  QIField,
  PopulationModel,
} from './types.js';
import {
  selfInfo,
  uniquenessThreshold,
  anonymitySetSize,
  greedyRemovalOrder,
} from './entropy.js';
import {
  fieldEntropy,
  fieldCorrelation,
  populationModel,
  totalExposureBits,
  estimateFrequency,
} from './population.js';
import { buildIdentityGraph, findMinCut } from './graph.js';

/** Difficulty estimates for removing data from different source types.
 *  0 = trivial (self-service delete), 1 = extremely difficult (government records). */
const SOURCE_DIFFICULTY: Record<string, number> = {
  // people-search brokers — most have opt-out forms
  spokeo: 0.3,
  whitepages: 0.3,
  beenverified: 0.4,
  truepeoplesearch: 0.3,
  fastpeoplesearch: 0.3,
  intelius: 0.4,
  peoplefinder: 0.3,
  pipl: 0.5,
  radaris: 0.8,     // deliberately obstructive
  lexisnexis: 0.9,  // requires police report or protective order

  // social media — self-service but account deletion is destructive
  linkedin: 0.2,
  facebook: 0.3,
  twitter: 0.2,
  instagram: 0.3,

  // government records — effectively impossible to remove
  voter_roll: 1.0,
  property_record: 1.0,
  court_filing: 0.95,
  business_registration: 0.9,

  // other
  google_search: 0.5,
  unknown: 0.5,
};

/** Estimate jurisdiction for a source. */
function inferJurisdiction(source: string, country: string): RemovalStep['jurisdiction'] {
  const src = source.toLowerCase();

  // DMCA applies to photos regardless of jurisdiction
  // (handled separately in the removal plan)

  if (country === 'UK') return 'uk_dpa';
  if (country === 'EU' || ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE'].includes(country)) return 'gdpr';
  if (country === 'US') {
    // California residents get CCPA; others may have state laws
    return 'ccpa'; // default to strongest US protection
  }
  return 'unknown';
}

/** Generate a complete exposure report. */
export function generateReport(
  records: ExposureRecord[],
  country: string = 'UK'
): ExposureReport {
  const pop = populationModel(country);
  const threshold = uniquenessThreshold(pop.size);

  // collect all exposed QI fields across all records
  const allFields: QIField[] = [];
  const fieldSources = new Map<QIField, Set<string>>();
  const fieldFreqs = new Map<QIField, number>();

  for (const rec of records) {
    for (const qi of rec.qis) {
      if (!fieldSources.has(qi.field)) {
        fieldSources.set(qi.field, new Set());
      }
      fieldSources.get(qi.field)!.add(rec.source);

      if (!allFields.includes(qi.field)) {
        allFields.push(qi.field);
      }

      // use the most specific frequency we have
      if (qi.frequency && (!fieldFreqs.has(qi.field) || qi.frequency < fieldFreqs.get(qi.field)!)) {
        fieldFreqs.set(qi.field, qi.frequency);
      }
    }
  }

  // compute total exposure
  const totalBits = totalExposureBits(allFields, pop);
  const remaining = Math.max(0, threshold - totalBits);
  const anonSet = anonymitySetSize(remaining);
  const unique = totalBits >= threshold;

  // per-attribute analysis
  const attributes: AttributeExposure[] = allFields.map(field => {
    const freq = fieldFreqs.get(field) ?? estimateFrequency(field);
    const rawBits = selfInfo(freq);
    const sources = fieldSources.get(field)?.size ?? 0;

    // compute conditional MI: how much does this field add given others?
    const otherFields = allFields.filter(f => f !== field);
    let maxCorr = 0;
    for (const other of otherFields) {
      const c = fieldCorrelation(field, other);
      if (c > maxCorr) maxCorr = c;
    }
    const cmi = rawBits * (1 - maxCorr);

    // difficulty: max difficulty across all sources exposing this field
    let maxDifficulty = 0;
    for (const src of fieldSources.get(field) ?? []) {
      const d = SOURCE_DIFFICULTY[src.toLowerCase()] ?? SOURCE_DIFFICULTY.unknown;
      if (d > maxDifficulty) maxDifficulty = d;
    }

    // but we want MINIMUM difficulty (easiest source to remove from)
    let minDifficulty = 1;
    for (const src of fieldSources.get(field) ?? []) {
      const d = SOURCE_DIFFICULTY[src.toLowerCase()] ?? SOURCE_DIFFICULTY.unknown;
      if (d < minDifficulty) minDifficulty = d;
    }

    const efficiency = cmi / Math.max(minDifficulty, 0.01);

    return {
      field,
      conditionalMI: cmi,
      sourceCount: sources,
      removalDifficulty: minDifficulty,
      efficiency,
    };
  });

  // sort by efficiency (best target first)
  attributes.sort((a, b) => b.efficiency - a.efficiency);

  // build identity graph
  const graph = buildIdentityGraph(records);

  // build removal plan using submodular greedy
  const removalPlan = buildRemovalPlan(records, attributes, graph, pop, country);

  return {
    totalBits,
    uniquenessThreshold: threshold,
    anonymitySet: Math.round(anonSet),
    uniquelyIdentifiable: unique,
    attributes,
    graph,
    removalPlan,
  };
}

/** Build the optimal removal plan.
 *  Greedy: at each step, remove the record that maximises
 *  (bits reduced / removal difficulty). */
function buildRemovalPlan(
  records: ExposureRecord[],
  attributes: AttributeExposure[],
  graph: ReturnType<typeof buildIdentityGraph>,
  pop: PopulationModel,
  country: string
): RemovalStep[] {
  const plan: RemovalStep[] = [];
  const removedRecords = new Set<number>();
  let currentBits = totalExposureBits(
    records.flatMap(r => r.qis.map(q => q.field)),
    pop
  );

  // use min-cut to identify critical edges
  const cutEdgeIndices = findMinCut(records.length, graph.edges);
  const criticalRecords = new Set<number>();
  for (const idx of cutEdgeIndices) {
    const e = graph.edges[idx];
    criticalRecords.add(e.from);
    criticalRecords.add(e.to);
  }

  // score each record by removal value
  const scored = records.map((rec, i) => {
    const fields = rec.qis.map(q => q.field);
    let bits = 0;
    for (const f of fields) {
      const attr = attributes.find(a => a.field === f);
      if (attr) bits += attr.conditionalMI;
    }

    const difficulty = SOURCE_DIFFICULTY[rec.source.toLowerCase()] ?? 0.5;
    const isCritical = criticalRecords.has(i);
    // critical records get a 2x bonus — they're on the min-cut
    const score = (bits * (isCritical ? 2 : 1)) / Math.max(difficulty, 0.01);

    return { index: i, bits, difficulty, score, fields };
  });

  scored.sort((a, b) => b.score - a.score);

  for (const s of scored) {
    if (removedRecords.has(s.index)) continue;
    if (s.bits < 0.1) continue; // not worth removing

    removedRecords.add(s.index);

    // simulate removal: recalculate bits without this record's unique fields
    const remainingFields = records
      .filter((_, i) => !removedRecords.has(i))
      .flatMap(r => r.qis.map(q => q.field));
    const newBits = totalExposureBits(remainingFields, pop);
    const bitsReduced = currentBits - newBits;
    currentBits = newBits;

    const remaining = Math.max(0, uniquenessThreshold(pop.size) - newBits);
    const anonAfter = Math.round(anonymitySetSize(remaining));

    plan.push({
      recordIndex: s.index,
      source: records[s.index].source,
      fields: s.fields,
      bitsReduced: Math.round(bitsReduced * 100) / 100,
      anonymitySetAfter: anonAfter,
      jurisdiction: inferJurisdiction(records[s.index].source, country),
    });
  }

  return plan;
}
