/**
 * Statistical broker coverage model.
 *
 * Instead of scraping brokers (which blocks on Cloudflare), predict
 * which brokers are likely to have your data using population statistics
 * and known broker coverage rates.
 *
 * The model:
 *   P(broker has your data) = base_coverage × source_multiplier × uniqueness_factor
 *
 * Where:
 *   - base_coverage: fraction of the population the broker indexes (~60-90%)
 *   - source_multiplier: how many upstream data sources feed this broker
 *   - uniqueness_factor: rarer names are EASIER to match (fewer false positives
 *     for the broker), so coverage is actually higher for unique individuals
 *
 * This gives a probabilistic exposure estimate without network access.
 * The user can then manually verify the top predictions.
 *
 * Data sources for coverage estimates:
 *   - CPPA Data Broker Registry (527+ registered brokers, 2024-2025)
 *   - Senate JEC report on data broker practices (Feb 2026)
 *   - Optery/Incogni comparative testing data
 */

import type { QIField } from '../quantify/types.js';
import { fullNameFrequency, surnameFrequency } from '../quantify/census.js';

/** Known broker coverage estimates.
 *  base_coverage: fraction of US/UK adults indexed.
 *  These are rough estimates from comparative testing by privacy services.
 *  Higher = more likely to have your data. */
export interface BrokerCoverage {
  id: string;
  name: string;
  /** fraction of adults in the broker's primary market */
  baseCoverage: number;
  /** primary market (US, UK, global) */
  market: string;
  /** data types typically available */
  typicalFields: QIField[];
  /** how the broker acquires data */
  primarySources: string[];
  /** opt-out URL */
  optOutUrl: string;
  /** opt-out difficulty description */
  optOutMethod: string;
}

const BROKER_COVERAGE: BrokerCoverage[] = [
  {
    id: 'spokeo', name: 'Spokeo', baseCoverage: 0.75, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'email', 'birth_year', 'employer'],
    primarySources: ['public records', 'social media scraping', 'marketing databases'],
    optOutUrl: 'https://www.spokeo.com/optout',
    optOutMethod: 'Enter URL of your profile → verify email → removed within 24-48h',
  },
  {
    id: 'whitepages', name: 'WhitePages', baseCoverage: 0.80, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'birth_year'],
    primarySources: ['phone directories', 'public records', 'partner feeds'],
    optOutUrl: 'https://www.whitepages.com/suppression-requests',
    optOutMethod: 'Search → find your listing → click opt out → verify phone',
  },
  {
    id: 'beenverified', name: 'BeenVerified', baseCoverage: 0.70, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'email', 'dob', 'employer'],
    primarySources: ['Acxiom', 'LexisNexis', 'public records'],
    optOutUrl: 'https://www.beenverified.com/faq/opt-out',
    optOutMethod: 'Email privacy@beenverified.com with full name + DOB + address',
  },
  {
    id: 'truepeoplesearch', name: 'TruePeopleSearch', baseCoverage: 0.70, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'birth_year'],
    primarySources: ['public records', 'voter rolls', 'phone directories'],
    optOutUrl: 'https://www.truepeoplesearch.com/removal',
    optOutMethod: 'Search → find listing → click "Remove This Record" → instant removal',
  },
  {
    id: 'fastpeoplesearch', name: 'FastPeopleSearch', baseCoverage: 0.65, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'birth_year'],
    primarySources: ['public records', 'voter rolls'],
    optOutUrl: 'https://www.fastpeoplesearch.com/removal',
    optOutMethod: 'Search → find listing → click remove → verify CAPTCHA',
  },
  {
    id: 'intelius', name: 'Intelius', baseCoverage: 0.65, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'email', 'employer'],
    primarySources: ['Acxiom', 'public records', 'social media'],
    optOutUrl: 'https://www.intelius.com/optout',
    optOutMethod: 'Submit form with name + address + DOB → processed within 72h',
  },
  {
    id: 'radaris', name: 'Radaris', baseCoverage: 0.60, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'employer', 'photo'],
    primarySources: ['public records', 'court filings', 'social media scraping'],
    optOutUrl: 'https://radaris.com/control/privacy',
    optOutMethod: 'Create account → request removal → often ignores requests. File FTC complaint if no response.',
  },
  {
    id: 'pipl', name: 'Pipl', baseCoverage: 0.50, market: 'global',
    typicalFields: ['full_name', 'email', 'phone', 'username', 'employer', 'photo'],
    primarySources: ['social media aggregation', 'LinkedIn scraping', 'public records'],
    optOutUrl: 'https://pipl.com/personal-information-removal-request',
    optOutMethod: 'Submit form → 30 days processing',
  },
  {
    id: 'linkedin', name: 'LinkedIn', baseCoverage: 0.45, market: 'global',
    typicalFields: ['full_name', 'city', 'employer', 'job_title', 'photo'],
    primarySources: ['user-submitted'],
    optOutUrl: 'https://www.linkedin.com/help/linkedin/answer/a1339364',
    optOutMethod: 'Settings → Visibility → adjust what\'s public. Full removal: close account.',
  },
  {
    id: 'mylife', name: 'MyLife', baseCoverage: 0.55, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'birth_year', 'employer'],
    primarySources: ['public records', 'court filings', 'marketing databases'],
    optOutUrl: 'https://www.mylife.com/ccpa/index.pubview',
    optOutMethod: 'Submit CCPA deletion request form',
  },
  {
    id: 'nuwber', name: 'Nuwber', baseCoverage: 0.50, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'email'],
    primarySources: ['public records', 'phone directories'],
    optOutUrl: 'https://nuwber.com/removal/link',
    optOutMethod: 'Search → find listing → request removal → verify email',
  },
  {
    id: 'thatsthem', name: 'ThatsThem', baseCoverage: 0.55, market: 'US',
    typicalFields: ['full_name', 'address', 'phone', 'email', 'ip_address'],
    primarySources: ['public records', 'marketing data', 'IP geolocation'],
    optOutUrl: 'https://thatsthem.com/optout',
    optOutMethod: 'Enter your listing URL → submit → processed within 24-48h',
  },
];

