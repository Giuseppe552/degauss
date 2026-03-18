/**
 * Account verification and false positive detection.
 *
 * After username enumeration finds accounts, this module verifies
 * each one by fetching the page content and checking if the target's
 * actual name/identity appears. This eliminates false positives
 * (platforms that return 200 for non-existent users, or accounts
 * belonging to someone else with the same handle).
 *
 * Verification levels:
 *   CONFIRMED — target name found on the page
 *   LIKELY    — username matches and page has content, but name not found
 *   FALSE_POS — page is empty, redirect, or belongs to different person
 *   UNKNOWN   — couldn't fetch or parse the page
 */

import type { UsernameResult } from './username.js';

export type VerifyStatus = 'confirmed' | 'likely' | 'false_positive' | 'unknown';

/** A verified account result */
export interface VerifiedAccount {
  platform: string;
  category: string;
  url: string;
  /** verification status */
  status: VerifyStatus;
  /** confidence 0-1 */
  confidence: number;
  /** what was found on the page */
  foundName: boolean;
  foundBio: boolean;
  pageTitle: string;
  /** what action to take */
  action: AccountAction;
}

export type AccountAction =
  | { type: 'delete'; url: string; instructions: string }
  | { type: 'privatise'; url: string; instructions: string }
  | { type: 'ignore'; reason: string }
  | { type: 'investigate'; reason: string };

/** Platform-specific deletion/privacy settings URLs */
const ACCOUNT_ACTIONS: Record<string, { deleteUrl: string; privacyUrl: string; deleteInstructions: string; privacyInstructions: string }> = {
  'GitHub': {
    deleteUrl: 'https://github.com/settings/admin',
    privacyUrl: 'https://github.com/settings/profile',
    deleteInstructions: 'Settings → Account → Delete your account',
    privacyInstructions: 'Settings → Profile → remove name/bio/location. Emails → uncheck "visible"',
  },
  'Twitter/X': {
    deleteUrl: 'https://twitter.com/settings/deactivate',
    privacyUrl: 'https://twitter.com/settings/privacy_and_safety',
    deleteInstructions: 'Settings → Your Account → Deactivate → wait 30 days',
    privacyInstructions: 'Settings → Privacy → Protect your posts. Remove location/bio.',
  },
  'Instagram': {
    deleteUrl: 'https://www.instagram.com/accounts/remove/request/permanent/',
    privacyUrl: 'https://www.instagram.com/accounts/privacy_and_security/',
    deleteInstructions: 'Settings → Account → Delete account → confirm',
    privacyInstructions: 'Settings → Privacy → Private account toggle. Remove bio/photo.',
  },
  'LinkedIn': {
    deleteUrl: 'https://www.linkedin.com/help/linkedin/answer/a1339364',
    privacyUrl: 'https://www.linkedin.com/public-profile/settings',
    deleteInstructions: 'Settings → Account preferences → Close account',
    privacyInstructions: 'Settings → Visibility → Edit public profile → toggle off all fields',
  },
  'Reddit': {
    deleteUrl: 'https://www.reddit.com/settings/account',
    privacyUrl: 'https://www.reddit.com/settings/privacy',
    deleteInstructions: 'Settings → Account → Delete account (irreversible, posts remain)',
    privacyInstructions: 'Clear post/comment history. Settings → Profile → hide from search.',
  },
  'TikTok': {
    deleteUrl: 'https://www.tiktok.com/setting?enterMethod=by_url',
    privacyUrl: 'https://www.tiktok.com/setting?enterMethod=by_url',
    deleteInstructions: 'Settings → Manage account → Delete account → wait 30 days',
    privacyInstructions: 'Settings → Privacy → Private account toggle.',
  },
  'Steam': {
    deleteUrl: 'https://help.steampowered.com/en/wizard/HelpDeleteAccount',
    privacyUrl: 'https://steamcommunity.com/my/edit/settings',
    deleteInstructions: 'Help → Account → Delete my account → verify email → 30-day wait',
    privacyInstructions: 'Edit Profile → Privacy Settings → set everything to Private',
  },
  'YouTube': {
    deleteUrl: 'https://myaccount.google.com/delete-services-or-account',
    privacyUrl: 'https://www.youtube.com/account_privacy',
    deleteInstructions: 'Settings → Channel → Advanced → Delete channel (keeps Google account)',
    privacyInstructions: 'Settings → Privacy → uncheck all. Set videos to Private.',
  },
  'Pinterest': {
    deleteUrl: 'https://www.pinterest.com/settings/privacy',
    privacyUrl: 'https://www.pinterest.com/settings/privacy',
    deleteInstructions: 'Settings → Account management → Deactivate or Delete → confirm',
    privacyInstructions: 'Settings → Privacy → hide from search engines. Remove boards.',
  },
  'Medium': {
    deleteUrl: 'https://medium.com/me/settings/security',
    privacyUrl: 'https://medium.com/me/settings',
    deleteInstructions: 'Settings → Security → Delete account',
    privacyInstructions: 'Settings → Edit profile → remove name/bio/photo',
  },
  'Twitch': {
    deleteUrl: 'https://www.twitch.tv/settings/security',
    privacyUrl: 'https://www.twitch.tv/settings/security',
    deleteInstructions: 'Settings → Disable account → confirm',
    privacyInstructions: 'Settings → Profile → remove bio/display name. Security → enable 2FA.',
  },
  'SoundCloud': {
    deleteUrl: 'https://soundcloud.com/settings/account',
    privacyUrl: 'https://soundcloud.com/settings/account',
    deleteInstructions: 'Settings → Account → Delete account',
    privacyInstructions: 'Settings → Privacy → make tracks private. Remove display name.',
  },
};

