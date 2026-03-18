/**
 * Identity graph construction and analysis.
 *
 * Models a person's digital identity as a graph:
 *   - Nodes = exposure records (broker profiles, social accounts, public records)
 *   - Edges = linking quasi-identifiers (shared email, shared name+city, etc.)
 *   - Edge weight = mutual information of the linking QIs (bits)
 *
 * The adversary's re-identification power is bounded by the max-flow
 * through this graph. The optimal removal set is the minimum vertex cut.
 *
 * References:
 *   Ford & Fulkerson, "Maximal Flow Through a Network" (1956)
 *   Menger's theorem: min vertex cut = max vertex-disjoint paths
 *   Fellegi & Sunter, "A Theory for Record Linkage" (1969)
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

        // compute MI contribution, accounting for correlations with
        // other linking fields we've already counted
        const freq = qa.frequency ?? estimateFrequency(qa.field, qa.value);
        const raw = selfInfo(freq);

        let maxCorr = 0;
        for (const prev of seen) {
          const c = fieldCorrelation(qa.field, prev);
          if (c > maxCorr) maxCorr = c;
        }

        totalMI += raw * (1 - maxCorr);
        seen.push(qa.field);
        break; // one match per field per record pair
      }
    }
  }

  if (linkingFields.length === 0) return null;
  return { linkingFields, mutualInfo: totalMI };
}

/** Check if two QI values match, with field-appropriate comparison.
 *  Names: case-insensitive, trimmed.
 *  Emails/phones: normalised.
 *  Dates: exact match. */
function matchValues(a: string, b: string, field: QIField): boolean {
  const na = normalise(a, field);
  const nb = normalise(b, field);
  return na === nb;
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

/** Compute max-flow using Edmonds-Karp (BFS-based Ford-Fulkerson).
 *  The max-flow between the two "most connected" nodes bounds the
 *  adversary's ability to traverse the identity graph.
 *
 *  For identity graphs: max-flow = maximum bits of linking information
 *  an adversary can chain through intermediate records.
 *
 *  Returns 0 if the graph is disconnected (no path between components). */
export function computeMaxFlow(n: number, edges: LinkEdge[]): number {
  if (n < 2 || edges.length === 0) return 0;

  // build capacity matrix (using mutual info as capacity)
  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const e of edges) {
    cap[e.from][e.to] += e.mutualInfo;
    cap[e.to][e.from] += e.mutualInfo;
  }

  // find the two nodes with highest total edge weight — the "identity anchors"
  const weights = new Array(n).fill(0);
  for (const e of edges) {
    weights[e.from] += e.mutualInfo;
    weights[e.to] += e.mutualInfo;
  }

  const sorted = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  if (sorted.length < 2) return 0;

  const source = sorted[0].i;
  const sink = sorted[1].i;

  // Edmonds-Karp
  const flow: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let maxFlow = 0;

  while (true) {
    // BFS to find augmenting path
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

    // find bottleneck
    let bottleneck = Infinity;
    let v = sink;
    while (v !== source) {
      const u = parent[v];
      bottleneck = Math.min(bottleneck, cap[u][v] - flow[u][v]);
      v = u;
    }

    // update flow
    v = sink;
    while (v !== source) {
      const u = parent[v];
      flow[u][v] += bottleneck;
      flow[v][u] -= bottleneck;
      v = u;
    }

    maxFlow += bottleneck;
  }

  return maxFlow;
}

/** Find the minimum vertex cut — the optimal set of records to remove
 *  to maximally disconnect the identity graph.
 *
 *  By the max-flow min-cut theorem, the min-cut capacity equals the max-flow.
 *  The cut itself tells us WHICH edges (records) to remove.
 *
 *  Returns indices of edges in the minimum cut. */
export function findMinCut(n: number, edges: LinkEdge[]): number[] {
  if (n < 2 || edges.length === 0) return [];

  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const e of edges) {
    cap[e.from][e.to] += e.mutualInfo;
    cap[e.to][e.from] += e.mutualInfo;
  }

  const weights = new Array(n).fill(0);
  for (const e of edges) {
    weights[e.from] += e.mutualInfo;
    weights[e.to] += e.mutualInfo;
  }

  const sorted = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  if (sorted.length < 2) return [];

  const source = sorted[0].i;
  const sink = sorted[1].i;

  // run max-flow to compute residual graph
  const flow: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

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
  }

  // BFS on residual graph from source to find S-side of cut
  const reachable = new Uint8Array(n);
  reachable[source] = 1;
  const queue = [source];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (let v = 0; v < n; v++) {
      if (!reachable[v] && cap[u][v] - flow[u][v] > 1e-10) {
        reachable[v] = 1;
        queue.push(v);
      }
    }
  }

  // min-cut edges: from reachable to non-reachable
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
