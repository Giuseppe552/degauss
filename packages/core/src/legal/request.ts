/**
 * Legal removal request generation.
 *
 * Generates legally-valid data deletion requests under:
 *   - GDPR Article 17 (EU/EEA) — 30-day response
 *   - UK Data Protection Act 2018 / UK GDPR — 30-day response
 *   - CCPA §1798.105 (California/US) — 45-day response
 *   - DMCA §512(c) (photos, worldwide) — "expeditious" removal
 *
 * Each request cites the specific legal article, includes required
 * identification fields, and sets a compliance deadline.
 *
 * References:
 *   GDPR Art 17: gdpr-info.eu/art-17-gdpr/
 *   CCPA §1798.105: oag.ca.gov/privacy/ccpa
 *   UK DPA 2018 s.47 + UK GDPR Art 17
 *   DMCA 17 U.S.C. §512(c)(3)
 */

import type { Jurisdiction, QIField } from '../quantify/types.js';

export interface RemovalRequest {
  /** which law the request is filed under */
  jurisdiction: Jurisdiction;
  /** the legal basis cited */
  legalBasis: string;
  /** the article/section number */
  article: string;
  /** compliance deadline from date of receipt */
  deadlineDays: number;
  /** penalty for non-compliance */
  penalty: string;
  /** the generated request text */
  body: string;
  /** required: who to send this to (email or postal) */
  recipient: string;
  /** subject line */
  subject: string;
}

export interface RequesterInfo {
  fullName: string;
  email: string;
  /** for identity verification in CCPA requests */
  address?: string;
  /** country of residence — determines primary jurisdiction */
  country: string;
  /** state (US) — determines state-level protections */
  state?: string;
}

/** Generate a removal request for a specific data broker/source. */
export function generateRequest(
  requester: RequesterInfo,
  source: string,
  fieldsToRemove: QIField[],
  sourceUrl?: string,
  recipientEmail?: string
): RemovalRequest {
  const jurisdiction = detectJurisdiction(requester);
  const recipient = recipientEmail ?? `privacy@${source.toLowerCase()}.com`;

  switch (jurisdiction) {
    case 'gdpr':
      return gdprRequest(requester, source, fieldsToRemove, sourceUrl, recipient);
    case 'uk_dpa':
      return ukDpaRequest(requester, source, fieldsToRemove, sourceUrl, recipient);
    case 'ccpa':
      return ccpaRequest(requester, source, fieldsToRemove, sourceUrl, recipient);
    case 'dmca':
      return dmcaRequest(requester, source, sourceUrl, recipient);
    default:
      // fallback: use whichever law gives strongest protection
      return gdprRequest(requester, source, fieldsToRemove, sourceUrl, recipient);
  }
}

/** Generate a DMCA takedown for personal photos. */
export function generateDmcaRequest(
  requester: RequesterInfo,
  source: string,
  photoUrl: string,
  recipientEmail?: string
): RemovalRequest {
  return dmcaRequest(requester, source, photoUrl, recipientEmail ?? `dmca@${source}.com`);
}

function detectJurisdiction(requester: RequesterInfo): Jurisdiction {
  const country = requester.country.toUpperCase();
  if (country === 'UK' || country === 'GB') return 'uk_dpa';
  if (['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'SE',
    'DK', 'FI', 'NO', 'PL', 'CZ', 'RO', 'HU', 'GR', 'BG', 'HR',
    'SK', 'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'LU', 'IS', 'LI'
  ].includes(country)) return 'gdpr';
  if (country === 'US') return 'ccpa';
  return 'gdpr'; // default to GDPR — strongest extraterritorial reach
}

function formatFields(fields: QIField[]): string {
  const labels: Record<string, string> = {
    full_name: 'full name',
    first_name: 'first name',
    last_name: 'last name / surname',
    dob: 'date of birth',
    birth_year: 'year of birth',
    sex: 'gender',
    email: 'email address',
    phone: 'telephone number',
    zip: 'postal/ZIP code',
    city: 'city',
    state: 'state/region',
    country: 'country',
    address: 'physical address',
    employer: 'employer name',
    job_title: 'job title',
    username: 'username/handle',
    ip_address: 'IP address',
    device_id: 'device identifier',
    photo: 'photograph/image',
    ssn_last4: 'partial social security number',
    other: 'other personal data',
  };
  return fields.map(f => labels[f] ?? f).join(', ');
}

function gdprRequest(
  r: RequesterInfo, source: string, fields: QIField[],
  url: string | undefined, recipient: string
): RemovalRequest {
  const date = new Date().toISOString().split('T')[0];
  const body = `Subject Access and Erasure Request under GDPR Article 17

To the Data Protection Officer,

I am writing to exercise my right to erasure under Article 17 of the General Data Protection Regulation (EU) 2016/679.

My details:
  Name: ${r.fullName}
  Email: ${r.email}
  Country of residence: ${r.country}

I request the complete deletion of the following personal data you hold about me:
  ${formatFields(fields)}

${url ? `The data appears at: ${url}\n` : ''}
Legal basis for this request:
  - Article 17(1)(a): the data is no longer necessary for the purpose for which it was collected
  - Article 17(1)(d): the data has been unlawfully processed (I have not consented to its collection or publication)

Under Article 17(2), where you have made this data public, I also request that you take reasonable steps to inform other controllers processing this data of my erasure request.

Under Article 12(3), you must respond to this request without undue delay and in any event within one calendar month of receipt.

Failure to comply may result in a complaint to the relevant supervisory authority and potential penalties of up to EUR 20 million or 4% of annual worldwide turnover under Article 83(5)(b).

${r.fullName}
${date}`;

  return {
    jurisdiction: 'gdpr',
    legalBasis: 'Right to erasure — data no longer necessary / unlawful processing',
    article: 'GDPR Article 17(1)(a)(d), Article 17(2)',
    deadlineDays: 30,
    penalty: 'Up to EUR 20M or 4% of annual worldwide turnover (Art 83(5)(b))',
    body,
    recipient,
    subject: `GDPR Article 17 Erasure Request — ${r.fullName}`,
  };
}

