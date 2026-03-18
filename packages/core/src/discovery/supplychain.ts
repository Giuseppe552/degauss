/**
 * Data broker supply chain graph.
 *
 * Brokers don't operate independently. Public records feed aggregators,
 * aggregators feed people-search sites, and people-search sites resell
 * to each other. Removing from a leaf broker is pointless if the
 * upstream source still has the data — it reappears in 30 days.
 *
 * This module models the broker ecosystem as a directed graph:
 *   - Nodes = data sources (public records, aggregators, people-search sites)
 *   - Edges = data flows (who feeds whom)
 *   - Node type = { public_record, aggregator, people_search, social_media }
 *
 * The key insight: find the SOURCE NODES (public records, original aggregators)
 * and prioritise removal there. A single upstream removal can cascade
 * downstream, making multiple leaf removals unnecessary.
 *
 * This is our own construction — no published work maps the broker
 * supply chain as a directed graph for removal prioritisation.
 */

/** Types of data sources in the broker ecosystem */
export type SourceType = 'public_record' | 'aggregator' | 'people_search' | 'social_media' | 'data_broker';

/** A node in the supply chain graph */
export interface SupplyNode {
  id: string;
  name: string;
  type: SourceType;
  /** can this source be removed from? */
  removable: boolean;
  /** difficulty of removal (0-1) */
  removalDifficulty: number;
  /** typical refresh cycle (days) — how fast it re-acquires data */
  refreshDays: number;
}

/** A directed edge: data flows from source to target */
export interface SupplyEdge {
  from: string;
  to: string;
  /** confidence that this data flow exists (0-1) */
  confidence: number;
  /** what types of data flow through this edge */
  dataTypes: string[];
}

/** The complete supply chain graph */
export interface SupplyChainGraph {
  nodes: SupplyNode[];
  edges: SupplyEdge[];
}

/** Removal strategy recommendation */
export interface UpstreamStrategy {
  /** which sources to remove from, in order */
  removalOrder: SupplyNode[];
  /** which downstream sources would be affected by each removal */
  cascadeMap: Map<string, string[]>;
  /** estimated total downstream impact (number of leaf sources affected) */
  totalCascade: number;
  /** sources that can't be removed (public records) */
  irremovable: SupplyNode[];
}

/** Known data broker supply chain relationships.
 *
 *  These are based on:
 *  - Senate JEC report on data broker practices (Feb 2026)
 *  - CPPA enforcement actions and data broker registry
 *  - Privacy Rights Clearinghouse research
 *  - Reverse engineering: remove from A, see if B re-acquires
 *
 *  The real supply chain is more complex — brokers have bilateral
 *  agreements we can't observe. This captures the known structure. */
const KNOWN_NODES: SupplyNode[] = [
  // public records — the ultimate upstream. can't remove.
  { id: 'voter_rolls', name: 'Voter Registration Rolls', type: 'public_record', removable: false, removalDifficulty: 1.0, refreshDays: 90 },
  { id: 'property_records', name: 'Property Records (County)', type: 'public_record', removable: false, removalDifficulty: 1.0, refreshDays: 30 },
  { id: 'court_records', name: 'Court Filings (PACER/State)', type: 'public_record', removable: false, removalDifficulty: 1.0, refreshDays: 7 },
  { id: 'business_filings', name: 'Business Registrations (SoS)', type: 'public_record', removable: false, removalDifficulty: 1.0, refreshDays: 30 },
  { id: 'phone_directory', name: 'Phone Directory (CNAM/411)', type: 'public_record', removable: false, removalDifficulty: 0.95, refreshDays: 30 },

  // tier 1 aggregators — buy from public records + each other
  { id: 'acxiom', name: 'Acxiom (LiveRamp)', type: 'aggregator', removable: true, removalDifficulty: 0.5, refreshDays: 30 },
  { id: 'lexisnexis', name: 'LexisNexis Risk Solutions', type: 'aggregator', removable: true, removalDifficulty: 0.9, refreshDays: 60 },
  { id: 'experian', name: 'Experian (Consumer)', type: 'aggregator', removable: true, removalDifficulty: 0.7, refreshDays: 45 },
  { id: 'equifax', name: 'Equifax', type: 'aggregator', removable: true, removalDifficulty: 0.7, refreshDays: 45 },
  { id: 'transunion', name: 'TransUnion', type: 'aggregator', removable: true, removalDifficulty: 0.7, refreshDays: 45 },
  { id: 'oracle_data', name: 'Oracle Data Cloud', type: 'aggregator', removable: true, removalDifficulty: 0.6, refreshDays: 30 },

  // tier 2 people-search — source from aggregators + public records
  { id: 'spokeo', name: 'Spokeo', type: 'people_search', removable: true, removalDifficulty: 0.3, refreshDays: 30 },
  { id: 'whitepages', name: 'WhitePages', type: 'people_search', removable: true, removalDifficulty: 0.3, refreshDays: 21 },
  { id: 'beenverified', name: 'BeenVerified', type: 'people_search', removable: true, removalDifficulty: 0.4, refreshDays: 28 },
  { id: 'intelius', name: 'Intelius', type: 'people_search', removable: true, removalDifficulty: 0.4, refreshDays: 28 },
  { id: 'truepeoplesearch', name: 'TruePeopleSearch', type: 'people_search', removable: true, removalDifficulty: 0.3, refreshDays: 14 },
  { id: 'fastpeoplesearch', name: 'FastPeopleSearch', type: 'people_search', removable: true, removalDifficulty: 0.3, refreshDays: 14 },
  { id: 'peoplefinder', name: 'PeopleFinder', type: 'people_search', removable: true, removalDifficulty: 0.3, refreshDays: 30 },
  { id: 'radaris', name: 'Radaris', type: 'people_search', removable: true, removalDifficulty: 0.8, refreshDays: 21 },
  { id: 'pipl', name: 'Pipl', type: 'data_broker', removable: true, removalDifficulty: 0.5, refreshDays: 45 },

  // social media
  { id: 'linkedin', name: 'LinkedIn', type: 'social_media', removable: true, removalDifficulty: 0.2, refreshDays: 1 },
  { id: 'facebook', name: 'Facebook/Meta', type: 'social_media', removable: true, removalDifficulty: 0.3, refreshDays: 1 },
];

