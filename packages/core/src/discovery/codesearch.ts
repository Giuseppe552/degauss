/**
 * Public code search — find your PII in public repositories.
 *
 * People accidentally commit .env files, git configs with their email,
 * API keys with their name, internal docs with addresses. This module
 * searches GitHub's code search API for your PII in public repos.
 *
 * GitHub Code Search API: no auth needed for basic searches.
 * Rate limit: 10 requests per minute unauthenticated.
 */

/** A code search result — your PII found in a public repo */
export interface CodeSearchResult {
  /** the query that matched */
  query: string;
  /** repository full name (owner/repo) */
  repo: string;
  /** file path within the repo */
  filePath: string;
  /** URL to the file on GitHub */
  htmlUrl: string;
  /** the matching line(s) */
  matchSnippet: string;
  /** what type of leak this likely is */
  leakType: 'email_in_config' | 'name_in_code' | 'credentials' | 'personal_data' | 'unknown';
}

/** Full code search report */
export interface CodeSearchReport {
  queriesRun: string[];
  totalResults: number;
  results: CodeSearchResult[];
  /** repos that contain your PII */
  affectedRepos: string[];
}

/** Classify what type of leak a file path suggests. */
function classifyLeak(filePath: string, query: string): CodeSearchResult['leakType'] {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('.env') || lowerPath.includes('config') || lowerPath.includes('.yml') || lowerPath.includes('.yaml')) {
    return 'email_in_config';
  }
  if (lowerPath.includes('credentials') || lowerPath.includes('secret') || lowerPath.includes('key')) {
    return 'credentials';
  }
  if (query.includes('@')) {
    return 'email_in_config';
  }
  return 'personal_data';
}

/** Parse GitHub code search API response. */
export function parseGitHubSearchResponse(
  data: any,
  query: string
): CodeSearchResult[] {
  if (!data?.items || !Array.isArray(data.items)) return [];

  return data.items.map((item: any) => ({
    query,
    repo: item.repository?.full_name ?? 'unknown',
    filePath: item.path ?? 'unknown',
    htmlUrl: item.html_url ?? '',
    matchSnippet: '', // GitHub API doesn't return snippets without auth
    leakType: classifyLeak(item.path ?? '', query),
  }));
}

/** Search GitHub for a query string in public code.
 *  Rate limited: 10 req/min without auth. */
export async function searchGitHubCode(
  query: string,
  fetchFn: typeof fetch = globalThis.fetch,
  timeoutMs: number = 10000
): Promise<CodeSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.github.com/search/code?q=${encoded}&per_page=10`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'degauss-privacy-tool',
      },
      signal: controller.signal,
    });

    if (response.status === 403 || response.status === 429) {
      return []; // rate limited
    }

    if (!response.ok) return [];

    const data = await response.json();
    return parseGitHubSearchResponse(data, query);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Search for multiple PII strings (email, name, username).
 *  Returns a combined report. */
export async function codeSearchReport(
  queries: string[],
  fetchFn?: typeof fetch
): Promise<CodeSearchReport> {
  const allResults: CodeSearchResult[] = [];
  const queriesRun: string[] = [];

  for (const query of queries) {
    if (!query || query.length < 4) continue; // skip short queries
    queriesRun.push(query);

    const results = await searchGitHubCode(query, fetchFn);
    allResults.push(...results);

    // rate limit: wait 6 seconds between requests (10 req/min)
    if (query !== queries[queries.length - 1]) {
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  const affectedRepos = [...new Set(allResults.map(r => r.repo))];

  return {
    queriesRun,
    totalResults: allResults.length,
    results: allResults,
    affectedRepos,
  };
}
