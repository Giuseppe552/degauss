/** A quasi-identifier — one attribute that contributes to re-identification.
 * name+city is two QIs, not one. Each has independent entropy. */
export interface QuasiIdentifier {
  /** what kind of attribute: name, dob, zip, email, phone, address, etc. */
  field: QIField;
  /** the actual value — "Giuseppe Giona", "M25 1AB", "1998-03-15" */
  value: string;
  /** where this was found — broker name, URL, or "self-reported" */
  source: string;
  /** estimated population frequency of this value, if known */
  frequency?: number;
}

export type QIField =
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'dob'
  | 'birth_year'
  | 'sex'
  | 'email'
  | 'phone'
  | 'zip'
  | 'city'
  | 'state'
  | 'country'
  | 'address'
  | 'employer'
  | 'job_title'
  | 'username'
  | 'ip_address'
  | 'device_id'
  | 'photo'
  | 'ssn_last4'
  | 'other';

/** A record found on a specific source — one row in a data broker, one social profile */
export interface ExposureRecord {
  /** where: "spokeo", "whitepages", "beenverified", "linkedin", etc. */
  source: string;
  /** URL where the record was found, if available */
  url?: string;
  /** quasi-identifiers present in this record */
  qis: QuasiIdentifier[];
  /** when this record was discovered */
  discoveredAt: number;
  /** removal status */
  status: 'active' | 'removal_requested' | 'removed' | 'reappeared';
}

/** Edge in the identity graph — a linking relationship between two records */
export interface LinkEdge {
  /** index of source record */
  from: number;
  /** index of target record */
  to: number;
  /** which QI fields link these records */
  linkingFields: QIField[];
  /** mutual information contributed by this link (bits) */
  mutualInfo: number;
}

/** The identity graph: records as nodes, linking QIs as edges */
export interface IdentityGraph {
  records: ExposureRecord[];
  edges: LinkEdge[];
  /** total information the adversary can extract (max-flow, bits) */
  maxFlow: number;
  /** connected components — each is a linkable identity cluster */
  components: number[][];
}

/** Per-attribute breakdown of exposure */
export interface AttributeExposure {
  field: QIField;
  /** how many bits this attribute contributes to identification,
   * conditional on what the adversary already knows */
  exposureBits: number;
  /** how many sources expose this attribute */
  sourceCount: number;
  /** estimated cost/difficulty of removal (0-1 scale) */
  removalDifficulty: number;
  /** information gain per unit difficulty — higher = remove first */
  efficiency: number;
}

/** The complete exposure report */
export interface ExposureReport {
  /** total bits of identifying information exposed */
  totalBits: number;
  /** bits needed to uniquely identify in the reference population */
  uniquenessThreshold: number;
  /** effective anonymity set size: 2^(threshold - totalBits), floored at 1 */
  anonymitySet: number;
  /** is the subject uniquely identifiable? totalBits >= threshold */
  uniquelyIdentifiable: boolean;
  /** per-attribute breakdown, sorted by efficiency (best removal target first) */
  attributes: AttributeExposure[];
  /** the identity graph */
  graph: IdentityGraph;
  /** recommended removal sequence */
  removalPlan: RemovalStep[];
}

/** One step in the optimal removal plan */
export interface RemovalStep {
  /** which record to target */
  recordIndex: number;
  /** which source */
  source: string;
  /** which QI fields to request removal of */
  fields: QIField[];
  /** estimated bits of exposure reduced */
  bitsReduced: number;
  /** cumulative anonymity set after this removal */
  anonymitySetAfter: number;
  /** which jurisdiction's law applies */
  jurisdiction: Jurisdiction;
}

export type Jurisdiction = 'gdpr' | 'uk_dpa' | 'ccpa' | 'state_us' | 'dmca' | 'unknown';

/** Population model for computing uniqueness */
export interface PopulationModel {
  /** total population size */
  size: number;
  /** marginal frequency distributions for each QI field */
  distributions: Partial<Record<QIField, FrequencyDistribution>>;
}

export interface FrequencyDistribution {
  /** map of value → frequency (probability) */
  frequencies: Map<string, number>;
  /** entropy of this distribution (bits) */
  entropy: number;
}