const KNOWN_EDGES: SupplyEdge[] = [
  // public records → aggregators
  { from: 'voter_rolls', to: 'acxiom', confidence: 0.95, dataTypes: ['name', 'address', 'dob', 'party'] },
  { from: 'voter_rolls', to: 'lexisnexis', confidence: 0.95, dataTypes: ['name', 'address', 'dob'] },
  { from: 'voter_rolls', to: 'experian', confidence: 0.90, dataTypes: ['name', 'address'] },
  { from: 'property_records', to: 'lexisnexis', confidence: 0.95, dataTypes: ['name', 'address', 'property_value'] },
  { from: 'property_records', to: 'acxiom', confidence: 0.90, dataTypes: ['name', 'address'] },
  { from: 'court_records', to: 'lexisnexis', confidence: 0.95, dataTypes: ['name', 'case_type', 'filing'] },
  { from: 'business_filings', to: 'lexisnexis', confidence: 0.90, dataTypes: ['name', 'business_name', 'address'] },
  { from: 'phone_directory', to: 'whitepages', confidence: 0.90, dataTypes: ['name', 'phone', 'address'] },
  { from: 'phone_directory', to: 'acxiom', confidence: 0.85, dataTypes: ['name', 'phone'] },

  // aggregators → people-search sites
  { from: 'acxiom', to: 'spokeo', confidence: 0.80, dataTypes: ['name', 'address', 'phone', 'email'] },
  { from: 'acxiom', to: 'beenverified', confidence: 0.75, dataTypes: ['name', 'address', 'phone'] },
  { from: 'acxiom', to: 'intelius', confidence: 0.75, dataTypes: ['name', 'address', 'phone'] },
  { from: 'lexisnexis', to: 'beenverified', confidence: 0.70, dataTypes: ['name', 'address', 'court_records'] },
  { from: 'lexisnexis', to: 'spokeo', confidence: 0.65, dataTypes: ['name', 'address'] },
  { from: 'experian', to: 'whitepages', confidence: 0.70, dataTypes: ['name', 'address', 'phone'] },

  // public records → people-search (direct scraping)
  { from: 'voter_rolls', to: 'truepeoplesearch', confidence: 0.85, dataTypes: ['name', 'address'] },
  { from: 'voter_rolls', to: 'fastpeoplesearch', confidence: 0.85, dataTypes: ['name', 'address'] },
  { from: 'phone_directory', to: 'truepeoplesearch', confidence: 0.80, dataTypes: ['name', 'phone'] },
  { from: 'phone_directory', to: 'fastpeoplesearch', confidence: 0.80, dataTypes: ['name', 'phone'] },
  { from: 'property_records', to: 'spokeo', confidence: 0.70, dataTypes: ['name', 'address'] },
  { from: 'property_records', to: 'radaris', confidence: 0.75, dataTypes: ['name', 'address'] },

  // cross-broker data sharing
  { from: 'whitepages', to: 'spokeo', confidence: 0.50, dataTypes: ['name', 'phone'] },
  { from: 'beenverified', to: 'peoplefinder', confidence: 0.60, dataTypes: ['name', 'address', 'phone'] },
  { from: 'intelius', to: 'peoplefinder', confidence: 0.55, dataTypes: ['name', 'address'] },

  // social media → scrapers
  { from: 'linkedin', to: 'pipl', confidence: 0.70, dataTypes: ['name', 'employer', 'job_title'] },
  { from: 'facebook', to: 'pipl', confidence: 0.60, dataTypes: ['name', 'city', 'photo'] },
  { from: 'linkedin', to: 'spokeo', confidence: 0.50, dataTypes: ['name', 'employer'] },
];