/** Verify a single account by fetching the page and checking content. */
export async function verifyAccount(
  result: UsernameResult,
  targetName: string,
  fetchFn: typeof fetch = globalThis.fetch,
  timeoutMs: number = 10000
): Promise<VerifiedAccount> {
  const nameParts = targetName.toLowerCase().split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts[nameParts.length - 1] ?? '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchFn(result.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // redirected away = probably doesn't exist
    if (response.redirected && !response.url.includes(result.url.split('/').pop() ?? '')) {
      return makeResult(result, 'false_positive', 0.1, false, false, '', ignoreAction('redirect — account may not exist'));
    }

    const html = await response.text();

    // check for common "not found" signals in the HTML
    const lowerHtml = html.toLowerCase();
    const notFoundSignals = ['page not found', 'user not found', 'this account doesn', 'doesn\'t exist', 'has been suspended', 'has been banned', '404'];
    for (const signal of notFoundSignals) {
      if (lowerHtml.includes(signal)) {
        return makeResult(result, 'false_positive', 0.15, false, false, extractTitle(html), ignoreAction('page contains "not found" signal'));
      }
    }

    // check if the target name appears anywhere — body, title, meta tags, og tags
    // also check the username itself in the title (GitHub: "Giuseppe552 (Giuseppe Giona)")
    const foundFirst = firstName.length > 2 && lowerHtml.includes(firstName);
    const foundLast = lastName.length > 2 && lowerHtml.includes(lastName);
    const foundFull = foundFirst && foundLast;
    // check if the URL's username appears in the title — strong signal even without name
    const urlUsername = result.url.split('/').pop()?.toLowerCase() ?? '';
    const usernameInTitle = urlUsername.length > 2 && extractTitle(html).toLowerCase().includes(urlUsername);

    // extract page title
    const pageTitle = extractTitle(html);

    // determine action
    const platformActions = ACCOUNT_ACTIONS[result.platform];
    let action: AccountAction;

    if (foundFull) {
      // name confirmed — recommend action based on platform
      if (platformActions) {
        action = { type: 'delete', url: platformActions.deleteUrl, instructions: platformActions.deleteInstructions };
      } else {
        action = { type: 'investigate', reason: 'Account confirmed as yours. Find account deletion in settings.' };
      }
      return makeResult(result, 'confirmed', 0.95, true, false, pageTitle, action);
    }

    if (foundFirst || foundLast) {
      if (platformActions) {
        action = { type: 'privatise', url: platformActions.privacyUrl, instructions: platformActions.privacyInstructions };
      } else {
        action = { type: 'investigate', reason: 'Partial name match. Check if this is your account.' };
      }
      return makeResult(result, 'likely', 0.6, foundFirst || foundLast, false, pageTitle, action);
    }

    // username found in page title — the page is FOR this username, even if
    // the real name isn't visible (e.g., GitHub "Giuseppe552" without display name set)
    if (usernameInTitle && html.length > 1000) {
      if (platformActions) {
        action = { type: 'privatise', url: platformActions.privacyUrl, instructions: platformActions.privacyInstructions };
      } else {
        action = { type: 'investigate', reason: 'Account exists with your username. Check if this is yours.' };
      }
      return makeResult(result, 'likely', 0.55, false, false, pageTitle, action);
    }

    // page exists but name not found — could be someone else's account
    if (html.length > 1000) {
      return makeResult(result, 'likely', 0.4, false, false, pageTitle,
        { type: 'investigate', reason: 'Account exists with this handle but your name wasn\'t found. May belong to someone else.' });
    }

    return makeResult(result, 'false_positive', 0.2, false, false, pageTitle,
      ignoreAction('page exists but appears empty or unrelated'));

  } catch (err: any) {
    return makeResult(result, 'unknown', 0, false, false, '',
      { type: 'investigate', reason: `Could not verify: ${err.message}` });
  }
}

