// quantify — information-theoretic exposure measurement
export {
  shannonEntropy,
  minEntropy,
  anonymitySetSize,
  selfInfo,
  independentExposure,
  conditionalMI,
  uniquenessThreshold,
  isUnique,
  uniqueProbability,
  removalGain,
  greedyRemovalOrder,
} from './quantify/entropy.js';

export {
  fieldEntropy,
  fieldCorrelation,
  populationModel,
  totalExposureBits,
  estimateFrequency,
  buildDistribution,
} from './quantify/population.js';

export {
  buildIdentityGraph,
  findComponents,
  computeMaxFlow,
  findMinCut,
} from './quantify/graph.js';

export { generateReport } from './quantify/report.js';

// strategy — record linkage
export {
  fieldWeight,
  computeLinkage,
  jaroWinkler,
} from './strategy/linkage.js';

// monitor — re-emergence prediction
export {
  predictReemergence,
  monitoringSchedule,
} from './monitor/reemergence.js';

// legal — request generation
export {
  generateRequest,
  generateDmcaRequest,
} from './legal/request.js';

// dilution — synthetic identity generation
export {
  generateSyntheticProfiles,
  dilutionKAnonymity,
  dilutionEntropyGain,
} from './dilution/synthetic.js';

// types
export type {
  QuasiIdentifier,
  QIField,
  ExposureRecord,
  LinkEdge,
  IdentityGraph,
  AttributeExposure,
  ExposureReport,
  RemovalStep,
  Jurisdiction,
  PopulationModel,
  FrequencyDistribution,
} from './quantify/types.js';

export type {
  FieldComparison,
  LinkageResult,
} from './strategy/linkage.js';

export type {
  ReemergenceEstimate,
} from './monitor/reemergence.js';

export type {
  RemovalRequest,
  RequesterInfo,
} from './legal/request.js';

export type {
  SyntheticProfile,
  DilutionConfig,
} from './dilution/synthetic.js';