/** Get the full known supply chain graph. */
export function getSupplyChain(): SupplyChainGraph {
  return { nodes: [...KNOWN_NODES], edges: [...KNOWN_EDGES] };
}

/** Find all upstream sources for a given broker (BFS backwards).
 *  Answers: "where does Spokeo get its data?" */
export function findUpstream(brokerId: string): SupplyNode[] {
  const graph = getSupplyChain();
  const visited = new Set<string>();
  const queue = [brokerId];
  const upstream: SupplyNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of graph.edges) {
      if (edge.to === current && !visited.has(edge.from)) {
        const node = graph.nodes.find(n => n.id === edge.from);
        if (node) {
          upstream.push(node);
          queue.push(edge.from);
        }
      }
    }
  }

  return upstream;
}

/** Find all downstream consumers of a given source (BFS forwards).
 *  Answers: "if I remove from Acxiom, who loses their data source?" */
export function findDownstream(sourceId: string): SupplyNode[] {
  const graph = getSupplyChain();
  const visited = new Set<string>();
  const queue = [sourceId];
  const downstream: SupplyNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of graph.edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        const node = graph.nodes.find(n => n.id === edge.to);
        if (node) {
          downstream.push(node);
          queue.push(edge.to);
        }
      }
    }
  }

  return downstream;
}

/** Compute the optimal upstream removal strategy.
 *
 *  Given a set of leaf brokers where the user's data was found,
 *  work backwards through the supply chain to find the minimum
 *  set of upstream sources to remove from.
 *
 *  Strategy:
 *  1. Find all upstream sources for each leaf broker
 *  2. Score each upstream source by: downstream cascade size / difficulty
 *  3. Greedily select sources that cover the most leaf brokers per removal
 *
 *  This is a weighted set cover problem (NP-hard in general,
 *  but greedy achieves ln(n) approximation). */
export function computeUpstreamStrategy(
  leafBrokerIds: string[]
): UpstreamStrategy {
  const graph = getSupplyChain();
  const leaves = new Set(leafBrokerIds);

  // for each potential removal target, compute which leaves it feeds
  const coverMap = new Map<string, Set<string>>();
  const cascadeMap = new Map<string, string[]>();

  for (const nodeId of graph.nodes.map(n => n.id)) {
    if (!graph.nodes.find(n => n.id === nodeId)?.removable) continue;

    const downstream = findDownstream(nodeId);
    const coveredLeaves = downstream
      .filter(d => leaves.has(d.id))
      .map(d => d.id);

    // also include self if it's a leaf
    if (leaves.has(nodeId)) coveredLeaves.push(nodeId);

    if (coveredLeaves.length > 0) {
      coverMap.set(nodeId, new Set(coveredLeaves));
      cascadeMap.set(nodeId, [...new Set(coveredLeaves)]);
    }
  }

  // greedy set cover
  const uncovered = new Set(leafBrokerIds);
  const removalOrder: SupplyNode[] = [];
  const irremovable: SupplyNode[] = [];

  while (uncovered.size > 0) {
    let bestId = '';
    let bestScore = -1;

    for (const [nodeId, covers] of coverMap) {
      const remaining = [...covers].filter(c => uncovered.has(c)).length;
      if (remaining === 0) continue;

      const node = graph.nodes.find(n => n.id === nodeId)!;
      const score = remaining / Math.max(node.removalDifficulty, 0.01);

      if (score > bestScore) {
        bestScore = score;
        bestId = nodeId;
      }
    }

    if (!bestId) {
      // remaining leaves have no removable upstream source
      for (const id of uncovered) {
        const node = graph.nodes.find(n => n.id === id);
        if (node) irremovable.push(node);
      }
      break;
    }

    const node = graph.nodes.find(n => n.id === bestId)!;
    removalOrder.push(node);

    const covers = coverMap.get(bestId) ?? new Set();
    for (const c of covers) uncovered.delete(c);
  }

  const totalCascade = removalOrder.reduce((sum, node) => {
    return sum + (cascadeMap.get(node.id)?.length ?? 0);
  }, 0);

  return { removalOrder, cascadeMap, totalCascade, irremovable };
}
