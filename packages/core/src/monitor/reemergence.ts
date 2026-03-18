/**
 * Re-emergence prediction model.
 *
 * Data brokers refresh profiles every 2-4 weeks from public records
 * and partner feeds. After a successful removal, the probability of
 * data reappearing increases over time as brokers re-crawl sources.
 *
 * Models the reappearance as a Markov process:
 *   P(reappear at time t | removed at t=0) = 1 - e^(-λt)
 *
 * where λ depends on:
 *   - the broker's known refresh cycle
 *   - number of upstream data sources for this record
 *   - whether the original data source (public record) still exists
 *
 * References:
 *   InternetPrivacy, "Why Data Broker Re-Listing Happens Every 60-90 Days" (2025)
 *   CPPA, "California DELETE Act Requirements" (2026)
 */

/** Known broker refresh intervals (days). */
const BROKER_REFRESH_DAYS: Record<string, number> = {
  spokeo: 30,
  whitepages: 21,
  beenverified: 28,
  truepeoplesearch: 14,  // aggressive re-crawler
  fastpeoplesearch: 14,
  intelius: 28,
  peoplefinder: 30,
  radaris: 21,
  pipl: 45,
  lexisnexis: 60,        // slower but more persistent
  acxiom: 30,
  experian: 45,
  equifax: 45,
  oracle_data_cloud: 30,
  default: 30,
};

/** Whether a public records source is effectively permanent
 *  (voter roll, property records, court filings) */
const PERMANENT_SOURCES = new Set([
  'voter_roll',
  'property_record',
  'court_filing',
  'business_registration',
  'birth_certificate',
  'marriage_record',
]);

export interface ReemergenceEstimate {
  /** broker name */
  source: string;
  /** refresh cycle in days */
  refreshDays: number;
  /** rate parameter λ (per day) */
  lambda: number;
  /** probability of reappearance at given times */
  probabilities: {
    days30: number;
    days60: number;
    days90: number;
    days180: number;
    days365: number;
  };
  /** recommended re-check interval (days) */
  recheckInterval: number;
  /** is the upstream source permanent (public record)? */
  permanentSource: boolean;
  /** expected days until reappearance (1/λ) */
  expectedDaysUntilReappearance: number;
}

/** Compute re-emergence probability for a specific broker.
 *
 *  The rate λ is derived from the broker's refresh cycle:
 *    λ = ln(2) / (refresh_days × dampening)
 *
 *  dampening accounts for the fact that opt-out suppression lists
 *  are checked during refresh, so reappearance isn't guaranteed
 *  on every refresh cycle. Without California DROP (which mandates
 *  suppression list checks every 45 days), dampening is low (~1.5).
 *  With DROP compliance: dampening increases to ~3.0. */
export function predictReemergence(
  source: string,
  options: {
    /** is the original data still in a public record? */
    publicRecordExists?: boolean;
    /** is this broker registered with California DROP? */
    dropCompliant?: boolean;
    /** number of known upstream data sources */
    upstreamSources?: number;
  } = {}
): ReemergenceEstimate {
  const refreshDays = BROKER_REFRESH_DAYS[source.toLowerCase()]
    ?? BROKER_REFRESH_DAYS.default;

  const publicRecordExists = options.publicRecordExists ?? true;
  const dropCompliant = options.dropCompliant ?? false;
  const upstreamSources = options.upstreamSources ?? 2;

  // base dampening: how much the suppression list slows reappearance
  let dampening = dropCompliant ? 3.0 : 1.5;

  // if the public record doesn't exist, much slower reappearance
  if (!publicRecordExists) dampening *= 3;

  // more upstream sources = faster reappearance (more chances to re-crawl)
  const sourceMultiplier = Math.log2(Math.max(upstreamSources, 1) + 1);
  dampening /= Math.max(sourceMultiplier, 1);

  // λ = ln(2) / (refresh_days × dampening)
  // median time to reappearance = refresh_days × dampening
  const lambda = Math.LN2 / (refreshDays * dampening);

  // P(reappear by time t) = 1 - e^(-λt)
  const prob = (days: number) => 1 - Math.exp(-lambda * days);

  const permanentSource = PERMANENT_SOURCES.has(source.toLowerCase());

  return {
    source,
    refreshDays,
    lambda,
    probabilities: {
      days30: round(prob(30)),
      days60: round(prob(60)),
      days90: round(prob(90)),
      days180: round(prob(180)),
      days365: round(prob(365)),
    },
    // re-check before median expected reappearance
    recheckInterval: Math.max(7, Math.floor(refreshDays * dampening * 0.5)),
    permanentSource,
    expectedDaysUntilReappearance: Math.round(1 / lambda),
  };
}

/** Compute optimal monitoring schedule across all sources.
 *  Returns a sorted list of re-check dates. */
export function monitoringSchedule(
  sources: string[],
  options?: Parameters<typeof predictReemergence>[1]
): Array<{ source: string; recheckDays: number; probability: number }> {
  return sources
    .map(source => {
      const est = predictReemergence(source, options);
      return {
        source,
        recheckDays: est.recheckInterval,
        probability: est.probabilities.days90,
      };
    })
    .sort((a, b) => a.recheckDays - b.recheckDays);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
