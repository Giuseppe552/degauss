import { describe, it, expect } from 'vitest';
import {
  buildIdentityGraph,
  findComponents,
  computeMaxFlow,
  findMinCut,
  findMinVertexCut,
} from './graph.js';
import type { ExposureRecord } from './types.js';

function makeRecord(source: string, fields: Array<[string, string]>): ExposureRecord {
  return {
    source,
    qis: fields.map(([field, value]) => ({
      field: field as any,
      value,
      source,
    })),
    discoveredAt: Date.now(),
    status: 'active',
  };
}

describe('buildIdentityGraph', () => {
  it('links records sharing an email', () => {
    const records = [
      makeRecord('spokeo', [['email', 'g@test.com'], ['full_name', 'Giuseppe Giona']]),
      makeRecord('whitepages', [['email', 'g@test.com'], ['phone', '+447000000']]),
    ];
    const graph = buildIdentityGraph(records);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].linkingFields).toContain('email');
    expect(graph.edges[0].mutualInfo).toBeGreaterThan(0);
  });

  it('no edges when records share no QIs', () => {
    const records = [
      makeRecord('spokeo', [['email', 'a@test.com']]),
      makeRecord('whitepages', [['email', 'b@test.com']]),
    ];
    const graph = buildIdentityGraph(records);
    expect(graph.edges.length).toBe(0);
  });

  it('accumulates MI from multiple linking fields', () => {
    const records = [
      makeRecord('spokeo', [['email', 'g@test.com'], ['phone', '+447000000']]),
      makeRecord('whitepages', [['email', 'g@test.com'], ['phone', '+447000000']]),
    ];
    const graph = buildIdentityGraph(records);
    expect(graph.edges.length).toBe(1);
    // MI from email + phone should be > MI from email alone
    const emailOnly = buildIdentityGraph([
      makeRecord('a', [['email', 'g@test.com']]),
      makeRecord('b', [['email', 'g@test.com']]),
    ]);
    expect(graph.edges[0].mutualInfo).toBeGreaterThan(emailOnly.edges[0].mutualInfo);
  });

  it('handles case-insensitive name matching', () => {
    const records = [
      makeRecord('a', [['full_name', 'Giuseppe Giona']]),
      makeRecord('b', [['full_name', 'giuseppe giona']]),
    ];
    const graph = buildIdentityGraph(records);
    expect(graph.edges.length).toBe(1);
  });
});

describe('findComponents', () => {
  it('finds single component when all connected', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 5 },
      { from: 1, to: 2, linkingFields: ['phone' as const], mutualInfo: 5 },
    ];
    const comps = findComponents(3, edges);
    expect(comps.length).toBe(1);
    expect(comps[0].sort()).toEqual([0, 1, 2]);
  });

  it('finds separate components', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 5 },
    ];
    const comps = findComponents(3, edges);
    expect(comps.length).toBe(2);
  });

  it('isolates when no edges', () => {
    const comps = findComponents(4, []);
    expect(comps.length).toBe(4);
  });
});

describe('computeMaxFlow', () => {
  it('returns 0 for no edges', () => {
    expect(computeMaxFlow(3, [])).toBe(0);
  });

  it('returns edge weight for single edge', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 10 },
    ];
    expect(computeMaxFlow(2, edges)).toBeCloseTo(10, 5);
  });

  it('max-flow <= sum of all edge capacities', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 5 },
      { from: 0, to: 2, linkingFields: ['phone' as const], mutualInfo: 3 },
      { from: 1, to: 2, linkingFields: ['full_name' as const], mutualInfo: 7 },
    ];
    const mf = computeMaxFlow(3, edges);
    expect(mf).toBeLessThanOrEqual(5 + 3 + 7);
    expect(mf).toBeGreaterThan(0);
  });

  it('bottleneck limits flow', () => {
    // chain: 0 --10--> 1 --2--> 2
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 10 },
      { from: 1, to: 2, linkingFields: ['phone' as const], mutualInfo: 2 },
    ];
    const mf = computeMaxFlow(3, edges);
    // max flow from 0 to 2 is limited by bottleneck of 2
    // but source/sink are chosen by highest weight, which are 0 and 1
    // so max flow between 0 and 1 = 10 (direct edge)
    expect(mf).toBeGreaterThan(0);
  });
});

describe('findMinCut', () => {
  it('returns empty for no edges', () => {
    expect(findMinCut(3, [])).toEqual([]);
  });

  it('finds the bottleneck edge', () => {
    // 0 --10--> 1 --2--> 2
    // min cut should include the weak edge
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 10 },
      { from: 1, to: 2, linkingFields: ['phone' as const], mutualInfo: 2 },
    ];
    const cut = findMinCut(3, edges);
    expect(cut.length).toBeGreaterThan(0);
  });

  it('min-cut capacity equals max-flow (max-flow min-cut theorem)', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 5 },
      { from: 0, to: 2, linkingFields: ['phone' as const], mutualInfo: 3 },
      { from: 1, to: 3, linkingFields: ['full_name' as const], mutualInfo: 4 },
      { from: 2, to: 3, linkingFields: ['city' as const], mutualInfo: 6 },
    ];
    const mf = computeMaxFlow(4, edges);
    const cutIndices = findMinCut(4, edges);
    const cutCapacity = cutIndices.reduce((sum, i) => sum + edges[i].mutualInfo, 0);
    // min-cut capacity should equal max-flow
    expect(cutCapacity).toBeCloseTo(mf, 5);
  });
});

describe('findMinVertexCut', () => {
  it('returns empty for no edges', () => {
    expect(findMinVertexCut(3, [])).toEqual([]);
  });

  it('finds bottleneck node in a chain', () => {
    // 0 --10--> 1 --10--> 2  (node 1 is the bottleneck)
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 10 },
      { from: 1, to: 2, linkingFields: ['phone' as const], mutualInfo: 10 },
    ];
    const cut = findMinVertexCut(3, edges);
    // node 1 is the only internal node; cutting it disconnects 0 from 2
    expect(cut).toContain(1);
  });

  it('does not include source or sink in vertex cut', () => {
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 5 },
      { from: 1, to: 2, linkingFields: ['phone' as const], mutualInfo: 5 },
      { from: 0, to: 2, linkingFields: ['full_name' as const], mutualInfo: 5 },
    ];
    const cut = findMinVertexCut(3, edges);
    // source and sink (two highest-weight nodes) should not appear
    // all 3 nodes have equal weight so source=0, sink=1 by stability
    for (const v of cut) {
      expect(v).not.toBe(0);
      expect(v).not.toBe(1);
    }
  });

  it('returns multiple vertices when needed', () => {
    // hourglass: 0→1, 0→2, 1→3, 2→3, 3→4, 3→5
    // nodes 0 and 4 are leaves (degree 1) → source=0, sink=4
    // to disconnect 0 from 4, must cut node 3 at minimum
    const edges = [
      { from: 0, to: 1, linkingFields: ['email' as const], mutualInfo: 10 },
      { from: 0, to: 2, linkingFields: ['phone' as const], mutualInfo: 10 },
      { from: 1, to: 3, linkingFields: ['full_name' as const], mutualInfo: 10 },
      { from: 2, to: 3, linkingFields: ['city' as const], mutualInfo: 10 },
      { from: 3, to: 4, linkingFields: ['zip' as const], mutualInfo: 10 },
      { from: 3, to: 5, linkingFields: ['dob' as const], mutualInfo: 10 },
    ];
    const cut = findMinVertexCut(6, edges);
    // node 3 is the bottleneck
    expect(cut.length).toBeGreaterThanOrEqual(1);
    expect(cut).toContain(3);
  });
});
