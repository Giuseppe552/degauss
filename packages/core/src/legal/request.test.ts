import { describe, it, expect } from 'vitest';
import { generateRequest, generateDmcaRequest } from './request.js';

const ukRequester = {
  fullName: 'Giuseppe Giona',
  email: 'test@example.com',
  country: 'UK',
};

const usRequester = {
  fullName: 'John Doe',
  email: 'john@example.com',
  country: 'US',
  state: 'CA',
  address: '123 Main St, San Francisco, CA 94105',
};

const euRequester = {
  fullName: 'Hans Mueller',
  email: 'hans@example.com',
  country: 'DE',
};

describe('generateRequest', () => {
  it('generates UK DPA request for UK residents', () => {
    const req = generateRequest(ukRequester, 'spokeo', ['full_name', 'email']);
    expect(req.jurisdiction).toBe('uk_dpa');
    expect(req.article).toContain('UK GDPR');
    expect(req.deadlineDays).toBe(30);
    expect(req.body).toContain('Giuseppe Giona');
    expect(req.body).toContain('full name');
    expect(req.body).toContain('email address');
  });

  it('generates CCPA request for US residents', () => {
    const req = generateRequest(usRequester, 'spokeo', ['full_name', 'phone']);
    expect(req.jurisdiction).toBe('ccpa');
    expect(req.article).toContain('1798.105');
    expect(req.deadlineDays).toBe(45);
    expect(req.body).toContain('California Consumer Privacy Act');
  });

  it('generates GDPR request for EU residents', () => {
    const req = generateRequest(euRequester, 'spokeo', ['full_name']);
    expect(req.jurisdiction).toBe('gdpr');
    expect(req.article).toContain('GDPR Article 17');
    expect(req.body).toContain('General Data Protection Regulation');
  });

  it('includes source URL when provided', () => {
    const req = generateRequest(ukRequester, 'spokeo', ['email'],
      'https://spokeo.com/profile/123');
    expect(req.body).toContain('https://spokeo.com/profile/123');
  });

  it('sets correct penalty for each jurisdiction', () => {
    const uk = generateRequest(ukRequester, 'x', ['email']);
    expect(uk.penalty).toContain('GBP');

    const us = generateRequest(usRequester, 'x', ['email']);
    expect(us.penalty).toContain('$2,500');

    const eu = generateRequest(euRequester, 'x', ['email']);
    expect(eu.penalty).toContain('EUR 20');
  });

  it('subject line includes requester name', () => {
    const req = generateRequest(ukRequester, 'spokeo', ['email']);
    expect(req.subject).toContain('Giuseppe Giona');
  });
});

describe('generateDmcaRequest', () => {
  it('generates valid DMCA takedown', () => {
    const req = generateDmcaRequest(ukRequester, 'spokeo',
      'https://spokeo.com/photo/123.jpg');
    expect(req.jurisdiction).toBe('dmca');
    expect(req.article).toContain('512(c)(3)');
    expect(req.body).toContain('penalty of perjury');
    expect(req.body).toContain('copyright owner');
    expect(req.body).toContain('https://spokeo.com/photo/123.jpg');
  });

  it('includes signature', () => {
    const req = generateDmcaRequest(ukRequester, 'spokeo',
      'https://example.com/photo.jpg');
    expect(req.body).toContain('/s/ Giuseppe Giona');
  });

  it('mentions safe harbor loss', () => {
    const req = generateDmcaRequest(ukRequester, 'spokeo',
      'https://example.com/photo.jpg');
    expect(req.penalty).toContain('safe harbor');
  });
});
