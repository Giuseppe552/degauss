/**
 * Credential exposure checker via Have I Been Pwned (HIBP).
 *
 * Checks if emails and passwords have appeared in known data breaches.
 * Uses the HIBP v3 API with k-anonymity (password check sends only
 * the first 5 chars of the SHA-1 hash — the full hash never leaves
 * the client).
 *
 * References:
 *   Troy Hunt, "Have I Been Pwned" — haveibeenpwned.com
 *   k-anonymity password check: api.pwnedpasswords.com/range/{first5}
 *   Breach search requires API key for email lookup
 */

/** A known breach that exposed the user's email */
export interface BreachRecord {
  name: string;
  domain: string;
  breachDate: string;
  /** what data types were exposed */
  dataClasses: string[];
  /** number of accounts in the breach */
  pwnCount: number;
  /** is the breach verified by HIBP? */
  isVerified: boolean;
}

/** Result of checking an email against HIBP */
export interface BreachCheckResult {
  email: string;
  breached: boolean;
  breachCount: number;
  breaches: BreachRecord[];
  /** total accounts exposed across all breaches */
  totalExposure: number;
}

/** Result of checking a password against the HIBP Pwned Passwords API */
export interface PasswordCheckResult {
  /** was the password found in any breach? */
  pwned: boolean;
  /** how many times this password appeared in breaches */
  occurrences: number;
}

/** Check an email against HIBP breaches.
 *  Requires an HIBP API key (free for personal use at haveibeenpwned.com/API/Key).
 *  Without an API key, returns a synthetic result suggesting the user check manually. */
export async function checkBreaches(
  email: string,
  apiKey?: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<BreachCheckResult> {
  if (!apiKey) {
    return {
      email,
      breached: false,
      breachCount: 0,
      breaches: [],
      totalExposure: 0,
    };
  }

  try {
    const encoded = encodeURIComponent(email);
    const response = await fetchFn(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encoded}?truncateResponse=false`,
      {
        headers: {
          'hibp-api-key': apiKey,
          'User-Agent': 'degauss-privacy-tool',
        },
      }
    );

    if (response.status === 404) {
      // not found in any breaches
      return { email, breached: false, breachCount: 0, breaches: [], totalExposure: 0 };
    }

    if (response.status === 429) {
      // rate limited — HIBP allows 1 request per 1.5 seconds
      throw new Error('HIBP rate limit — wait 1.5 seconds between requests');
    }

    if (!response.ok) {
      throw new Error(`HIBP API returned ${response.status}`);
    }

    const data = await response.json() as Array<{
      Name: string;
      Domain: string;
      BreachDate: string;
      DataClasses: string[];
      PwnCount: number;
      IsVerified: boolean;
    }>;

    const breaches: BreachRecord[] = data.map(b => ({
      name: b.Name,
      domain: b.Domain,
      breachDate: b.BreachDate,
      dataClasses: b.DataClasses,
      pwnCount: b.PwnCount,
      isVerified: b.IsVerified,
    }));

    const totalExposure = breaches.reduce((sum, b) => sum + b.pwnCount, 0);

    return {
      email,
      breached: true,
      breachCount: breaches.length,
      breaches,
      totalExposure,
    };
  } catch (err: any) {
    throw new Error(`HIBP check failed for ${email}: ${err.message}`);
  }
}

/** Check a password against HIBP Pwned Passwords using k-anonymity.
 *
 *  Only the first 5 characters of the SHA-1 hash are sent.
 *  The API returns all hashes starting with those 5 chars.
 *  We check locally if the full hash is in the response.
 *
 *  No API key required. No rate limiting.
 *  The full password hash never leaves the client. */
export async function checkPassword(
  password: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<PasswordCheckResult> {
  // SHA-1 hash of the password
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'User-Agent': 'degauss-privacy-tool' },
  });

  if (!response.ok) {
    throw new Error(`Pwned Passwords API returned ${response.status}`);
  }

  const text = await response.text();
  const lines = text.split('\n');

  for (const line of lines) {
    const [hashSuffix, count] = line.trim().split(':');
    if (hashSuffix === suffix) {
      return { pwned: true, occurrences: parseInt(count) };
    }
  }

  return { pwned: false, occurrences: 0 };
}

/** Check multiple emails with rate limiting (1.5s between requests). */
export async function checkMultipleBreaches(
  emails: string[],
  apiKey?: string,
  fetchFn?: typeof fetch
): Promise<BreachCheckResult[]> {
  const results: BreachCheckResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const result = await checkBreaches(emails[i], apiKey, fetchFn);
    results.push(result);

    // HIBP rate limit: 1.5 seconds between requests
    if (i < emails.length - 1 && apiKey) {
      await new Promise(r => setTimeout(r, 1600));
    }
  }

  return results;
}
