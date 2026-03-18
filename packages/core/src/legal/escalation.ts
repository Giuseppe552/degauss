/**
 * Regulatory escalation — complaint generation.
 *
 * When a removal request goes unanswered past the legal deadline,
 * generate a formal complaint to the relevant data protection authority.
 *
 * Supported regulators:
 *   - ICO (UK Information Commissioner's Office)
 *   - CPPA (California Privacy Protection Agency)
 *   - EDPB member DPAs (EU — routed to lead supervisory authority)
 *
 * The complaint includes:
 *   - Original request date and method
 *   - Legal basis and deadline
 *   - Evidence of non-compliance (before/after comparison)
 *   - Specific articles violated
 */

import type { Jurisdiction, QIField } from '../quantify/types.js';
import type { RemovalTracker, VerificationResult } from '../monitor/verification.js';

/** A generated escalation complaint */
export interface EscalationComplaint {
  /** which regulator to file with */
  regulator: string;
  /** regulator's complaint submission URL */
  submissionUrl: string;
  /** complaint subject line */
  subject: string;
  /** complaint body */
  body: string;
  /** legal articles violated */
  articlesViolated: string[];
  /** potential penalty */
  penalty: string;
}

/** Generate an escalation complaint for a non-compliant removal. */
export function generateEscalation(
  verification: VerificationResult,
  requesterName: string,
  requesterEmail: string
): EscalationComplaint {
  const { tracker } = verification;

  switch (tracker.jurisdiction) {
    case 'uk_dpa':
      return icoComplaint(verification, requesterName, requesterEmail);
    case 'ccpa':
    case 'state_us':
      return cppaComplaint(verification, requesterName, requesterEmail);
    case 'gdpr':
      return edpbComplaint(verification, requesterName, requesterEmail);
    default:
      return icoComplaint(verification, requesterName, requesterEmail);
  }
}

function formatFields(fields: QIField[]): string {
  return fields.join(', ');
}

function icoComplaint(
  v: VerificationResult,
  name: string,
  email: string
): EscalationComplaint {
  const t = v.tracker;
  const date = new Date().toISOString().split('T')[0];

  const body = `Complaint to the Information Commissioner's Office
Re: Non-compliance with UK GDPR Article 17 Erasure Request

Complainant:
  Name: ${name}
  Email: ${email}

Controller/Data Broker: ${t.source}
${t.url ? `URL: ${t.url}` : ''}

Timeline:
  - Erasure request sent: ${t.requestedAt.split('T')[0]}
  - Legal deadline (30 days, UK GDPR Art 12(3)): ${t.deadlineAt.split('T')[0]}
  - Verification scan: ${t.verifiedAt?.split('T')[0] ?? date}
  - Days since request: ${v.daysSinceRequest}
  - Status: DATA STILL PRESENT

Evidence of Non-Compliance:
  Personal data requested for deletion:
    ${formatFields(t.beforeQIs.map(q => q.field))}

  Data STILL PRESENT after deadline:
    ${formatFields(v.remainingFields)}

  ${v.newFields.length > 0 ? `NEW data added since request:\n    ${formatFields(v.newFields)}` : ''}

Articles Violated:
  - UK GDPR Article 17(1): Right to erasure not honoured
  - UK GDPR Article 12(3): Response deadline exceeded (${v.daysSinceRequest} days vs 30-day requirement)
  ${v.newFields.length > 0 ? '- UK GDPR Article 17(2): Additional data processed despite erasure request' : ''}

I request that the ICO:
  1. Investigate this controller's compliance with UK GDPR Articles 12 and 17
  2. Issue an enforcement notice requiring immediate erasure
  3. Consider an administrative fine under Article 83(5)(b)

${name}
${date}`;

  return {
    regulator: 'Information Commissioner\'s Office (ICO)',
    submissionUrl: 'https://ico.org.uk/make-a-complaint/data-protection-complaints/',
    subject: `UK GDPR Art 17 Non-Compliance — ${t.source}`,
    body,
    articlesViolated: ['UK GDPR Art 17(1)', 'UK GDPR Art 12(3)'],
    penalty: 'Up to GBP 17.5M or 4% of annual worldwide turnover',
  };
}

