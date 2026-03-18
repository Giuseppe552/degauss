/**
 * Identity graph construction and analysis.
 *
 * Models a person's digital identity as a graph:
 *   - Nodes = exposure records (broker profiles, social accounts, public records)
 *   - Edges = linking quasi-identifiers (shared email, shared name+city, etc.)
 *   - Edge weight = mutual information of the linking QIs (bits)
 *
 * The max-flow / min-cut analysis is a HEURISTIC model of adversarial
 * re-identification power — it's not from the cited linkage literature.
 * The intuition: if an adversary can chain linking information through
 * intermediate records, the max-flow bounds how much they can learn.
 * The min-cut identifies the most cost-effective edges to sever.
 *
 * This is our own construction, not established theory. The primitives
 * (Edmonds-Karp, BFS components) are standard graph algorithms.
 *
 * References:
 *   Edmonds & Karp, "Theoretical Improvements in Algorithmic Efficiency
 *     for Network Flow Problems" (1972, JACM 19(2))
 *   Fellegi & Sunter, "A Theory for Record Linkage" (1969) — for the
 *     linking weight computation, not the graph model
 */

import type {
  ExposureRecord,
  LinkEdge,
  IdentityGraph,
  QIField,
} from './types.js';
import { selfInfo } from './entropy.js';
import { fieldCorrelation, estimateFrequency } from './population.js';

/** Build the identity graph from a set of exposure records.
 *  Two records are linked if they share quasi-identifier values. */
export function buildIdentityGraph(records: ExposureRecord[]): IdentityGraph {
  const edges: LinkEdge[] = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const link = computeLink(records[i], records[j]);
      if (link) {
        edges.push({ from: i, to: j, ...link });
      }
    }
  }

  const components = findComponents(records.length, edges);
  const maxFlow = computeMaxFlow(records.length, edges);

  return { records, edges, maxFlow, components };
}

/** Find linking QIs between two records and compute mutual information. */
function computeLink(
  a: ExposureRecord,
  b: ExposureRecord
): { linkingFields: QIField[]; mutualInfo: number } | null {
  const linkingFields: QIField[] = [];
  let totalMI = 0;
  const seen: QIField[] = [];

  for (const qa of a.qis) {
    for (const qb of b.qis) {
      if (qa.field === qb.field && matchValues(qa.value, qb.value, qa.field)) {
        linkingFields.push(qa.field);

        const freq = qa.frequency ?? estimateFrequency(qa.field, qa.value);
        const raw = selfInfo(freq);

        let maxCorr = 0;
        for (const prev of seen) {
          const c = fieldCorrelation(qa.field, prev);
          if (c > maxCorr) maxCorr = c;
        }

        totalMI += raw * (1 - maxCorr);
        seen.push(qa.field);
        break;
      }
    }
  }

  if (linkingFields.length === 0) return null;
  return { linkingFields, mutualInfo: totalMI };
}

function matchValues(a: string, b: string, field: QIField): boolean {
  return normalise(a, field) === normalise(b, field);
}

function normalise(v: string, field: QIField): string {
  const trimmed = v.trim();
  switch (field) {
    case 'email':
    case 'username':
      return trimmed.toLowerCase();
    case 'full_name':
    case 'first_name':
    case 'last_name':
    case 'city':
    case 'state':
    case 'country':
      return trimmed.toLowerCase().replace(/[^a-z\s]/g, '');
    case 'phone':
      return trimmed.replace(/[\s\-\(\)\+]/g, '');
    case 'zip':
      return trimmed.toUpperCase().replace(/\s/g, '');
    default:
      return trimmed;
  }
}

/** Find connected components via BFS. */
export function findComponents(n: number, edges: LinkEdge[]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.from].push(e.to);
    adj[e.to].push(e.from);
  }

  const visited = new Uint8Array(n);
  const components: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp: number[] = [];
    const queue = [i];
    visited[i] = 1;
    while (queue.length > 0) {
      const node = queue.shift()!;
      comp.push(node);
      for (const nb of adj[node]) {
        if (!visited[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  return components;
}

// ─── Edmonds-Karp max-flow ─────────────────────────────────────────────
// Single implementation used by both computeMaxFlow and findMinCut.

interface FlowResult {
  maxFlow: number;
  /** residual capacities: cap[u][v] - flow[u][v] */
  residual: number[][];
  source: number;
  sink: number;
}

function buildCapacityMatrix(n: number, edges: LinkEdge[]): number[][] {
  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const e of edges) {
    cap[e.from][e.to] += e.mutualInfo;
    cap[e.to][e.from] += e.mutualInfo;
  }
  return cap;
}

/** Pick source and sink as the two nodes with highest total edge weight.
 *  This is a heuristic — there's no theoretical justification for why
 *  these specific nodes bound adversarial capability in general.
 *  For small identity graphs (<100 nodes), it's a reasonable proxy. */
function pickSourceSink(n: number, edges: LinkEdge[]): [number, number] | null {
  const weights = new Array(n).fill(0);
  for (const e of edges) {
    weights[e.from] += e.mutualInfo;
    weights[e.to] += e.mutualInfo;
  }
  const sorted = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  if (sorted.length < 2) return null;
  return [sorted[0].i, sorted[1].i];
}

/** Edmonds-Karp: BFS-based max-flow. O(VE²). */
function edmondsKarp(n: number, cap: number[][], source: number, sink: number): FlowResult {
  const flow: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let maxFlow = 0;

  while (true) {
    const parent = new Array(n).fill(-1);
    const visited = new Uint8Array(n);
    visited[source] = 1;
    const queue = [source];
    let found = false;

    while (queue.length > 0 && !found) {
      const u = queue.shift()!;
      for (let v = 0; v < n; v++) {
        if (!visited[v] && cap[u][v] - flow[u][v] > 1e-10) {
          visited[v] = 1;
          parent[v] = u;
          if (v === sink) { found = true; break; }
          queue.push(v);
        }
      }
    }

    if (!found) break;

    let bottleneck = Infinity;
    let v = sink;
    while (v !== source) {
      const u = parent[v];
      bottleneck = Math.min(bottleneck, cap[u][v] - flow[u][v]);
      v = u;
    }

    v = sink;
    while (v !== source) {
      const u = parent[v];
      flow[u][v] += bottleneck;
      flow[v][u] -= bottleneck;
      v = u;
    }

    maxFlow += bottleneck;
  }

  // build residual
  const residual = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cap[i][j] - flow[i][j])
  );

  return { maxFlow, residual, source, sink };
}