function ukDpaRequest(
  r: RequesterInfo, source: string, fields: QIField[],
  url: string | undefined, recipient: string
): RemovalRequest {
  const date = new Date().toISOString().split('T')[0];
  const body = `Erasure Request under UK GDPR Article 17 / Data Protection Act 2018

To the Data Protection Officer,

I am writing to exercise my right to erasure under Article 17 of the UK GDPR, as supplemented by the Data Protection Act 2018.

My details:
  Name: ${r.fullName}
  Email: ${r.email}
  Country of residence: United Kingdom

I request the complete deletion of the following personal data you hold about me:
  ${formatFields(fields)}

${url ? `The data appears at: ${url}\n` : ''}
Legal basis:
  - UK GDPR Article 17(1)(a): the data is no longer necessary for its original purpose
  - UK GDPR Article 17(1)(d): the data has been unlawfully processed

Under UK GDPR Article 17(2), where you have made this data public, you must take reasonable steps to inform other controllers of my erasure request.

You must respond within one calendar month (UK GDPR Article 12(3)). If you require an extension, you must notify me within the first month with reasons.

Non-compliance may be reported to the Information Commissioner's Office (ICO) and may result in enforcement action.

${r.fullName}
${date}`;

  return {
    jurisdiction: 'uk_dpa',
    legalBasis: 'Right to erasure — UK GDPR Article 17',
    article: 'UK GDPR Art 17(1)(a)(d), DPA 2018 s.47',
    deadlineDays: 30,
    penalty: 'ICO enforcement — up to GBP 17.5M or 4% of annual worldwide turnover',
    body,
    recipient,
    subject: `UK GDPR Article 17 Erasure Request — ${r.fullName}`,
  };
}

function ccpaRequest(
  r: RequesterInfo, source: string, fields: QIField[],
  url: string | undefined, recipient: string
): RemovalRequest {
  const date = new Date().toISOString().split('T')[0];
  const body = `Right to Deletion Request under CCPA Section 1798.105

To whom it may concern,

I am a California consumer exercising my right to deletion under the California Consumer Privacy Act (Cal. Civ. Code Section 1798.105).

My details:
  Name: ${r.fullName}
  Email: ${r.email}
${r.address ? `  Address: ${r.address}\n` : ''}
I request that you delete all personal information you have collected about me, including but not limited to:
  ${formatFields(fields)}

${url ? `The data appears at: ${url}\n` : ''}
Under Section 1798.105(a), a consumer has the right to request deletion of any personal information collected from the consumer by a business. Under Section 1798.105(c), you must delete the consumer's personal information from your records and direct any service providers to delete the consumer's personal information from their records.

You must respond to this request within 45 calendar days (Section 1798.105(b)). If you cannot verify my identity, you must treat this as a request to opt out of the sale/sharing of my personal information under Section 1798.120.

Additionally, under the California Delete Act (SB 362), if you are a registered data broker, you must process this request through the DELETE Request and Opt-Out Platform (DROP).

Non-compliance may result in penalties of $2,500 per unintentional violation or $7,500 per intentional violation.

${r.fullName}
${date}`;

  return {
    jurisdiction: 'ccpa',
    legalBasis: 'Right to deletion — CCPA §1798.105',
    article: 'Cal. Civ. Code §1798.105, SB 362 (Delete Act)',
    deadlineDays: 45,
    penalty: '$2,500 per unintentional violation, $7,500 per intentional violation',
    body,
    recipient,
    subject: `CCPA Deletion Request — ${r.fullName}`,
  };
}

function dmcaRequest(
  r: RequesterInfo, source: string,
  photoUrl: string | undefined, recipient: string
): RemovalRequest {
  const date = new Date().toISOString().split('T')[0];
  const body = `DMCA Takedown Notice under 17 U.S.C. Section 512(c)(3)

To the Designated DMCA Agent,

I am the copyright owner of the photograph(s) identified below and am submitting this takedown notice under the Digital Millennium Copyright Act (17 U.S.C. Section 512(c)(3)).

1. Identification of the copyrighted work:
   Personal photograph(s) of ${r.fullName}, taken by me and owned by me under 17 U.S.C. Section 102.

2. Identification of infringing material:
   ${photoUrl ?? '[URL of the infringing photograph]'}

3. Contact information:
   Name: ${r.fullName}
   Email: ${r.email}

4. Good faith statement:
   I have a good faith belief that use of the copyrighted material described above is not authorized by the copyright owner (myself), its agent, or the law.

5. Accuracy statement:
   I state, under penalty of perjury, that the information in this notification is accurate and that I am the copyright owner of the material that is allegedly being infringed.

6. Signature:
   /s/ ${r.fullName}
   ${date}

Please remove the identified material expeditiously in accordance with 17 U.S.C. Section 512(c)(1)(C). Failure to do so may result in loss of safe harbor protection under Section 512.`;

  return {
    jurisdiction: 'dmca',
    legalBasis: 'Copyright infringement — personal photograph',
    article: '17 U.S.C. §512(c)(3)',
    deadlineDays: 14, // "expeditious" — typically 24-48 hours but legally up to ~2 weeks
    penalty: 'Loss of safe harbor protection (§512(c))',
    body,
    recipient,
    subject: `DMCA Takedown Notice — Copyrighted Photograph`,
  };
}
