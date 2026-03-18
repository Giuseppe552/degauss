/**
 * Synthetic identity generation for data dilution.
 *
 * When removal fails or is impractical (public records, government data),
 * an alternative strategy is DILUTION: increasing k-anonymity by adding
 * statistically plausible records that share the target's quasi-identifiers.
 *
 * If a data broker has 1 "Giuseppe Giona" in Manchester, the adversary
 * knows that's the target. If there are 50 "Giuseppe Giona" records with
 * different addresses, phones, and employers, the adversary's confidence
 * drops to 1/50 (≈5.6 bits of uncertainty added).
 *
 * This is the TrackMeNot principle (Howe & Nissenbaum, 2009) applied to
 * identity records rather than search queries.
 *
 * The synthetic records must be:
 *   1. Statistically plausible (drawn from realistic distributions)
 *   2. Internally consistent (city matches ZIP, area code matches region)
 *   3. Diverse enough to actually increase entropy
 *   4. Not so perfect that they're detectable as synthetic
 *
 * ETHICAL NOTE: This module generates synthetic data for analysis and
 * privacy research. It does NOT submit records to any service. The user
 * decides what to do with the output.
 *
 * References:
 *   Howe & Nissenbaum, "TrackMeNot" (2009)
 *   Brunton & Nissenbaum, "Obfuscation: A User's Guide" (2015)
 *   Sweeney, "k-Anonymity" (2002)
 */

import type { QIField } from '../quantify/types.js';

export interface SyntheticProfile {
  /** the generated quasi-identifier values */
  fields: Partial<Record<QIField, string>>;
  /** which fields were preserved from the real profile (anchors) */
  anchors: QIField[];
  /** which fields were randomised */
  randomised: QIField[];
  /** estimated plausibility score (0-1) */
  plausibility: number;
}

export interface DilutionConfig {
  /** how many synthetic profiles to generate */
  count: number;
  /** which fields to keep identical to real profile (usually just name) */
  anchorFields: QIField[];
  /** target k-anonymity (default 20) */
  targetK: number;
  /** country for generating plausible data */
  country: string;
}

/** US geographic data for consistent city/state/ZIP generation */
const US_LOCATIONS = [
  { city: 'Austin', state: 'TX', zips: ['73301', '78701', '78702'] },
  { city: 'Portland', state: 'OR', zips: ['97201', '97202', '97203'] },
  { city: 'Denver', state: 'CO', zips: ['80201', '80202', '80203'] },
  { city: 'Seattle', state: 'WA', zips: ['98101', '98102', '98103'] },
  { city: 'Chicago', state: 'IL', zips: ['60601', '60602', '60603'] },
  { city: 'Boston', state: 'MA', zips: ['02101', '02102', '02103'] },
  { city: 'Miami', state: 'FL', zips: ['33101', '33102', '33103'] },
  { city: 'Phoenix', state: 'AZ', zips: ['85001', '85002', '85003'] },
  { city: 'Nashville', state: 'TN', zips: ['37201', '37202', '37203'] },
  { city: 'Minneapolis', state: 'MN', zips: ['55401', '55402', '55403'] },
  { city: 'Atlanta', state: 'GA', zips: ['30301', '30302', '30303'] },
  { city: 'Charlotte', state: 'NC', zips: ['28201', '28202', '28203'] },
  { city: 'San Diego', state: 'CA', zips: ['92101', '92102', '92103'] },
  { city: 'Columbus', state: 'OH', zips: ['43201', '43202', '43203'] },
  { city: 'Indianapolis', state: 'IN', zips: ['46201', '46202', '46203'] },
];

const UK_LOCATIONS = [
  { city: 'Manchester', state: 'Greater Manchester', zips: ['M1 1AA', 'M2 1BB', 'M3 2CC'] },
  { city: 'Birmingham', state: 'West Midlands', zips: ['B1 1AA', 'B2 2BB', 'B3 3CC'] },
  { city: 'Leeds', state: 'West Yorkshire', zips: ['LS1 1AA', 'LS2 2BB', 'LS3 3CC'] },
  { city: 'Glasgow', state: 'Scotland', zips: ['G1 1AA', 'G2 2BB', 'G3 3CC'] },
  { city: 'Bristol', state: 'Bristol', zips: ['BS1 1AA', 'BS2 2BB', 'BS3 3CC'] },
  { city: 'Liverpool', state: 'Merseyside', zips: ['L1 1AA', 'L2 2BB', 'L3 3CC'] },
  { city: 'Edinburgh', state: 'Scotland', zips: ['EH1 1AA', 'EH2 2BB', 'EH3 3CC'] },
  { city: 'Cardiff', state: 'Wales', zips: ['CF1 1AA', 'CF2 2BB', 'CF3 3CC'] },
  { city: 'Newcastle', state: 'Tyne and Wear', zips: ['NE1 1AA', 'NE2 2BB', 'NE3 3CC'] },
  { city: 'Nottingham', state: 'Nottinghamshire', zips: ['NG1 1AA', 'NG2 2BB', 'NG3 3CC'] },
];