/** Predict the probability that a specific broker has your data.
 *
 *  P(has_data) = base_coverage × name_factor × field_overlap
 *
 *  name_factor: rarer names have slightly higher match confidence
 *  (fewer false positives for the broker's matching algorithm).
 *  But very rare names might not appear in source datasets at all.
 *  So: common names → P≈base, moderately rare → slightly higher,
 *  extremely rare → slightly lower (might not be in public records). */
export function predictBrokerCoverage(
  broker: BrokerCoverage,
  name: string,
  country: string,
  knownFields: QIField[] = []
): {
  probability: number;
  likelyFields: QIField[];
  optOutUrl: string;
  optOutMethod: string;
} {
  let prob = broker.baseCoverage;

  // market adjustment: US brokers don't cover UK residents well
  if (broker.market === 'US' && country === 'UK') {
    prob *= 0.15; // US brokers have ~15% coverage of UK residents
  } else if (broker.market === 'US' && country !== 'US') {
    prob *= 0.10;
  }

  // name frequency factor
  const nameFreq = fullNameFrequency(name, country === 'UK' ? 'UK' : 'US');
  if (nameFreq > 0.0001) {
    // common name — broker definitely has many records, but which is YOU?
    // slightly lower confidence of correct match
    prob *= 0.95;
  } else if (nameFreq > 0.000001) {
    // moderately rare — good match confidence
    prob *= 1.05;
  } else {
    // extremely rare — might not appear in source data at all
    prob *= 0.7;
  }

  // field overlap: if the user already knows they have a listed phone,
  // brokers that index phone data are more likely to have them
  if (knownFields.length > 0) {
    const overlap = broker.typicalFields.filter(f => knownFields.includes(f)).length;
    const ratio = overlap / Math.max(knownFields.length, 1);
    prob *= 0.8 + ratio * 0.4; // range: 0.8 to 1.2
  }

  return {
    probability: Math.min(Math.round(prob * 100) / 100, 0.99),
    likelyFields: broker.typicalFields,
    optOutUrl: broker.optOutUrl,
    optOutMethod: broker.optOutMethod,
  };
}

/** Predict coverage across ALL known brokers.
 *  Returns sorted by probability (highest first). */
export function predictAllBrokers(
  name: string,
  country: string,
  knownFields: QIField[] = []
): Array<{
  broker: BrokerCoverage;
  probability: number;
  likelyFields: QIField[];
  optOutUrl: string;
  optOutMethod: string;
}> {
  return BROKER_COVERAGE
    .map(broker => ({
      broker,
      ...predictBrokerCoverage(broker, name, country, knownFields),
    }))
    .sort((a, b) => b.probability - a.probability);
}

/** Compute expected total exposure across all brokers.
 *  E[bits] = Σ P(broker_i has data) × bits_if_present
 *
 *  This gives a probabilistic exposure score WITHOUT scanning anything. */
export function expectedExposure(
  name: string,
  country: string,
  knownFields: QIField[] = []
): {
  expectedBits: number;
  expectedBrokers: number;
  topBrokers: Array<{ name: string; probability: number; optOutUrl: string }>;
} {
  const predictions = predictAllBrokers(name, country, knownFields);

  // for each broker, expected bits = P(present) × typical fields' entropy
  let expectedBits = 0;
  let expectedBrokers = 0;

  for (const pred of predictions) {
    expectedBrokers += pred.probability;
    // rough estimate: each broker exposes ~20-30 bits if present
    const bitsIfPresent = pred.likelyFields.length * 4; // ~4 bits per field average
    expectedBits += pred.probability * bitsIfPresent;
  }

  return {
    expectedBits: Math.round(expectedBits * 10) / 10,
    expectedBrokers: Math.round(expectedBrokers * 10) / 10,
    topBrokers: predictions
      .filter(p => p.probability > 0.3)
      .map(p => ({
        name: p.broker.name,
        probability: p.probability,
        optOutUrl: p.optOutUrl,
      })),
  };
}

/** Get all broker coverage data (for display). */
export function getAllBrokers(): BrokerCoverage[] {
  return [...BROKER_COVERAGE];
}