function cppaComplaint(
  v: VerificationResult,
  name: string,
  email: string
): EscalationComplaint {
  const t = v.tracker;
  const date = new Date().toISOString().split('T')[0];

  const body = `Complaint to the California Privacy Protection Agency
Re: Non-compliance with CCPA Section 1798.105 Deletion Request

Complainant:
  Name: ${name}
  Email: ${email}

Business/Data Broker: ${t.source}
${t.url ? `URL: ${t.url}` : ''}

Timeline:
  - Deletion request sent: ${t.requestedAt.split('T')[0]}
  - Legal deadline (45 days, CCPA §1798.105(b)): ${t.deadlineAt.split('T')[0]}
  - Verification scan: ${t.verifiedAt?.split('T')[0] ?? date}
  - Days since request: ${v.daysSinceRequest}
  - Status: DATA STILL PRESENT

Evidence of Non-Compliance:
  Personal information requested for deletion:
    ${formatFields(t.beforeQIs.map(q => q.field))}

  Data STILL PRESENT after deadline:
    ${formatFields(v.remainingFields)}

Sections Violated:
  - CCPA §1798.105(a): Right to deletion not honoured
  - CCPA §1798.105(b): 45-day response deadline exceeded
  - California Delete Act (SB 362): If registered as a data broker, must process DELETE requests via DROP

Requested Action:
  Investigation and enforcement under CCPA §1798.199.40.
  Penalties: $2,500 per unintentional violation, $7,500 per intentional violation.

${name}
${date}`;

  return {
    regulator: 'California Privacy Protection Agency (CPPA)',
    submissionUrl: 'https://cppa.ca.gov/complaint/',
    subject: `CCPA §1798.105 Non-Compliance — ${t.source}`,
    body,
    articlesViolated: ['CCPA §1798.105(a)', 'CCPA §1798.105(b)'],
    penalty: '$2,500 per unintentional violation, $7,500 per intentional violation',
  };
}

function edpbComplaint(
  v: VerificationResult,
  name: string,
  email: string
): EscalationComplaint {
  const t = v.tracker;
  const date = new Date().toISOString().split('T')[0];

  const body = `Complaint under GDPR Article 77
Re: Non-compliance with GDPR Article 17 Erasure Request

Complainant:
  Name: ${name}
  Email: ${email}

Controller/Data Broker: ${t.source}
${t.url ? `URL: ${t.url}` : ''}

Timeline:
  - Erasure request sent: ${t.requestedAt.split('T')[0]}
  - Legal deadline (30 days, GDPR Art 12(3)): ${t.deadlineAt.split('T')[0]}
  - Verification scan: ${t.verifiedAt?.split('T')[0] ?? date}
  - Days since request: ${v.daysSinceRequest}
  - Status: DATA STILL PRESENT

Evidence:
  Data requested for deletion:
    ${formatFields(t.beforeQIs.map(q => q.field))}

  Data still present:
    ${formatFields(v.remainingFields)}

Articles Violated:
  - GDPR Article 17(1): Right to erasure
  - GDPR Article 12(3): One-month response deadline
  - GDPR Article 17(2): Obligation to inform other controllers

I request investigation and enforcement under GDPR Article 83(5)(b).
Maximum penalty: EUR 20 million or 4% of annual worldwide turnover.

${name}
${date}`;

  return {
    regulator: 'Data Protection Authority (GDPR Art 77)',
    submissionUrl: 'https://edpb.europa.eu/about-edpb/about-edpb/members_en',
    subject: `GDPR Art 17 Non-Compliance — ${t.source}`,
    body,
    articlesViolated: ['GDPR Art 17(1)', 'GDPR Art 12(3)', 'GDPR Art 17(2)'],
    penalty: 'Up to EUR 20M or 4% of annual worldwide turnover (Art 83(5)(b))',
  };
}
