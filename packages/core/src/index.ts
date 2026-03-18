// quantify — information-theoretic exposure measurement
export {
  shannonEntropy,
  minEntropy,
  anonymitySetSize,
  selfInfo,
  independentExposure,
  heuristicExposure,
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
  findMinVertexCut,
} from './quantify/graph.js';

export { generateReport } from './quantify/report.js';

export {
  surnameFrequency,
  firstNameFrequency,
  fullNameFrequency,
  zipFrequency,
} from './quantify/census.js';

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

// discovery — automated scanning, supply chain, breaches, canaries
export {
  SCAN_TARGETS,
  buildSearchUrl,
  extractQIs,
  scanTarget,
  scanAll,
  resultsToRecords,
} from './discovery/scraper.js';

export {
  getSupplyChain,
  findUpstream,
  findDownstream,
  computeUpstreamStrategy,
} from './discovery/supplychain.js';

export {
  checkBreaches,
  checkPassword,
  checkMultipleBreaches,
} from './discovery/breaches.js';

export {
  createUrlCanary,
  createEmailCanary,
  createDnsCanary,
  createCanarySet,
  canaryStats,
} from './discovery/canary.js';

export {
  positionWeight,
  classifyResult,
  parseGoogleSerp,
  analyseSerpResults,
} from './discovery/serp.js';

export {
  parseCdxResponse,
  buildCdxUrl,
  buildGoogleCacheUrl,
  checkWayback,
  archiveForensics,
} from './discovery/archive.js';

// monitor — verification and continuous monitoring
export {
  createTracker,
  computeDeadline,
  verifyRemoval,
  shouldVerifyNow,
  dueForVerification,
} from './monitor/verification.js';

export {
  createState,
  computeDelta,
  generateAlerts,
  updateState,
  exposureTrend,
} from './monitor/daemon.js';

// legal — escalation
export { generateEscalation } from './legal/escalation.js';

export {
  checkPlatform,
  enumerateUsername,
  getAllPlatforms,
} from './discovery/username.js';

export {
  verifyAccount,
  verifyAllAccounts,
  buildRemediationPlan,
} from './discovery/verify.js';

export {
  searchGitHubCode,
  codeSearchReport,
} from './discovery/codesearch.js';

export {
  predictBrokerCoverage,
  predictAllBrokers,
  expectedExposure,
  getAllBrokers,
} from './discovery/coverage.js';

// strategy — social engineering analysis
export {
  analyseAttackSurface,
  attackSummary,
} from './strategy/socialeng.js';

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

export type {
  DaemonState,
  ExposureSnapshot,
  MonitorAlert,
} from './monitor/daemon.js';

export type {
  RemovalTracker,
  VerificationResult,
} from './monitor/verification.js';

export type {
  SerpReport,
  SerpResult,
  ResultCategory,
} from './discovery/serp.js';

export type {
  ArchiveReport,
  CachedSnapshot,
} from './discovery/archive.js';

export type {
  SupplyChainGraph,
  SupplyNode,
  UpstreamStrategy,
} from './discovery/supplychain.js';

export type {
  AttackScenario,
} from './strategy/socialeng.js';

export type {
  BreachCheckResult,
  PasswordCheckResult,
} from './discovery/breaches.js';

export type {
  CanaryToken,
} from './discovery/canary.js';

export type {
  EscalationComplaint,
} from './legal/escalation.js';

export type {
  ScanResult,
  ScanConfig,
} from './discovery/scraper.js';
