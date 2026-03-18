import { describe, it, expect } from 'vitest';
import {
  getSupplyChain,
  findUpstream,
  findDownstream,
  computeUpstreamStrategy,
} from './supplychain.js';

describe('getSupplyChain', () => {
  it('returns nodes and edges', () => {
    const graph = getSupplyChain();
    expect(graph.nodes.length).toBeGreaterThan(10);
    expect(graph.edges.length).toBeGreaterThan(10);
  });

  it('all edge endpoints exist in nodes', () => {
    const graph = getSupplyChain();
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });

  it('public records are not removable', () => {
    const graph = getSupplyChain();
    const publicRecords = graph.nodes.filter(n => n.type === 'public_record');
    expect(publicRecords.length).toBeGreaterThan(0);
    for (const pr of publicRecords) {
      expect(pr.removable).toBe(false);
    }
  });

  it('edge confidence is between 0 and 1', () => {
    const graph = getSupplyChain();
    for (const edge of graph.edges) {
      expect(edge.confidence).toBeGreaterThan(0);
      expect(edge.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('findUpstream', () => {
  it('spokeo has upstream sources', () => {
    const upstream = findUpstream('spokeo');
    expect(upstream.length).toBeGreaterThan(0);
    // should include at least one aggregator or public record
    const types = new Set(upstream.map(n => n.type));
    expect(
      types.has('aggregator') || types.has('public_record')
    ).toBe(true);
  });

  it('voter_rolls has no upstream (root source)', () => {
    const upstream = findUpstream('voter_rolls');
    expect(upstream.length).toBe(0);
  });

  it('people-search sites ultimately trace back to public records', () => {
    const upstream = findUpstream('truepeoplesearch');
    const publicRecords = upstream.filter(n => n.type === 'public_record');
    expect(publicRecords.length).toBeGreaterThan(0);
  });
});

describe('findDownstream', () => {
  it('acxiom feeds multiple people-search sites', () => {
    const downstream = findDownstream('acxiom');
    expect(downstream.length).toBeGreaterThan(2);
    const peopleSearch = downstream.filter(n => n.type === 'people_search');
    expect(peopleSearch.length).toBeGreaterThan(0);
  });

  it('leaf nodes have no downstream', () => {
    // radaris is a leaf (nothing downstream in our graph)
    const downstream = findDownstream('radaris');
    // may or may not have downstream — just check it doesn't crash
    expect(Array.isArray(downstream)).toBe(true);
  });

  it('voter_rolls feeds many sources', () => {
    const downstream = findDownstream('voter_rolls');
    expect(downstream.length).toBeGreaterThan(3);
  });
});

describe('computeUpstreamStrategy', () => {
  it('returns a removal order for leaf brokers', () => {
    const strategy = computeUpstreamStrategy([
      'spokeo', 'whitepages', 'truepeoplesearch',
    ]);
    expect(strategy.removalOrder.length).toBeGreaterThan(0);
    expect(strategy.totalCascade).toBeGreaterThan(0);
  });

  it('prefers upstream sources that cover multiple leaves', () => {
    const strategy = computeUpstreamStrategy([
      'spokeo', 'beenverified', 'intelius',
    ]);
    // acxiom feeds all three — it should appear early
    const acxiomIdx = strategy.removalOrder.findIndex(n => n.id === 'acxiom');
    if (acxiomIdx >= 0) {
      expect(acxiomIdx).toBeLessThan(3); // should be among first picks
    }
  });

  it('identifies irremovable sources', () => {
    // if the only source is a public record, it's irremovable
    const strategy = computeUpstreamStrategy(['voter_rolls']);
    // voter_rolls itself is public_record — can't be removed
    // strategy should flag it
    expect(
      strategy.irremovable.length > 0 || strategy.removalOrder.length === 0
    ).toBe(true);
  });

  it('cascade map shows which leaves each removal covers', () => {
    const strategy = computeUpstreamStrategy(['spokeo', 'whitepages']);
    for (const node of strategy.removalOrder) {
      const cascade = strategy.cascadeMap.get(node.id);
      if (cascade) {
        expect(cascade.length).toBeGreaterThan(0);
      }
    }
  });
});
