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

/** US surname frequencies from Census 2010.
 *  Percentage of total US population.
 *  Top 20 surnames cover ~10% of the population.
 *  Source: census.gov/topics/population/genealogy/data/2010_surnames.html */
const US_SURNAMES: Record<string, number> = {
  smith: 0.00881, johnson: 0.00687, williams: 0.00570, brown: 0.00541,
  jones: 0.00508, garcia: 0.00469, miller: 0.00424, davis: 0.00398,
  rodriguez: 0.00376, martinez: 0.00361, hernandez: 0.00339, lopez: 0.00312,
  gonzalez: 0.00304, wilson: 0.00297, anderson: 0.00292, thomas: 0.00282,
  taylor: 0.00278, moore: 0.00264, jackson: 0.00262, martin: 0.00260,
  lee: 0.00255, perez: 0.00252, thompson: 0.00245, white: 0.00241,
  harris: 0.00233, sanchez: 0.00223, clark: 0.00218, ramirez: 0.00214,
  lewis: 0.00206, robinson: 0.00202, walker: 0.00201, young: 0.00196,
  allen: 0.00189, king: 0.00187, wright: 0.00183, scott: 0.00179,
  torres: 0.00178, nguyen: 0.00176, hill: 0.00175, flores: 0.00173,
  green: 0.00171, adams: 0.00163, nelson: 0.00161, baker: 0.00158,
  hall: 0.00155, rivera: 0.00153, campbell: 0.00150, mitchell: 0.00148,
  carter: 0.00146, roberts: 0.00143,
};

/** UK surname frequencies (approximate, from ONS and genealogy studies).
 *  Percentages of UK population.
 *  Jones/Smith/Williams dominate heavily in England & Wales. */
const UK_SURNAMES: Record<string, number> = {
  smith: 0.0121, jones: 0.0099, williams: 0.0072, taylor: 0.0065,
  brown: 0.0058, davies: 0.0055, evans: 0.0047, wilson: 0.0044,
  thomas: 0.0043, johnson: 0.0037, roberts: 0.0036, robinson: 0.0033,
  thompson: 0.0032, wright: 0.0031, walker: 0.0030, white: 0.0029,
  edwards: 0.0028, hughes: 0.0027, green: 0.0026, hall: 0.0025,
  lewis: 0.0024, harris: 0.0024, clarke: 0.0023, patel: 0.0022,
  jackson: 0.0021, wood: 0.0020, turner: 0.0019, martin: 0.0019,
  cooper: 0.0018, hill: 0.0018,
};

/** US first name frequencies (combined male+female, approximate).
 *  Based on SSA data — fraction of all births in recent decades.
 *  Caveat: these are birth frequencies, not current population frequencies.
 *  Current population has a mix of naming cohorts. */
const US_FIRST_NAMES: Record<string, number> = {
  james: 0.0320, robert: 0.0295, john: 0.0291, michael: 0.0271,
  david: 0.0233, william: 0.0230, richard: 0.0164, joseph: 0.0147,
  thomas: 0.0140, christopher: 0.0120, charles: 0.0119, daniel: 0.0114,
  matthew: 0.0110, anthony: 0.0100, mark: 0.0098, donald: 0.0093,
  steven: 0.0090, paul: 0.0086, andrew: 0.0085, joshua: 0.0081,
  mary: 0.0318, patricia: 0.0151, jennifer: 0.0145, linda: 0.0140,
  barbara: 0.0116, elizabeth: 0.0113, susan: 0.0104, jessica: 0.0097,
  sarah: 0.0088, karen: 0.0086, lisa: 0.0083, nancy: 0.0078,
  betty: 0.0073, margaret: 0.0072, sandra: 0.0068, ashley: 0.0066,
  dorothy: 0.0064, kimberly: 0.0063, emily: 0.0060, donna: 0.0058,
  emma: 0.0055, olivia: 0.0052, noah: 0.0050, liam: 0.0048,
  sophia: 0.0047, isabella: 0.0044, mason: 0.0042, ethan: 0.0040,
  alexander: 0.0038, ava: 0.0037, mia: 0.0035, charlotte: 0.0033,
  benjamin: 0.0032, jacob: 0.0031, giuseppe: 0.000015, // rare in US
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