const EMPLOYERS = [
  'Tesco', 'NHS', 'Barclays', 'BBC', 'BT Group', 'Unilever',
  'Amazon', 'Google', 'Microsoft', 'Deloitte', 'HSBC', 'Sainsburys',
  'Rolls-Royce', 'BAE Systems', 'GlaxoSmithKline', 'AstraZeneca',
  'BP', 'Shell', 'Vodafone', 'Sky', 'Accenture', 'PwC', 'EY', 'KPMG',
];

const JOB_TITLES = [
  'Software Engineer', 'Project Manager', 'Data Analyst', 'Accountant',
  'Marketing Manager', 'Sales Executive', 'Teacher', 'Nurse',
  'Civil Engineer', 'Architect', 'Solicitor', 'Consultant',
  'Operations Manager', 'HR Coordinator', 'Financial Analyst',
  'Researcher', 'Designer', 'Business Analyst', 'DevOps Engineer',
];

/** Generate synthetic profiles for data dilution. */
export function generateSyntheticProfiles(
  realProfile: Partial<Record<QIField, string>>,
  config: DilutionConfig
): SyntheticProfile[] {
  const profiles: SyntheticProfile[] = [];
  const locations = config.country === 'US' ? US_LOCATIONS : UK_LOCATIONS;

  for (let i = 0; i < config.count; i++) {
    const fields: Partial<Record<QIField, string>> = {};
    const anchors: QIField[] = [];
    const randomised: QIField[] = [];

    // copy anchor fields from real profile
    for (const anchor of config.anchorFields) {
      if (realProfile[anchor]) {
        fields[anchor] = realProfile[anchor];
        anchors.push(anchor);
      }
    }

    // generate consistent location data
    const loc = locations[i % locations.length];
    if (!anchors.includes('city')) {
      fields.city = loc.city;
      randomised.push('city');
    }
    if (!anchors.includes('state')) {
      fields.state = loc.state;
      randomised.push('state');
    }
    if (!anchors.includes('zip')) {
      fields.zip = loc.zips[i % loc.zips.length];
      randomised.push('zip');
    }

    // generate other fields
    if (!anchors.includes('email') && realProfile.first_name && realProfile.last_name) {
      const name = (realProfile.first_name ?? 'user').toLowerCase();
      const domain = pickBySeed(['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com'], i);
      fields.email = `${name}.${loc.city.toLowerCase()}${i}@${domain}`;
      randomised.push('email');
    }

    if (!anchors.includes('phone')) {
      fields.phone = generatePhone(config.country, i);
      randomised.push('phone');
    }

    if (!anchors.includes('employer')) {
      fields.employer = EMPLOYERS[i % EMPLOYERS.length];
      randomised.push('employer');
    }

    if (!anchors.includes('job_title')) {
      fields.job_title = JOB_TITLES[i % JOB_TITLES.length];
      randomised.push('job_title');
    }

    if (!anchors.includes('birth_year') && realProfile.birth_year) {
      // vary birth year ±5 years for plausibility
      const baseYear = parseInt(realProfile.birth_year);
      if (!isNaN(baseYear)) {
        fields.birth_year = String(baseYear + ((i % 11) - 5));
        randomised.push('birth_year');
      }
    }

    // plausibility: higher when more fields are consistent
    // lower when anchor set is too large (looks like a copy)
    const plausibility = Math.max(0.3, 1 - anchors.length * 0.1);

    profiles.push({ fields, anchors, randomised, plausibility });
  }

  return profiles;
}

/** Compute the k-anonymity achieved by dilution.
 *  k = 1 (real) + count(synthetic profiles sharing anchor values). */
export function dilutionKAnonymity(
  realProfile: Partial<Record<QIField, string>>,
  syntheticProfiles: SyntheticProfile[]
): number {
  let matching = 0;
  for (const sp of syntheticProfiles) {
    // a synthetic profile contributes to k-anonymity if all anchor fields match
    let allMatch = true;
    for (const anchor of sp.anchors) {
      if (sp.fields[anchor] !== realProfile[anchor]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) matching++;
  }
  return 1 + matching; // +1 for the real profile
}

/** Compute the entropy increase from dilution.
 *  ΔH = log₂(k_after) - log₂(k_before)
 *  where k_before = 1 (uniquely identified) */
export function dilutionEntropyGain(kBefore: number, kAfter: number): number {
  if (kBefore <= 0 || kAfter <= 0) return 0;
  return Math.log2(kAfter) - Math.log2(kBefore);
}

/** Generate a plausible phone number deterministically from seed. */
function generatePhone(country: string, seed: number): string {
  // LCG to spread seeds across the number space
  const h = ((seed + 1) * 2654435761) >>> 0; // Knuth multiplicative hash
  if (country === 'UK') {
    // UK mobile: +44 7XXX XXXXXX (11 digits after +44)
    const n = 7000000000 + (h % 999999999);
    const s = String(n);
    return `+44 ${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7)}`;
  }
  // US: +1 XXX-XXX-XXXX
  const area = 200 + (h % 800); // valid US area codes start at 200
  const exch = 200 + ((h >>> 10) % 800);
  const sub = (h >>> 20) % 10000;
  return `+1 ${area}-${String(exch).padStart(3, '0')}-${String(sub).padStart(4, '0')}`;
}

/** Deterministic pick from array by seed. No Math.random(). */
function pickBySeed<T>(arr: T[], seed: number): T {
  return arr[((seed * 2654435761) >>> 0) % arr.length];
}