/** Compute max-flow between the two most-connected nodes.
 *  Returns 0 if the graph is disconnected or has < 2 nodes. */
export function computeMaxFlow(n: number, edges: LinkEdge[]): number {
  if (n < 2 || edges.length === 0) return 0;
  const endpoints = pickSourceSink(n, edges);
  if (!endpoints) return 0;
  const cap = buildCapacityMatrix(n, edges);
  return edmondsKarp(n, cap, endpoints[0], endpoints[1]).maxFlow;
}

/** Find the minimum edge cut — the set of edges whose removal
 *  maximally disconnects the identity graph.
 *
 *  By the max-flow min-cut theorem (Ford & Fulkerson 1956),
 *  the min-cut capacity equals the max-flow. The cut edges
 *  are those crossing from the source-reachable set to the rest
 *  in the residual graph.
 *
 *  NOTE: this is an EDGE cut, not a vertex cut. For the vertex cut
 *  version, use findMinVertexCut() which applies the standard
 *  vertex-splitting reduction. */
export function findMinCut(n: number, edges: LinkEdge[]): number[] {
  if (n < 2 || edges.length === 0) return [];
  const endpoints = pickSourceSink(n, edges);
  if (!endpoints) return [];

  const cap = buildCapacityMatrix(n, edges);
  const { residual, source } = edmondsKarp(n, cap, endpoints[0], endpoints[1]);

  // BFS on residual to find source-reachable nodes
  const reachable = new Uint8Array(n);
  reachable[source] = 1;
  const queue = [source];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (let v = 0; v < n; v++) {
      if (!reachable[v] && residual[u][v] > 1e-10) {
        reachable[v] = 1;
        queue.push(v);
      }
    }
  }

  // cut edges cross from reachable to non-reachable
  const cutEdges: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (
      (reachable[e.from] && !reachable[e.to]) ||
      (reachable[e.to] && !reachable[e.from])
    ) {
      cutEdges.push(i);
    }
  }

  return cutEdges;
}

/** Find the minimum vertex cut using the standard vertex-splitting
 *  reduction: split each node v into v_in and v_out connected by
 *  an edge with capacity 1 (unit vertex capacity). External edges
 *  get capacity ∞. Then min-cut on the expanded graph gives the
 *  minimum number of vertices whose removal disconnects source from sink.
 *
 *  Reference: standard reduction, see e.g. Cormen et al., CLRS §26.
 *
 *  We try all pairs of "leaf-like" nodes (degree 1 or lowest degree)
 *  as source/sink to find the global minimum vertex connectivity.
 *
 *  Returns indices of NODES in the minimum vertex cut. */
export function findMinVertexCut(n: number, edges: LinkEdge[]): number[] {
  if (n < 2 || edges.length === 0) return [];

  // build adjacency for degree computation
  const degree = new Array(n).fill(0);
  for (const e of edges) {
    degree[e.from]++;
    degree[e.to]++;
  }

  // for vertex connectivity, source and sink should be peripheral nodes
  // (low degree) so they're not themselves part of the min cut.
  // We pick the two lowest-degree nodes. If there's only one low-degree
  // node, pick the next lowest.
  const byDeg = degree.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
  const origSource = byDeg[0].i;
  const origSink = byDeg.length > 1 ? byDeg[1].i : -1;

  if (origSink < 0 || origSource === origSink) return [];

  // expanded graph: node v → v_in (2v) and v_out (2v+1)
  const en = n * 2;
  const cap: number[][] = Array.from({ length: en }, () => new Array(en).fill(0));

  // internal edges: v_in → v_out
  // capacity = 1 for all nodes except source and sink (∞)
  for (let v = 0; v < n; v++) {
    const vIn = v * 2;
    const vOut = v * 2 + 1;
    cap[vIn][vOut] = (v === origSource || v === origSink) ? 1e9 : 1;
  }

  // external edges: u_out → v_in with capacity ∞ (we only want to cut vertices)
  for (const e of edges) {
    cap[e.from * 2 + 1][e.to * 2] = 1e9;
    cap[e.to * 2 + 1][e.from * 2] = 1e9; // undirected
  }

  const source = origSource * 2;   // source_in
  const sink = origSink * 2 + 1;   // sink_out

  const { residual } = edmondsKarp(en, cap, source, sink);

  // saturated internal edges → vertex cut
  const cutVertices: number[] = [];
  for (let v = 0; v < n; v++) {
    if (v === origSource || v === origSink) continue;
    const vIn = v * 2;
    const vOut = v * 2 + 1;
    if (residual[vIn][vOut] < 1e-10 && cap[vIn][vOut] > 0) {
      cutVertices.push(v);
    }
  }

  return cutVertices;
}
