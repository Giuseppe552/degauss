import { describe, it, expect } from 'vitest';
import {
  SCAN_TARGETS,
  buildSearchUrl,
  extractQIs,
} from './scraper.js';

describe('SCAN_TARGETS', () => {
  it('has at least 5 broker definitions', () => {
    expect(SCAN_TARGETS.length).toBeGreaterThanOrEqual(5);
  });

  it('each target has required fields', () => {
    for (const target of SCAN_TARGETS) {
      expect(target.id).toBeTruthy();
      expect(target.name).toBeTruthy();
      expect(target.searchUrl).toContain('http');
      expect(target.extractors.length).toBeGreaterThan(0);
      expect(target.delayMs).toBeGreaterThan(0);
    }
  });

  it('each target has at least a name extractor', () => {
    for (const target of SCAN_TARGETS) {
      const hasName = target.extractors.some(
        e => e.field === 'full_name' || e.field === 'first_name'
      );
      expect(hasName).toBe(true);
    }
  });
});

describe('buildSearchUrl', () => {
  it('replaces name placeholder', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'truepeoplesearch')!;
    const url = buildSearchUrl(target, { name: 'Jane Doe', city: 'Portland', state: 'OR' });
    expect(url).toContain('Jane');
    expect(url).toContain('Portland');
    expect(url).toContain('OR');
  });

  it('handles missing city/state', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'spokeo')!;
    const url = buildSearchUrl(target, { name: 'Jane Doe' });
    expect(url).toContain('Jane');
  });

  it('fastpeoplesearch uses hyphenated name', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const url = buildSearchUrl(target, { name: 'Jane Doe' });
    expect(url).toContain('Jane-Doe');
  });
});

describe('extractQIs', () => {
  it('extracts name from HTML with card-title class', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const html = '<h2 class="card-title">Jane Doe</h2>';
    const qis = extractQIs(html, target, 'Jane Doe');
    expect(qis.length).toBeGreaterThan(0);
    expect(qis[0].field).toBe('full_name');
    expect(qis[0].value).toBe('Jane Doe');
  });

  it('returns empty for non-matching name', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const html = '<h2 class="card-title">John Smith</h2>';
    const qis = extractQIs(html, target, 'Jane Doe');
    expect(qis.length).toBe(0); // wrong person
  });

  it('extracts phone number', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const html = '<h2 class="card-title">Jane Doe</h2><a href="tel:+15035551234">Call</a>';
    const qis = extractQIs(html, target, 'Jane Doe');
    const phone = qis.find(q => q.field === 'phone');
    expect(phone).toBeDefined();
    expect(phone!.value).toContain('5035551234');
  });

  it('converts age to birth year', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const html = '<h2 class="card-title">Jane Doe</h2><span>Age 35</span>';
    const qis = extractQIs(html, target, 'Jane Doe');
    const year = qis.find(q => q.field === 'birth_year');
    if (year) {
      const expectedYear = new Date().getFullYear() - 35;
      expect(parseInt(year.value)).toBe(expectedYear);
    }
  });

  it('returns empty for no matches in HTML', () => {
    const target = SCAN_TARGETS.find(t => t.id === 'fastpeoplesearch')!;
    const qis = extractQIs('<html><body>Nothing here</body></html>', target, 'Jane Doe');
    expect(qis.length).toBe(0);
  });
});
