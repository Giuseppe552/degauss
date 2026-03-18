import { describe, it, expect } from 'vitest';
import {
  positionWeight,
  classifyResult,
  parseGoogleSerp,
  analyseSerpResults,
} from './serp.js';

describe('positionWeight', () => {
  it('position 1 has weight 1.0', () => {
    expect(positionWeight(1)).toBeCloseTo(1.0, 5);
  });

  it('position 10 has weight ~0.13', () => {
    expect(positionWeight(10)).toBeCloseTo(0.126, 1);
  });

  it('weight decays monotonically', () => {
    for (let i = 1; i < 20; i++) {
      expect(positionWeight(i + 1)).toBeLessThan(positionWeight(i));
    }
  });

  it('position 0 or negative returns 0', () => {
    expect(positionWeight(0)).toBe(0);
    expect(positionWeight(-1)).toBe(0);
  });

  it('position 30 has near-zero weight', () => {
    expect(positionWeight(30)).toBeLessThan(0.005);
  });
});

describe('classifyResult', () => {
  it('classifies Spokeo as data_broker', () => {
    const r = classifyResult('https://www.spokeo.com/Jane-Doe', '', '');
    expect(r.category).toBe('data_broker');
    expect(r.brokerId).toBe('spokeo');
  });

  it('classifies LinkedIn as social_media', () => {
    expect(classifyResult('https://www.linkedin.com/in/jane', '', '').category)
      .toBe('social_media');
  });

  it('classifies BBC as news', () => {
    expect(classifyResult('https://www.bbc.co.uk/article', '', '').category)
      .toBe('news');
  });

  it('classifies .gov as government', () => {
    expect(classifyResult('https://data.gov/record', '', '').category)
      .toBe('government');
  });

  it('classifies archive.org as archive', () => {
    expect(classifyResult('https://web.archive.org/web/2025/https://spokeo.com', '', '').category)
      .toBe('archive');
  });

  it('classifies owned domain when provided', () => {
    const r = classifyResult('https://janedoe.com/about', '', '', ['janedoe.com']);
    expect(r.category).toBe('owned_property');
  });

  it('owned domain takes priority over other classifications', () => {
    // if user owns github.com (unlikely but tests priority)
    const r = classifyResult('https://github.com/jane', '', '', ['github.com']);
    expect(r.category).toBe('owned_property');
  });

  it('unknown domain classified as irrelevant', () => {
    expect(classifyResult('https://random-blog.example.com', '', '').category)
      .toBe('irrelevant');
  });

  it('handles malformed URLs', () => {
    expect(classifyResult('not-a-url', '', '').category).toBe('irrelevant');
  });
});

describe('parseGoogleSerp', () => {
  it('extracts results from Google HTML pattern', () => {
    // the regex requires href and h3 on the same line (no multiline)
    const html = `<a href="/url?q=https://spokeo.com/Jane-Doe&amp;sa=U"><h3 class="r">Jane Doe - Spokeo</h3></a><a href="/url?q=https://linkedin.com/in/janedoe&amp;sa=U"><h3 class="r">Jane Doe - LinkedIn</h3></a>`;
    const results = parseGoogleSerp(html);
    expect(results.length).toBe(2);
    expect(results[0].url).toContain('spokeo.com');
    expect(results[1].url).toContain('linkedin.com');
  });

  it('returns empty for no matches', () => {
    expect(parseGoogleSerp('<html><body>No results</body></html>')).toEqual([]);
  });
});

describe('analyseSerpResults', () => {
  const mockResults = [
    { title: 'Jane Doe - Spokeo', url: 'https://spokeo.com/Jane-Doe', snippet: '' },
    { title: 'Jane Doe - LinkedIn', url: 'https://linkedin.com/in/jane', snippet: '' },
    { title: 'Jane Doe Portfolio', url: 'https://janedoe.com', snippet: '' },
    { title: 'Jane Doe - WhitePages', url: 'https://whitepages.com/name/jane-doe', snippet: '' },
    { title: 'Random article', url: 'https://blog.example.com/post', snippet: '' },
  ];

  it('classifies all results', () => {
    const report = analyseSerpResults('Jane Doe', mockResults, ['janedoe.com']);
    expect(report.totalResults).toBe(5);
    expect(report.categories.data_broker).toBe(2);
    expect(report.categories.social_media).toBe(1);
    expect(report.categories.owned_property).toBe(1);
  });

  it('page1Score only counts threat categories', () => {
    const report = analyseSerpResults('Jane Doe', mockResults, ['janedoe.com']);
    // owned_property and irrelevant have 0 threat weight
    expect(report.page1Score).toBeGreaterThan(0);
  });

  it('identifies page 1 brokers', () => {
    const report = analyseSerpResults('Jane Doe', mockResults);
    expect(report.page1Brokers).toContain('spokeo');
    expect(report.page1Brokers).toContain('whitepages');
  });

  it('identifies owned properties', () => {
    const report = analyseSerpResults('Jane Doe', mockResults, ['janedoe.com']);
    expect(report.ownedProperties).toContain('https://janedoe.com');
  });

  it('page1Score is higher when brokers are at top positions', () => {
    const brokersFirst = [
      { title: '', url: 'https://spokeo.com/x', snippet: '' },
      { title: '', url: 'https://whitepages.com/x', snippet: '' },
    ];
    const brokersLast = [
      { title: '', url: 'https://example.com', snippet: '' },
      { title: '', url: 'https://example2.com', snippet: '' },
      { title: '', url: 'https://example3.com', snippet: '' },
      { title: '', url: 'https://example4.com', snippet: '' },
      { title: '', url: 'https://spokeo.com/x', snippet: '' },
      { title: '', url: 'https://whitepages.com/x', snippet: '' },
    ];

    const reportFirst = analyseSerpResults('x', brokersFirst);
    const reportLast = analyseSerpResults('x', brokersLast);

    expect(reportFirst.page1Score).toBeGreaterThan(reportLast.page1Score);
  });
});
