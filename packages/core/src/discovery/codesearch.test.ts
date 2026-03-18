import { describe, it, expect } from 'vitest';
import {
  parseGitHubSearchResponse,
  searchGitHubCode,
  codeSearchReport,
} from './codesearch.js';

describe('parseGitHubSearchResponse', () => {
  it('parses valid GitHub API response', () => {
    const data = {
      items: [
        {
          repository: { full_name: 'owner/repo' },
          path: 'config/.env',
          html_url: 'https://github.com/owner/repo/blob/main/config/.env',
        },
        {
          repository: { full_name: 'other/project' },
          path: 'src/utils.ts',
          html_url: 'https://github.com/other/project/blob/main/src/utils.ts',
        },
      ],
    };

    const results = parseGitHubSearchResponse(data, 'test@example.com');
    expect(results.length).toBe(2);
    expect(results[0].repo).toBe('owner/repo');
    expect(results[0].filePath).toBe('config/.env');
    expect(results[0].leakType).toBe('email_in_config');
    expect(results[0].htmlUrl).toContain('github.com');
  });

  it('classifies .env files as email_in_config', () => {
    const data = {
      items: [{ repository: { full_name: 'a/b' }, path: '.env.production', html_url: '' }],
    };
    const results = parseGitHubSearchResponse(data, 'email@test.com');
    expect(results[0].leakType).toBe('email_in_config');
  });

  it('classifies credential files', () => {
    const data = {
      items: [{ repository: { full_name: 'a/b' }, path: 'secrets/credentials.json', html_url: '' }],
    };
    const results = parseGitHubSearchResponse(data, 'query');
    expect(results[0].leakType).toBe('credentials');
  });

  it('classifies email queries in non-config files as email_in_config', () => {
    const data = {
      items: [{ repository: { full_name: 'a/b' }, path: 'src/main.py', html_url: '' }],
    };
    const results = parseGitHubSearchResponse(data, 'user@company.com');
    expect(results[0].leakType).toBe('email_in_config');
  });

  it('returns empty for null/invalid response', () => {
    expect(parseGitHubSearchResponse(null, 'q')).toEqual([]);
    expect(parseGitHubSearchResponse({}, 'q')).toEqual([]);
    expect(parseGitHubSearchResponse({ items: 'not array' }, 'q')).toEqual([]);
  });
});

describe('searchGitHubCode', () => {
  it('returns empty array on 403 (rate limited)', async () => {
    const mockFetch = async () => new Response('', { status: 403 });
    const results = await searchGitHubCode('test', mockFetch as any);
    expect(results).toEqual([]);
  });

  it('returns empty on network error', async () => {
    const mockFetch = async () => { throw new Error('network'); };
    const results = await searchGitHubCode('test', mockFetch as any);
    expect(results).toEqual([]);
  });

  it('parses valid response', async () => {
    const mockFetch = async () => new Response(JSON.stringify({
      items: [
        { repository: { full_name: 'a/b' }, path: '.env', html_url: 'https://github.com/a/b' },
      ],
    }), { status: 200 });

    const results = await searchGitHubCode('test@email.com', mockFetch as any);
    expect(results.length).toBe(1);
    expect(results[0].repo).toBe('a/b');
  });
});

describe('codeSearchReport', () => {
  it('skips short queries', async () => {
    const mockFetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    const report = await codeSearchReport(['ab', 'abc'], mockFetch as any);
    expect(report.queriesRun).toEqual([]); // both too short (<4 chars)
  });

  it('aggregates results from a single query', async () => {
    const mockFetch = async () => new Response(JSON.stringify({
      items: [
        { repository: { full_name: 'a/b' }, path: 'file.ts', html_url: '' },
        { repository: { full_name: 'c/d' }, path: 'other.ts', html_url: '' },
      ],
    }), { status: 200 });

    // single query avoids the 6s rate limit delay
    const report = await codeSearchReport(['test@email.com'], mockFetch as any);
    expect(report.queriesRun.length).toBe(1);
    expect(report.totalResults).toBe(2);
  });

  it('deduplicates affected repos', async () => {
    const mockFetch = async () => new Response(JSON.stringify({
      items: [
        { repository: { full_name: 'same/repo' }, path: 'a.ts', html_url: '' },
        { repository: { full_name: 'same/repo' }, path: 'b.ts', html_url: '' },
      ],
    }), { status: 200 });

    const report = await codeSearchReport(['query1234'], mockFetch as any);
    expect(report.affectedRepos.length).toBe(1);
  });
});
