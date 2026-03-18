/**
 * Social engineering attack feasibility analysis.
 *
 * Given a set of exposed quasi-identifiers, compute which social
 * engineering attacks become feasible. This turns abstract "bits of
 * exposure" into concrete "here's how you get owned."
 *
 * Each attack has:
 *   - Required QIs (what the attacker needs to know)
 *   - Feasibility score (0-1, based on how many required QIs are exposed)
 *   - Impact (what the attacker can do if the attack succeeds)
 *   - Mitigation (what the user should do to prevent it)
 */

import type { QIField } from '../quantify/types.js';

/** A social engineering attack scenario */
export interface AttackScenario {
  /** short identifier */
  id: string;
  /** human-readable name */
  name: string;
  /** what the attacker does */
  description: string;
  /** which QIs are required for the attack */
  requiredQIs: QIField[];
  /** which additional QIs make the attack more convincing */
  enhancingQIs: QIField[];
  /** feasibility score (0-1) based on exposed QIs */
  feasibility: number;
  /** impact severity: low, medium, high, critical */
  impact: 'low' | 'medium' | 'high' | 'critical';
  /** what the attacker gains if successful */
  outcome: string;
  /** what the user should do */
  mitigation: string;
}

/** Known attack scenarios and their QI requirements */
const ATTACK_TEMPLATES: Array<Omit<AttackScenario, 'feasibility'>> = [
  {
    id: 'bank_phone_takeover',
    name: 'Bank account phone takeover',
    description: 'Attacker calls your bank, passes identity verification using your DOB + address + last 4 SSN, then changes the phone number on your account.',
    requiredQIs: ['full_name', 'dob', 'address'],
    enhancingQIs: ['ssn_last4', 'phone', 'email'],
    impact: 'critical',
    outcome: 'Full access to bank account. Can reset password, transfer funds, order new cards.',
    mitigation: 'Set a verbal PIN with your bank. Enable 2FA with authenticator app, not SMS. Freeze credit with all 3 bureaus.',
  },
  {
    id: 'sim_swap',
    name: 'SIM swap attack',
    description: 'Attacker contacts your mobile carrier, impersonates you using your name + DOB + address, requests a SIM transfer to their device.',
    requiredQIs: ['full_name', 'phone', 'dob'],
    enhancingQIs: ['address', 'ssn_last4'],
    impact: 'critical',
    outcome: 'Attacker receives your calls and SMS. Can intercept 2FA codes, reset any account with SMS recovery.',
    mitigation: 'Set a carrier PIN/passphrase. Use authenticator apps instead of SMS 2FA. Port freeze your number.',
  },
  {
    id: 'spear_phish_employer',
    name: 'Spear phishing via employer context',
    description: 'Attacker sends a targeted email impersonating your employer or a colleague, using your real employer name and job title for credibility.',
    requiredQIs: ['full_name', 'email', 'employer'],
    enhancingQIs: ['job_title', 'city'],
    impact: 'high',
    outcome: 'Credential theft, malware installation, or financial fraud (fake invoice from "your company").',
    mitigation: 'Verify unexpected emails from colleagues via a different channel. Enable email authentication (DMARC) on your domain.',
  },
  {
    id: 'physical_stalking',
    name: 'Physical location tracking',
    description: 'Attacker uses your exposed address to locate you physically. Combined with employer and daily routine patterns.',
    requiredQIs: ['full_name', 'address'],
    enhancingQIs: ['employer', 'city', 'phone'],
    impact: 'critical',
    outcome: 'Physical surveillance, harassment, burglary timing (knows when you\'re at work).',
    mitigation: 'Remove address from all data brokers. Use a PO Box for public records. Vary your routine.',
  },
  {
    id: 'credential_stuffing',
    name: 'Credential stuffing from breaches',
    description: 'Attacker uses your breached email + password combinations to log into other services where you reused the password.',
    requiredQIs: ['email'],
    enhancingQIs: ['username'],
    impact: 'high',
    outcome: 'Account takeover on any service where the password was reused.',
    mitigation: 'Use a unique password per service. Enable 2FA on all accounts. Check haveibeenpwned.com.',
  },
  {
    id: 'tax_fraud',
    name: 'Tax return identity theft',
    description: 'Attacker files a fraudulent tax return in your name using your SSN, DOB, and address, claiming a refund.',
    requiredQIs: ['full_name', 'dob', 'address'],
    enhancingQIs: ['ssn_last4', 'employer'],
    impact: 'critical',
    outcome: 'IRS refund stolen. Your legitimate return gets rejected. Months of resolution.',
    mitigation: 'File taxes early. Get an IRS Identity Protection PIN. Freeze credit reports.',
  },
  {
    id: 'medical_identity_theft',
    name: 'Medical identity fraud',
    description: 'Attacker uses your PII to obtain medical services or prescriptions in your name.',
    requiredQIs: ['full_name', 'dob'],
    enhancingQIs: ['address', 'ssn_last4'],
    impact: 'high',
    outcome: 'False medical records under your name. Insurance claims. Could affect your own medical care.',
    mitigation: 'Monitor your explanation of benefits (EOB) statements. Request your medical records annually.',
  },
  {
    id: 'doxxing',
    name: 'Doxxing and online harassment',
    description: 'Attacker publishes your home address, phone number, and employer online to incite harassment.',
    requiredQIs: ['full_name', 'address', 'phone'],
    enhancingQIs: ['email', 'employer', 'photo'],
    impact: 'high',
    outcome: 'Harassment campaigns, swatting, unwanted deliveries, employer pressure.',
    mitigation: 'Remove address and phone from all public sources. Use Google\'s personal info removal tool.',
  },
  {
    id: 'pretexting_utility',
    name: 'Utility account pretexting',
    description: 'Attacker calls your utility company (power, gas, water) using your address and name to access or modify your account.',
    requiredQIs: ['full_name', 'address'],
    enhancingQIs: ['phone', 'dob'],
    impact: 'medium',
    outcome: 'Service disruption, account changes, access to payment info.',
    mitigation: 'Set account PINs with all utility providers.',
  },
  {
    id: 'synthetic_identity',
    name: 'Synthetic identity fraud',
    description: 'Attacker combines your real SSN with a fake name/DOB to create a synthetic identity for credit applications.',
    requiredQIs: ['ssn_last4'],
    enhancingQIs: ['full_name', 'dob', 'address'],
    impact: 'high',
    outcome: 'Credit lines opened under a synthetic identity linked to your SSN. Damages your credit.',
    mitigation: 'Freeze credit with all 3 bureaus. Monitor your credit report monthly.',
  },
  {
    id: 'password_reset_social',
    name: 'Password reset via customer support',
    description: 'Attacker contacts a service\'s support team, answers security questions using your exposed PII (city, DOB, mother\'s name).',
    requiredQIs: ['full_name', 'email', 'dob'],
    enhancingQIs: ['city', 'phone', 'zip'],
    impact: 'high',
    outcome: 'Account takeover on services with weak identity verification.',
    mitigation: 'Use random answers for security questions (store in password manager). Enable 2FA everywhere.',
  },
];

