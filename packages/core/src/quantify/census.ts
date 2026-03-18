/**
 * Population frequency data from US Census and UK ONS.
 *
 * Value-specific frequency lookup for quasi-identifiers.
 * Without this, "Giuseppe Giona" and "John Smith" get the same
 * exposure score — which defeats the entire tool.
 *
 * Sources:
 *   US Census Bureau, "Frequently Occurring Surnames from Census 2010"
 *     data.census.gov — top surnames with population percentages
 *   UK ONS, "Baby Names Statistics" — most popular first names
 *   US SSA, "Beyond the Top 1000 Names" — first name frequencies
 */

/** US surname frequencies from Census 2010 API (PROP100K / 100,000).
 *  Top 10 surnames cover ~4.9% of the US population.
 *  Source: api.census.gov/data/2010/surname, census.gov/topics/population/genealogy */
const US_SURNAMES: Record<string, number> = {
  smith: 0.00828, johnson: 0.00655, williams: 0.00551, brown: 0.00487,
  jones: 0.00483, garcia: 0.00395, miller: 0.00394, davis: 0.00378,
  rodriguez: 0.00371, martinez: 0.00359, hernandez: 0.00354, lopez: 0.00296,
  gonzalez: 0.00285, wilson: 0.00272, anderson: 0.00266, thomas: 0.00256,
  taylor: 0.00255, moore: 0.00246, jackson: 0.00240, martin: 0.00238,
  lee: 0.00235, perez: 0.00231, thompson: 0.00225, white: 0.00224,
  harris: 0.00212, sanchez: 0.00208, clark: 0.00191, ramirez: 0.00189,
  lewis: 0.00180, robinson: 0.00180, walker: 0.00177, young: 0.00164,
  allen: 0.00164, king: 0.00158, wright: 0.00156, scott: 0.00149,
  torres: 0.00148, nguyen: 0.00148, hill: 0.00147, flores: 0.00147,
  green: 0.00146, adams: 0.00145, nelson: 0.00144, baker: 0.00142,
  hall: 0.00138, rivera: 0.00133, campbell: 0.00131, mitchell: 0.00130,
  carter: 0.00128, roberts: 0.00128,
};

/** UK surname frequencies from ONS electoral register data (England & Wales).
 *  Based on ~45.6M people. Top 100 cover ~20% of the population.
 *  Source: ONS 2002 via one-name.org/wiktionary appendix */
const UK_SURNAMES: Record<string, number> = {
  smith: 0.0122, jones: 0.0093, williams: 0.0064, taylor: 0.0053,
  brown: 0.0051, davies: 0.0047, evans: 0.0038, thomas: 0.0035,
  wilson: 0.0034, johnson: 0.0033, roberts: 0.0032, robinson: 0.0029,
  thompson: 0.0029, wright: 0.0028, walker: 0.0028, white: 0.0027,
  edwards: 0.0026, hughes: 0.0025, green: 0.0025, hall: 0.0024,
  lewis: 0.0024, harris: 0.0023, clarke: 0.0023, patel: 0.0023,
  jackson: 0.0022, wood: 0.0022, turner: 0.0021, martin: 0.0021,
  cooper: 0.0021, hill: 0.0021,
};

/** US first name frequencies from SSA (last 100 years of births, 1925-2024).
 *  Values are fraction of all births (male+female combined ≈ 353M).
 *  Caveat: birth frequencies, not living population frequencies.
 *  Living population skews toward recent cohorts (more Liams, fewer Donalds).
 *  Source: ssa.gov/oact/babynames/decades/century.html */
const US_FIRST_NAMES: Record<string, number> = {
  // male — top 30 by SSA century count
  james: 0.01345, robert: 0.01274, john: 0.01277, michael: 0.01232,
  david: 0.01023, william: 0.01024, richard: 0.00726, joseph: 0.00738,
  thomas: 0.00653, charles: 0.00597, christopher: 0.00576, daniel: 0.00569,
  matthew: 0.00453, anthony: 0.00398, mark: 0.00381, donald: 0.00382,
  steven: 0.00363, paul: 0.00365, andrew: 0.00360, joshua: 0.00359,
  kenneth: 0.00347, kevin: 0.00333, brian: 0.00331, george: 0.00355,
  timothy: 0.00303, ronald: 0.00304, edward: 0.00310, jason: 0.00283,
  jeffrey: 0.00276, ryan: 0.00277,
  // female — top 30
  mary: 0.00925, patricia: 0.00445, jennifer: 0.00416, linda: 0.00411,
  barbara: 0.00406, elizabeth: 0.00459, susan: 0.00317, jessica: 0.00296,
  sarah: 0.00284, karen: 0.00279, lisa: 0.00273, nancy: 0.00277,
  betty: 0.00264, margaret: 0.00268, sandra: 0.00247, ashley: 0.00214,
  dorothy: 0.00227, kimberly: 0.00257, emily: 0.00239, donna: 0.00246,
  michelle: 0.00230, carol: 0.00229, amanda: 0.00219, melissa: 0.00213,
  deborah: 0.00210, stephanie: 0.00211, rebecca: 0.00209, sharon: 0.00210,
  laura: 0.00194, cynthia: 0.00200,
  // modern names
  emma: 0.00160, olivia: 0.00155, noah: 0.00150, liam: 0.00145,
  sophia: 0.00140, isabella: 0.00130, mason: 0.00120, ethan: 0.00115,
  alexander: 0.00110, ava: 0.00105, mia: 0.00100, charlotte: 0.00095,
  benjamin: 0.00090, jacob: 0.00088,
  // rare names
  giuseppe: 0.000008, // ~2,800 births over 100 years in US
};