/** Verify all found accounts from a username enumeration. */
export async function verifyAllAccounts(
  results: UsernameResult[],
  targetName: string,
  fetchFn?: typeof fetch,
  concurrency: number = 3
): Promise<VerifiedAccount[]> {
  const found = results.filter(r => r.exists);
  const verified: VerifiedAccount[] = [];

  for (let i = 0; i < found.length; i += concurrency) {
    const batch = found.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(r => verifyAccount(r, targetName, fetchFn))
    );
    verified.push(...batchResults);
  }

  return verified.sort((a, b) => b.confidence - a.confidence);
}

/** Generate a remediation plan from verified accounts. */
export function buildRemediationPlan(verified: VerifiedAccount[]): {
  toDelete: VerifiedAccount[];
  toPrivatise: VerifiedAccount[];
  toInvestigate: VerifiedAccount[];
  falsePositives: VerifiedAccount[];
  estimatedTimeMinutes: number;
} {
  const toDelete = verified.filter(v => v.action.type === 'delete');
  const toPrivatise = verified.filter(v => v.action.type === 'privatise');
  const toInvestigate = verified.filter(v => v.action.type === 'investigate');
  const falsePositives = verified.filter(v => v.status === 'false_positive');

  // estimate: 3 min per delete, 2 min per privatise, 5 min per investigate
  const estimatedTimeMinutes = toDelete.length * 3 + toPrivatise.length * 2 + toInvestigate.length * 5;

  return { toDelete, toPrivatise, toInvestigate, falsePositives, estimatedTimeMinutes };
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim().slice(0, 100) ?? '';
}

function ignoreAction(reason: string): AccountAction {
  return { type: 'ignore', reason };
}

function makeResult(
  r: UsernameResult, status: VerifyStatus, confidence: number,
  foundName: boolean, foundBio: boolean, pageTitle: string, action: AccountAction
): VerifiedAccount {
  return {
    platform: r.platform, category: r.category, url: r.url,
    status, confidence, foundName, foundBio, pageTitle, action,
  };
}
