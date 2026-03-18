/**
 * Canary tokens for counter-intelligence.
 *
 * Generate unique URLs and email addresses that alert you when someone
 * accesses them. Embed them in your exposed profiles as "contact me"
 * links. When a stalker, investigator, or automated scraper hits the
 * canary, you know someone is researching you.
 *
 * Types of canaries:
 *   - URL canary: unique URL that triggers a webhook when visited
 *   - Email canary: unique email that forwards to you + logs the sender
 *   - DNS canary: unique subdomain that logs the resolver's IP
 *   - Document canary: PDF/DOCX with embedded tracking pixel
 *
 * This module generates the canary identifiers and tracks triggers.
 * The actual webhook/email infrastructure is external (e.g., Canarytokens.org,
 * custom webhook endpoint, or self-hosted).
 *
 * References:
 *   Thinkst Canary, "Canarytokens" — canarytokens.org
 *   Concept: honeytokens / canary values in database security
 */

/** A canary token definition */
export interface CanaryToken {
  /** unique identifier */
  id: string;
  /** what type of canary */
  type: 'url' | 'email' | 'dns' | 'document';
  /** the value to embed in profiles (URL, email address, etc.) */
  value: string;
  /** which broker/profile this canary is planted in */
  plantedIn: string;
  /** when the canary was created */
  createdAt: number;
  /** description for the user */
  description: string;
}

/** A canary trigger event */
export interface CanaryTrigger {
  /** which canary was triggered */
  canaryId: string;
  /** when it was triggered */
  triggeredAt: number;
  /** IP address of the accessor (if available) */
  sourceIp?: string;
  /** User-Agent of the accessor (if available) */
  userAgent?: string;
  /** referrer URL (if available) */
  referrer?: string;
  /** any additional metadata */
  metadata?: Record<string, string>;
}

/** Configuration for canary generation */
export interface CanaryConfig {
  /** base domain for URL canaries (e.g., your-domain.com) */
  urlDomain?: string;
  /** base domain for email canaries (e.g., your-domain.com) */
  emailDomain?: string;
  /** webhook URL to receive trigger notifications */
  webhookUrl?: string;
  /** use canarytokens.org as the backend? */
  useCanarytokens?: boolean;
}

/** Generate a cryptographically random canary ID.
 *  16 bytes = 128 bits of entropy — collision-free for practical purposes. */
function generateCanaryId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a URL canary.
 *  The URL contains a unique token that identifies which profile it came from.
 *  When someone visits it, the webhook fires. */
export function createUrlCanary(
  plantedIn: string,
  config: CanaryConfig
): CanaryToken {
  const id = generateCanaryId();
  const domain = config.urlDomain ?? 'example.com';

  // the URL looks like a normal personal page — not suspicious
  const value = `https://${domain}/contact/${id.slice(0, 12)}`;

  return {
    id,
    type: 'url',
    value,
    plantedIn,
    createdAt: Date.now(),
    description: `URL canary for ${plantedIn} — alerts when visited`,
  };
}

/** Generate an email canary.
 *  A unique email address that forwards to you and logs the sender. */
export function createEmailCanary(
  plantedIn: string,
  config: CanaryConfig
): CanaryToken {
  const id = generateCanaryId();
  const domain = config.emailDomain ?? 'example.com';

  // looks like a normal contact email with a tag
  const tag = id.slice(0, 8);
  const value = `contact+${tag}@${domain}`;

  return {
    id,
    type: 'email',
    value,
    plantedIn,
    createdAt: Date.now(),
    description: `Email canary for ${plantedIn} — logs sender when emailed`,
  };
}

/** Generate a DNS canary.
 *  A unique subdomain that logs the resolver's IP when queried. */
export function createDnsCanary(
  plantedIn: string,
  config: CanaryConfig
): CanaryToken {
  const id = generateCanaryId();
  const domain = config.urlDomain ?? 'example.com';
  const subdomain = id.slice(0, 10);

  return {
    id,
    type: 'dns',
    value: `${subdomain}.${domain}`,
    plantedIn,
    createdAt: Date.now(),
    description: `DNS canary for ${plantedIn} — logs when domain is resolved`,
  };
}

/** Generate a full set of canaries for a broker profile.
 *  Returns one URL + one email canary per broker. */
export function createCanarySet(
  brokerIds: string[],
  config: CanaryConfig
): CanaryToken[] {
  const canaries: CanaryToken[] = [];

  for (const brokerId of brokerIds) {
    canaries.push(createUrlCanary(brokerId, config));
    canaries.push(createEmailCanary(brokerId, config));
  }

  return canaries;
}

/** Compute canary coverage statistics. */
export function canaryStats(canaries: CanaryToken[], triggers: CanaryTrigger[]) {
  const triggersByCanary = new Map<string, CanaryTrigger[]>();
  for (const t of triggers) {
    const list = triggersByCanary.get(t.canaryId) ?? [];
    list.push(t);
    triggersByCanary.set(t.canaryId, list);
  }

  const brokersTrigered = new Set<string>();
  const uniqueIps = new Set<string>();

  for (const canary of canaries) {
    const ts = triggersByCanary.get(canary.id) ?? [];
    if (ts.length > 0) {
      brokersTrigered.add(canary.plantedIn);
      for (const t of ts) {
        if (t.sourceIp) uniqueIps.add(t.sourceIp);
      }
    }
  }

  return {
    totalCanaries: canaries.length,
    totalTriggers: triggers.length,
    brokersTriggered: brokersTrigered.size,
    uniqueSourceIps: uniqueIps.size,
    /** which brokers had canaries accessed — someone is looking at your profile there */
    triggeredBrokers: [...brokersTrigered],
  };
}