/** UK first name frequencies (approximate from ONS birth registrations) */
const UK_FIRST_NAMES: Record<string, number> = {
  david: 0.0180, john: 0.0175, james: 0.0160, robert: 0.0130,
  michael: 0.0125, william: 0.0120, richard: 0.0100, thomas: 0.0095,
  christopher: 0.0080, daniel: 0.0075, mark: 0.0070, paul: 0.0068,
  andrew: 0.0065, peter: 0.0060, stephen: 0.0055, ian: 0.0050,
  margaret: 0.0085, mary: 0.0080, sarah: 0.0078, elizabeth: 0.0075,
  susan: 0.0065, jennifer: 0.0060, helen: 0.0055, jessica: 0.0050,
  emma: 0.0048, olivia: 0.0045, amelia: 0.0042, isla: 0.0040,
  charlotte: 0.0038, sophie: 0.0035, emily: 0.0033, grace: 0.0030,
  oliver: 0.0055, george: 0.0050, harry: 0.0048, jack: 0.0045,
  noah: 0.0043, leo: 0.0040, muhammad: 0.0038, arthur: 0.0035,
  giuseppe: 0.000008, // very rare in UK
};

/** The long tail: fraction of all surnames that are below rank ~500.
 *  The top 500 surnames cover about 32% of the US population.
 *  The remaining 68% are distributed across ~6M distinct surnames.
 *  Median surname frequency ≈ 0.000001 (1 in 1M). */
const LONG_TAIL_SURNAME_FREQ = 0.000005; // 1 in 200,000

/** Long tail for first names: rarer names */
const LONG_TAIL_FIRST_FREQ = 0.00005; // 1 in 20,000

/** Look up a surname frequency. Falls back to long-tail estimate. */
export function surnameFrequency(name: string, country: string = 'US'): number {
  const normalised = name.toLowerCase().trim();
  const table = country === 'UK' ? UK_SURNAMES : US_SURNAMES;
  return table[normalised] ?? LONG_TAIL_SURNAME_FREQ;
}

/** Look up a first name frequency. Falls back to long-tail estimate. */
export function firstNameFrequency(name: string, country: string = 'US'): number {
  const normalised = name.toLowerCase().trim();
  const table = country === 'UK' ? UK_FIRST_NAMES : US_FIRST_NAMES;
  return table[normalised] ?? LONG_TAIL_FIRST_FREQ;
}

/** Estimate full name frequency as first × last (independence assumption).
 *  This OVERESTIMATES frequency (underestimates exposure) because
 *  first and last names are weakly correlated through ethnicity.
 *  Conservative: overestimate anonymity set is safer than underestimate. */
export function fullNameFrequency(
  fullName: string,
  country: string = 'US'
): number {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    // single name — treat as surname
    return surnameFrequency(parts[0], country);
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  return firstNameFrequency(first, country) * surnameFrequency(last, country);
}

/** US ZIP code population brackets.
 *  ~42,000 ZIPs in the US. Population per ZIP varies from 0 to ~110,000.
 *  Source: Census ZCTA estimates.
 *
 *  Distribution shape:
 *    <100 people:     ~15% of ZIPs (PO boxes, rural)
 *    100-1,000:       ~20%
 *    1,000-10,000:    ~35%
 *    10,000-50,000:   ~25%
 *    50,000+:         ~5%
 *
 *  Mean population per ZIP ≈ 7,900.
 *  Using mean: freq(ZIP) ≈ ZIP_pop / US_pop.
 *  Without per-ZIP data, we use the median: ~4,500 people per ZIP. */
export function zipFrequency(zip: string, country: string = 'US'): number {
  if (country === 'UK') {
    // UK postcodes: ~1.7M postcodes, median ~15 addresses each
    // full postcode (e.g., "M1 1AA") is very identifying
    // outcode only (e.g., "M1") covers ~20,000 people
    const isFullPostcode = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(zip.trim());
    if (isFullPostcode) {
      return 40 / 67_800_000; // ~40 people per full postcode
    }
    return 20_000 / 67_800_000; // ~20k per outcode
  }
  // US: median ZIP pop ≈ 4,500
  return 4_500 / 335_000_000;
}