/** Compute the feasibility of each attack given exposed QI fields. */
export function analyseAttackSurface(
  exposedFields: QIField[]
): AttackScenario[] {
  const exposed = new Set(exposedFields);

  return ATTACK_TEMPLATES.map(template => {
    // count how many required QIs are exposed
    const requiredMet = template.requiredQIs.filter(q => exposed.has(q)).length;
    const requiredTotal = template.requiredQIs.length;

    // count enhancing QIs
    const enhancingMet = template.enhancingQIs.filter(q => exposed.has(q)).length;
    const enhancingTotal = template.enhancingQIs.length;

    // feasibility: 0 if any required QI is missing, otherwise
    // base = requiredMet/requiredTotal, bonus from enhancing QIs
    let feasibility: number;
    if (requiredMet < requiredTotal) {
      // partial: feasibility scales with how many required QIs are present
      feasibility = (requiredMet / requiredTotal) * 0.5;
    } else {
      // all required met: base 0.7, up to 1.0 with enhancing QIs
      const enhancingBonus = enhancingTotal > 0
        ? (enhancingMet / enhancingTotal) * 0.3
        : 0;
      feasibility = 0.7 + enhancingBonus;
    }

    return {
      ...template,
      feasibility: Math.round(feasibility * 100) / 100,
    };
  }).sort((a, b) => {
    // sort by feasibility descending, then by impact severity
    if (b.feasibility !== a.feasibility) return b.feasibility - a.feasibility;
    const impactOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    return impactOrder[b.impact] - impactOrder[a.impact];
  });
}

/** Summary statistics */
export function attackSummary(scenarios: AttackScenario[]) {
  const feasible = scenarios.filter(s => s.feasibility >= 0.7);
  const critical = feasible.filter(s => s.impact === 'critical');
  const partial = scenarios.filter(s => s.feasibility > 0 && s.feasibility < 0.7);

  return {
    totalScenarios: scenarios.length,
    fullyFeasible: feasible.length,
    criticalFeasible: critical.length,
    partiallyFeasible: partial.length,
    topThreats: feasible.slice(0, 3).map(s => ({
      name: s.name,
      feasibility: s.feasibility,
      impact: s.impact,
    })),
  };
}
