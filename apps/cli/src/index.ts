#!/usr/bin/env node

/**
 * degauss CLI — identity attack surface reduction
 *
 * One command to start:
 *   degauss scan --name "Jane Doe" --city Portland --state OR
 *
 * 16 commands total — see `degauss --help`
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAnonFetch, checkTor, printOpsecStatus } from './proxy.js';
import { runWizard } from './wizard.js';
import {
  // scoring
  generateReport,
  // scanning
  scanAll, resultsToRecords, SCAN_TARGETS,
  // SERP
  analyseSerpResults, parseGoogleSerp,
  // archive
  archiveForensics,
  // supply chain
  getSupplyChain, findUpstream, findDownstream, computeUpstreamStrategy,
  // social engineering
  analyseAttackSurface, attackSummary,
  // canary
  createCanarySet, canaryStats,
  // breaches
  checkBreaches, checkPassword, checkMultipleBreaches,
  // legal
  generateRequest, generateDmcaRequest,
  // escalation
  generateEscalation,
  // coverage prediction
  predictAllBrokers, expectedExposure,
  // username enumeration
  enumerateUsername,
  // verification + remediation
  verifyAllAccounts, buildRemediationPlan,
  // code search
  codeSearchReport,
  // verification
  createTracker, verifyRemoval, dueForVerification,
  // monitoring
  createState, computeDelta, generateAlerts, updateState, exposureTrend,
  // linkage
  computeLinkage,
  // re-emergence
  predictReemergence, monitoringSchedule,
  // dilution
  generateSyntheticProfiles, dilutionKAnonymity, dilutionEntropyGain,
} from '@degauss/core';
import type {
  ExposureRecord, QIField, RequesterInfo, DaemonState, ExposureSnapshot,
} from '@degauss/core';

// ─── colours ───────────────────────────────────────────────────────────
const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
const RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', CYN = '\x1b[36m';

// ─── state persistence ────────────────────────────────────────────────
const STATE_DIR = join(homedir(), '.degauss');
const STATE_FILE = join(STATE_DIR, 'state.json');

function loadState(): DaemonState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch { return null; }
}

function saveState(state: DaemonState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

// ─── arg parsing ──────────────────────────────────────────────────────
function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? '';
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = val;
    }
  }
  return { command, flags };
}

/** Only output JSON when --json flag is set or stdout is piped (not a TTY) */
function jsonOut(data: any): void {
  if (wantJson) {
    console.log(JSON.stringify(data, null, 2));
  }
}

let wantJson = false;

function requireFlag(flags: Record<string, string>, key: string, label?: string): string {
  const v = flags[key];
  if (!v) {
    console.error(`${RED}error:${R} --${key} required${label ? ` (${label})` : ''}`);
    process.exit(1);
  }
  return v;
}

function readJsonFile(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function parseProfile(data: any): ExposureRecord[] {
  if (Array.isArray(data)) return data;
  if (data.records) return data.records;
  const fields = Object.entries(data)
    .filter(([k]) => !['source', 'url', 'status'].includes(k))
    .map(([field, value]) => ({ field: field as QIField, value: String(value), source: data.source ?? 'self-reported' }));
  return [{ source: data.source ?? 'self-reported', url: data.url, qis: fields, discoveredAt: Date.now(), status: 'active' as const }];
}

// ─── usage ────────────────────────────────────────────────────────────
function usage(): void {
  console.log(`
${B}degauss${R} — identity attack surface reduction

${D}Get started:${R}
  ${CYN}init${R}          ${D}interactive profile builder (asks questions, no JSON needed)${R}
  ${CYN}me${R}            ${D}full pipeline: scan + score + attacks + plan (one command)${R}
  ${CYN}predict${R}       ${D}predict which brokers have your data (no scanning needed)${R}

${D}Discovery:${R}
  ${CYN}discover${R}      ${D}find your accounts, code leaks, and breaches (works now)${R}
  ${CYN}scan${R}          ${D}scan data brokers (Tor required, Cloudflare may block)${R}
  ${CYN}serp${R}          ${D}analyse Google search results for your name${R}
  ${CYN}breaches${R}      ${D}check emails against HIBP breach database${R}
  ${CYN}archive${R}       ${D}check Wayback Machine for cached broker pages${R}

${D}Analysis:${R}
  ${CYN}score${R}         ${D}compute exposure score from profile or scan${R}
  ${CYN}plan${R}          ${D}optimal removal plan (what to remove first)${R}
  ${CYN}attacks${R}       ${D}social engineering attack feasibility${R}
  ${CYN}supply-chain${R}  ${D}broker data supply chain analysis${R}
  ${CYN}linkage${R}       ${D}check if two records refer to the same person${R}

${D}Action:${R}
  ${CYN}request${R}       ${D}generate legal removal request (GDPR/CCPA/UK DPA)${R}
  ${CYN}dmca${R}          ${D}generate DMCA takedown for photos${R}
  ${CYN}canary${R}        ${D}generate canary tokens for counter-intelligence${R}
  ${CYN}dilute${R}        ${D}generate synthetic profiles for k-anonymity${R}

${D}Monitoring:${R}
  ${CYN}verify${R}        ${D}check if a removal request was honoured${R}
  ${CYN}watch${R}         ${D}continuous monitoring (single scan + delta)${R}
  ${CYN}history${R}       ${D}show exposure trend over time${R}

${D}Quick start:${R}
  ${B}degauss discover --username giuseppe552 --email you@mail.com${R}  ${D}← find your footprint${R}
  ${B}degauss init${R}                                                   ${D}← build exposure profile${R}
  ${B}degauss predict --name "Jane Doe" --country US${R}                 ${D}← instant prediction${R}

${D}All commands output JSON to stdout. Pipe into jq, python, anything.${R}
`);
}

// ─── scan ─────────────────────────────────────────────────────────────
async function cmdScan(flags: Record<string, string>): Promise<void> {
  const name = requireFlag(flags, 'name', 'your full name');
  const city = flags.city;
  const state = flags.state;
  const country = flags.country ?? 'US';
  const clearnet = flags.clearnet === 'true';

  console.error(`\n${B}Scanning data brokers...${R}`);
  console.error(`${D}  Target: ${name}${city ? `, ${city}` : ''}${state ? `, ${state}` : ''}${R}`);
  console.error(`${D}  Brokers: ${SCAN_TARGETS.length} targets${R}`);

  // OPSEC: enforce Tor unless --clearnet explicitly set
  console.error(`\n${D}OPSEC check:${R}`);
  const torStatus = await checkTor();
  printOpsecStatus(torStatus, clearnet);

  if (!torStatus.available && !clearnet) {
    process.exit(1);
  }

  const fetchFn = createAnonFetch({
    tor: torStatus.available && !clearnet,
    proxyUrl: flags.proxy,
  });
  console.error();

  const results = await scanAll({
    name, city, state,
    skipJS: flags.browser !== 'true',
    fetchFn,
  });

  for (const r of results) {
    const icon = r.found ? `${GRN}FOUND${R}` : r.error ? `${YEL}SKIP${R}` : `${D}clean${R}`;
    console.error(`  ${r.target.name.padEnd(22)} ${icon}${r.found ? ` (${r.record!.qis.length} QIs)` : ''}${r.error ? ` ${D}${r.error}${R}` : ''}`);
  }

  const records = resultsToRecords(results);
  console.error(`\n${D}  Found ${records.length} records across ${results.filter(r => r.found).length} brokers${R}`);

  if (records.length > 0) {
    const report = generateReport(records, country);
    const color = report.uniquelyIdentifiable ? RED : GRN;
    console.error(`\n${B}Exposure Summary${R}`);
    console.error(`  Total: ${B}${report.totalBits.toFixed(1)} bits${R} | Anonymity set: ${color}${report.anonymitySet}${R} | ${color}${report.uniquelyIdentifiable ? 'UNIQUELY IDENTIFIABLE' : 'Not unique'}${R}`);

    // save to state for future watch/verify commands
    const st = loadState() ?? createState({ name, city, state, country });
    const snapshot: ExposureSnapshot = {
      date: new Date().toISOString(),
      totalBits: report.totalBits,
      anonymitySet: report.anonymitySet,
      recordCount: records.length,
      activeSources: records.map(r => r.source),
    };
    saveState(updateState(st, records, snapshot));
    console.error(`${D}  State saved to ${STATE_FILE}${R}`);
  }

  jsonOut(records);
}

// ─── score ────────────────────────────────────────────────────────────
function cmdScore(flags: Record<string, string>): void {
  const profilePath = flags.profile;
  let records: ExposureRecord[];

  if (profilePath) {
    records = parseProfile(readJsonFile(profilePath));
  } else {
    const state = loadState();
    if (!state || state.currentRecords.length === 0) {
      console.error(`${RED}error:${R} --profile required, or run 'degauss scan' first`);
      process.exit(1);
    }
    records = state.currentRecords;
    console.error(`${D}  Using ${records.length} records from last scan${R}`);
  }

  const country = flags.country ?? 'UK';
  const report = generateReport(records, country);

  console.error(`\n${B}Exposure Report${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  const color = report.uniquelyIdentifiable ? RED : GRN;
  console.error(`  Total exposure:       ${B}${report.totalBits.toFixed(1)} bits${R}`);
  console.error(`  Uniqueness threshold: ${report.uniquenessThreshold.toFixed(1)} bits`);
  console.error(`  Anonymity set:        ${color}${report.anonymitySet}${R}`);
  console.error(`  Uniquely identifiable: ${color}${report.uniquelyIdentifiable ? 'YES' : 'NO'}${R}`);

  if (report.attributes.length > 0) {
    console.error(`\n${B}  Per-attribute exposure:${R}`);
    for (const attr of report.attributes.slice(0, 10)) {
      const bar = '\u2588'.repeat(Math.min(Math.round(attr.exposureBits), 30));
      console.error(`    ${attr.field.padEnd(15)} ${CYN}${attr.exposureBits.toFixed(1).padStart(5)} bits${R}  ${D}${bar}${R}  ${D}(${attr.sourceCount} sources)${R}`);
    }
  }

  jsonOut(report);
}

// ─── plan ─────────────────────────────────────────────────────────────
function cmdPlan(flags: Record<string, string>): void {
  let records: ExposureRecord[];
  if (flags.profile) {
    records = parseProfile(readJsonFile(flags.profile));
  } else {
    const state = loadState();
    if (!state?.currentRecords.length) { console.error(`${RED}error:${R} --profile or run scan first`); process.exit(1); }
    records = state.currentRecords;
  }

  const report = generateReport(records, flags.country ?? 'UK');
  console.error(`\n${B}Optimal Removal Plan${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  Current: ${RED}${report.totalBits.toFixed(1)} bits${R} | Anonymity set: ${report.anonymitySet}\n`);

  for (let i = 0; i < report.removalPlan.length; i++) {
    const s = report.removalPlan[i];
    console.error(`  ${B}${i + 1}.${R} ${CYN}${s.source}${R} — ${s.fields.join(', ')} — ${GRN}-${s.bitsReduced} bits${R} → anon set: ${s.anonymitySetAfter}`);
  }

  jsonOut(report.removalPlan);
}

// ─── attacks ──────────────────────────────────────────────────────────
function cmdAttacks(flags: Record<string, string>): void {
  let fields: QIField[];
  if (flags.profile) {
    const records = parseProfile(readJsonFile(flags.profile));
    fields = [...new Set(records.flatMap(r => r.qis.map(q => q.field)))];
  } else {
    const state = loadState();
    if (!state?.currentRecords.length) { console.error(`${RED}error:${R} --profile or run scan first`); process.exit(1); }
    fields = [...new Set(state.currentRecords.flatMap(r => r.qis.map(q => q.field)))];
  }

  const scenarios = analyseAttackSurface(fields);
  const summary = attackSummary(scenarios);

  console.error(`\n${B}Social Engineering Attack Surface${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  Exposed fields: ${fields.join(', ')}`);
  console.error(`  Feasible attacks: ${RED}${summary.fullyFeasible}${R} (${summary.criticalFeasible} critical)`);
  console.error();

  for (const s of scenarios.filter(s => s.feasibility >= 0.5)) {
    const color = s.impact === 'critical' ? RED : s.impact === 'high' ? YEL : D;
    const bar = '\u2588'.repeat(Math.round(s.feasibility * 10));
    console.error(`  ${color}${s.impact.toUpperCase().padEnd(8)}${R} ${bar.padEnd(10)} ${B}${s.name}${R}`);
    console.error(`           ${D}${s.description.slice(0, 100)}${R}`);
    console.error(`           ${GRN}Mitigate: ${s.mitigation.slice(0, 100)}${R}`);
    console.error();
  }

  jsonOut({ summary, scenarios });
}

// ─── supply-chain ─────────────────────────────────────────────────────
function cmdSupplyChain(flags: Record<string, string>): void {
  const sourcesStr = flags.sources;

  if (sourcesStr) {
    const sources = sourcesStr.split(',').map(s => s.trim());
    const strategy = computeUpstreamStrategy(sources);

    console.error(`\n${B}Supply Chain Analysis${R}`);
    console.error(`${D}─────────────────────────────────${R}`);
    console.error(`  Leaf brokers: ${sources.join(', ')}`);
    console.error(`  Optimal upstream removals: ${strategy.removalOrder.length}`);
    console.error(`  Total cascade: ${strategy.totalCascade} downstream sources affected`);
    console.error();

    for (const node of strategy.removalOrder) {
      const cascade = strategy.cascadeMap.get(node.id) ?? [];
      console.error(`  ${CYN}${node.name}${R} (${node.type}) — difficulty: ${node.removalDifficulty}`);
      console.error(`    ${D}Cascades to: ${cascade.join(', ')}${R}`);
    }

    if (strategy.irremovable.length > 0) {
      console.error(`\n  ${RED}Irremovable sources:${R}`);
      for (const n of strategy.irremovable) {
        console.error(`    ${n.name} (${n.type})`);
      }
    }

    jsonOut(strategy);
  } else {
    // show the full graph
    const graph = getSupplyChain();
    console.error(`\n${B}Data Broker Supply Chain${R}`);
    console.error(`  ${graph.nodes.length} sources, ${graph.edges.length} data flows`);
    jsonOut(graph);
  }
}

// ─── breaches ─────────────────────────────────────────────────────────
async function cmdBreaches(flags: Record<string, string>): Promise<void> {
  const email = requireFlag(flags, 'email');
  const apiKey = flags['hibp-key'] ?? flags['api-key'];

  if (!apiKey) {
    console.error(`${YEL}warning:${R} no --hibp-key provided. Email breach check requires a free HIBP API key.`);
    console.error(`${D}  Get one at: https://haveibeenpwned.com/API/Key${R}`);
    console.error(`${D}  Password check works without a key.${R}\n`);
  }

  console.error(`${B}Checking breaches for ${email}...${R}`);
  const result = await checkBreaches(email, apiKey);

  if (result.breached) {
    console.error(`\n  ${RED}BREACHED${R} — found in ${result.breachCount} breaches`);
    for (const b of result.breaches.slice(0, 10)) {
      console.error(`    ${CYN}${b.name}${R} (${b.breachDate}) — ${b.dataClasses.join(', ')}`);
    }
  } else {
    console.error(`\n  ${GRN}CLEAN${R} — not found in any known breaches`);
  }

  // password check (optional)
  if (flags.password) {
    const pw = await checkPassword(flags.password);
    if (pw.pwned) {
      console.error(`\n  ${RED}PASSWORD PWNED${R} — found ${pw.occurrences.toLocaleString()} times in breach databases`);
    } else {
      console.error(`\n  ${GRN}PASSWORD CLEAN${R} — not found in any breach database`);
    }
  }

  jsonOut(result);
}

// ─── serp ─────────────────────────────────────────────────────────────
function cmdSerp(flags: Record<string, string>): void {
  const name = requireFlag(flags, 'name');
  const ownedStr = flags.owned ?? '';
  const owned = ownedStr ? ownedStr.split(',').map(s => s.trim()) : [];

  // SERP requires pre-fetched results (Google scraping is unreliable)
  // Accept results from a JSON file or suggest manual approach
  if (flags.results) {
    const rawResults = readJsonFile(flags.results);
    const report = analyseSerpResults(name, rawResults, owned);

    console.error(`\n${B}SERP Analysis: "${name}"${R}`);
    console.error(`${D}─────────────────────────────────${R}`);
    console.error(`  Total results: ${report.totalResults}`);
    console.error(`  Page 1 score: ${report.page1Score > 3 ? RED : report.page1Score > 1 ? YEL : GRN}${report.page1Score}/10${R}`);
    console.error(`  Data brokers on page 1: ${RED}${report.page1Brokers.length}${R} (${report.page1Brokers.join(', ') || 'none'})`);
    console.error(`  Your properties: ${report.ownedProperties.length}`);
    console.error();

    for (const r of report.results.slice(0, 15)) {
      const catColor = r.category === 'data_broker' ? RED
        : r.category === 'owned_property' ? GRN
        : r.category === 'social_media' ? CYN : D;
      console.error(`  ${String(r.position).padStart(2)}. ${catColor}[${r.category}]${R} ${r.title.slice(0, 60)}`);
      console.error(`      ${D}${r.url.slice(0, 80)}${R}`);
    }

    jsonOut(report);
  } else {
    console.error(`\n${B}SERP Analysis${R}`);
    console.error(`${D}─────────────────────────────────${R}`);
    console.error(`  Google blocks automated scraping. To analyse your SERP:`);
    console.error(`  1. Google "${name}" in an incognito window`);
    console.error(`  2. Save results as JSON: [{title, url, snippet}, ...]`);
    console.error(`  3. Run: degauss serp --name "${name}" --results serp.json`);
    console.error(`\n  ${D}Or use a search API (SerpAPI, Serper) and pipe the results.${R}`);
  }
}

// ─── archive ──────────────────────────────────────────────────────────
async function cmdArchive(flags: Record<string, string>): Promise<void> {
  let urls: string[];

  if (flags.urls) {
    urls = flags.urls.split(',').map(s => s.trim());
  } else {
    // pull URLs from last scan state
    const state = loadState();
    if (!state?.currentRecords.length) {
      console.error(`${RED}error:${R} --urls required, or run 'degauss scan' first`);
      process.exit(1);
    }
    urls = state.currentRecords.filter(r => r.url).map(r => r.url!);
    console.error(`${D}  Using ${urls.length} URLs from last scan${R}`);
  }

  console.error(`\n${B}Archive Forensics${R}`);
  console.error(`${D}  Checking Wayback Machine for ${urls.length} URLs...${R}\n`);

  const report = await archiveForensics(urls);

  for (const url of report.zombies) {
    const snaps = report.snapshots.filter(s => s.originalUrl === url);
    console.error(`  ${RED}ZOMBIE${R} ${url}`);
    console.error(`    ${D}${snaps.length} cached snapshots (newest: ${snaps[0]?.timestamp ?? 'unknown'})${R}`);
  }
  for (const url of report.clean) {
    console.error(`  ${GRN}CLEAN${R}  ${url}`);
  }

  console.error(`\n  ${D}Total: ${report.zombies.length} zombies, ${report.clean.length} clean, ${report.totalSnapshots} snapshots${R}`);
  jsonOut(report);
}

// ─── canary ───────────────────────────────────────────────────────────
function cmdCanary(flags: Record<string, string>): void {
  const brokersStr = requireFlag(flags, 'brokers', 'comma-separated broker IDs');
  const domain = flags.domain ?? 'example.com';
  const brokers = brokersStr.split(',').map(s => s.trim());

  const canaries = createCanarySet(brokers, {
    urlDomain: domain,
    emailDomain: domain,
  });

  console.error(`\n${B}Canary Tokens${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  Generated ${canaries.length} canaries for ${brokers.length} brokers\n`);

  for (const c of canaries) {
    const icon = c.type === 'url' ? '\u{1f517}' : '\u{2709}';
    console.error(`  ${CYN}${c.plantedIn}${R} [${c.type}] ${c.value}`);
  }

  console.error(`\n${D}  Plant these in your broker profiles as contact links.${R}`);
  console.error(`${D}  When accessed, you'll know someone is researching you.${R}`);
  console.error(`${D}  Set up a webhook at ${domain} to receive trigger alerts.${R}`);

  jsonOut(canaries);
}

// ─── request ──────────────────────────────────────────────────────────
function cmdRequest(flags: Record<string, string>): void {
  const source = requireFlag(flags, 'source');
  const fieldsStr = requireFlag(flags, 'fields');
  const name = requireFlag(flags, 'name', 'your full name for the legal request');
  const email = requireFlag(flags, 'email', 'your email for the legal request');
  const country = flags.country ?? 'UK';
  const fields = fieldsStr.split(',').map(f => f.trim()) as QIField[];

  const req = generateRequest({ fullName: name, email, country, address: flags.address }, source, fields, flags.url, flags.recipient);

  console.error(`\n${B}${req.jurisdiction.toUpperCase()} Removal Request${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  To: ${req.recipient}`);
  console.error(`  Deadline: ${req.deadlineDays} days`);
  console.error(`  Penalty: ${req.penalty}`);

  // track the removal in state
  const state = loadState();
  if (state) {
    const record: ExposureRecord = {
      source, url: flags.url, qis: fields.map(f => ({ field: f, value: '', source })),
      discoveredAt: Date.now(), status: 'removal_requested',
    };
    const tracker = createTracker(source, record, req.jurisdiction as any);
    state.removals.push(tracker);
    saveState(state);
    console.error(`${D}  Tracked — verify with 'degauss verify' after ${req.deadlineDays} days${R}`);
  }

  console.log(req.body);
}

// ─── dmca ─────────────────────────────────────────────────────────────
function cmdDmca(flags: Record<string, string>): void {
  const photoUrl = requireFlag(flags, 'photo-url');
  const name = requireFlag(flags, 'name', 'your name (copyright owner)');
  const email = requireFlag(flags, 'email');
  const source = flags.source ?? 'unknown';

  const req = generateDmcaRequest({ fullName: name, email, country: flags.country ?? 'UK' }, source, photoUrl, flags.recipient);
  console.error(`\n${B}DMCA Takedown Notice${R}`);
  console.error(`  To: ${req.recipient} | Photo: ${photoUrl}`);
  console.log(req.body);
}

// ─── verify ───────────────────────────────────────────────────────────
async function cmdVerify(flags: Record<string, string>): Promise<void> {
  const state = loadState();
  if (!state) { console.error(`${RED}error:${R} no state — run 'degauss scan' and 'degauss request' first`); process.exit(1); }

  const due = dueForVerification(state.removals);

  if (due.length === 0) {
    console.error(`\n${GRN}No removals due for verification.${R}`);
    if (state.removals.length > 0) {
      console.error(`${D}  ${state.removals.length} tracked removals — next deadline: ${state.removals.sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt))[0].deadlineAt.slice(0, 10)}${R}`);
    }
    return;
  }

  console.error(`\n${B}Verifying ${due.length} removal(s)...${R}\n`);

  for (const tracker of due) {
    console.error(`  ${CYN}${tracker.source}${R} (requested ${tracker.requestedAt.slice(0, 10)}, deadline ${tracker.deadlineAt.slice(0, 10)})`);

    // re-scan the broker through Tor
    const torSt = await checkTor();
    const vFetch = createAnonFetch({ tor: torSt.available });
    const results = await scanAll({
      name: state.profile.name,
      city: state.profile.city,
      state: state.profile.state,
      targets: [tracker.source],
      skipJS: true,
      fetchFn: vFetch,
    });

    const records = resultsToRecords(results);
    const afterRecord = records.find(r => r.source === tracker.source) ?? null;
    const result = verifyRemoval(tracker, afterRecord);

    if (result.fullyRemoved) {
      console.error(`    ${GRN}REMOVED${R} — all fields deleted`);
    } else {
      console.error(`    ${RED}STILL PRESENT${R} — ${result.remainingFields.join(', ')}`);
      if (result.shouldEscalate) {
        console.error(`    ${RED}DEADLINE PASSED${R} — generating escalation complaint...`);
        const complaint = generateEscalation(result, state.profile.name, '');
        console.error(`    ${D}File complaint at: ${complaint.submissionUrl}${R}`);
      }
    }
  }

  saveState(state);
}

// ─── watch ────────────────────────────────────────────────────────────
async function cmdWatch(flags: Record<string, string>): Promise<void> {
  const name = flags.name;
  const country = flags.country ?? 'US';

  let state = loadState();
  if (!state && !name) {
    console.error(`${RED}error:${R} --name required for first watch, or run 'degauss scan' first`);
    process.exit(1);
  }

  if (!state) {
    state = createState({ name: name!, city: flags.city, state: flags.state, country });
  }

  const clearnet = flags.clearnet === 'true';
  console.error(`\n${B}Monitoring scan: ${state.profile.name}${R}`);
  console.error(`${D}─────────────────────────────────${R}`);

  const torStatus = await checkTor();
  if (!torStatus.available && !clearnet) {
    printOpsecStatus(torStatus, false);
    process.exit(1);
  }
  const fetchFn = createAnonFetch({ tor: torStatus.available && !clearnet });

  const results = await scanAll({
    name: state.profile.name,
    city: state.profile.city,
    state: state.profile.state,
    skipJS: true,
    fetchFn,
  });

  const records = resultsToRecords(results);
  const report = generateReport(records, state.profile.country);

  const snapshot: ExposureSnapshot = {
    date: new Date().toISOString(),
    totalBits: report.totalBits,
    anonymitySet: report.anonymitySet,
    recordCount: records.length,
    activeSources: records.map(r => r.source),
  };

  const previousSnapshot = state.history[0] ?? null;
  const delta = computeDelta(state.currentRecords, records, state.removals);
  const alerts = generateAlerts(delta, previousSnapshot, snapshot);

  // display alerts
  if (alerts.length > 0) {
    console.error(`\n${B}Alerts:${R}`);
    for (const a of alerts) {
      const color = a.severity === 'critical' ? RED : a.severity === 'high' ? RED : a.severity === 'medium' ? YEL : D;
      console.error(`  ${color}[${a.severity.toUpperCase()}]${R} ${a.message}`);
    }
  }

  // display delta
  console.error(`\n${B}Delta:${R}`);
  console.error(`  New records: ${delta.newRecords.length}`);
  console.error(`  Removed: ${delta.removedRecords.length}`);
  console.error(`  Reappearances: ${delta.reappearances.length}`);
  console.error(`  Exposure: ${report.totalBits.toFixed(1)} bits | Anonymity set: ${report.anonymitySet}`);

  if (previousSnapshot) {
    const bitsDelta = report.totalBits - previousSnapshot.totalBits;
    const dir = bitsDelta < -1 ? `${GRN}improving` : bitsDelta > 1 ? `${RED}worsening` : `${D}stable`;
    console.error(`  Trend: ${dir}${R} (${bitsDelta > 0 ? '+' : ''}${bitsDelta.toFixed(1)} bits since last scan)`);
  }

  state = updateState(state, records, snapshot);
  saveState(state);
  console.error(`\n${D}  State saved. Run this as a cron job: */6 * * * degauss watch --name "${state.profile.name}"${R}`);

  jsonOut({ snapshot, alerts, delta: { new: delta.newRecords.length, removed: delta.removedRecords.length, reappeared: delta.reappearances.length } });
}

// ─── history ──────────────────────────────────────────────────────────
function cmdHistory(_flags: Record<string, string>): void {
  const state = loadState();
  if (!state || state.history.length === 0) {
    console.error(`${RED}No scan history.${R} Run 'degauss scan' or 'degauss watch' first.`);
    process.exit(1);
  }

  const trend = exposureTrend(state.history);

  console.error(`\n${B}Exposure History: ${state.profile.name}${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  Scans: ${state.history.length} | Period: ${trend.periodDays} days`);
  const dir = trend.direction === 'improving' ? GRN : trend.direction === 'worsening' ? RED : D;
  console.error(`  Trend: ${dir}${trend.direction}${R} (${trend.bitsChange > 0 ? '+' : ''}${trend.bitsChange.toFixed(1)} bits)`);
  console.error(`  Tracked removals: ${state.removals.length}`);
  console.error();

  // show last 10 snapshots
  for (const s of state.history.slice(0, 10)) {
    const color = s.anonymitySet <= 1 ? RED : s.anonymitySet < 10 ? YEL : GRN;
    const bar = '\u2588'.repeat(Math.min(Math.round(s.totalBits / 5), 20));
    console.error(`  ${s.date.slice(0, 10)} ${D}${bar}${R} ${s.totalBits.toFixed(1)} bits | anon: ${color}${s.anonymitySet}${R} | ${s.recordCount} records`);
  }

  jsonOut({ trend, history: state.history });
}

// ─── linkage ──────────────────────────────────────────────────────────
function cmdLinkage(flags: Record<string, string>): void {
  const pathA = requireFlag(flags, 'record-a');
  const pathB = requireFlag(flags, 'record-b');
  const a = readJsonFile(pathA);
  const b = readJsonFile(pathB);
  const recordA = Object.entries(a).map(([field, value]) => ({ field: field as QIField, value: String(value) }));
  const recordB = Object.entries(b).map(([field, value]) => ({ field: field as QIField, value: String(value) }));
  const result = computeLinkage(recordA, recordB);

  const color = result.classification === 'match' ? RED : result.classification === 'possible' ? YEL : GRN;
  console.error(`\n${B}Record Linkage${R}: ${color}${result.classification}${R} (${(result.matchProbability * 100).toFixed(1)}%)`);
  for (const f of result.fields) {
    console.error(`  ${f.agrees ? GRN + '\u2713' : RED + '\u2717'}${R} ${f.field.padEnd(15)} ${f.weight > 0 ? '+' : ''}${f.weight.toFixed(1)}`);
  }
  jsonOut(result);
}

// ─── monitor (re-emergence predictions) ───────────────────────────────
function cmdMonitorPredict(flags: Record<string, string>): void {
  const sourcesStr = requireFlag(flags, 'sources', 'comma-separated broker names');
  const sources = sourcesStr.split(',').map(s => s.trim());
  const drop = flags.drop === 'true';

  console.error(`\n${B}Re-emergence Predictions${R}`);
  for (const source of sources) {
    const est = predictReemergence(source, { dropCompliant: drop });
    console.error(`  ${CYN}${source}${R}: reappear in ~${est.expectedDaysUntilReappearance}d | P(90d)=${RED}${(est.probabilities.days90 * 100).toFixed(0)}%${R} | recheck every ${est.recheckInterval}d`);
  }
  jsonOut(monitoringSchedule(sources, { dropCompliant: drop }));
}

// ─── dilute ───────────────────────────────────────────────────────────
function cmdDilute(flags: Record<string, string>): void {
  const profilePath = requireFlag(flags, 'profile');
  const data = readJsonFile(profilePath);
  const count = parseInt(flags.count ?? '20');
  const country = flags.country ?? 'UK';
  const anchorFields = (flags.anchor ?? 'full_name').split(',').map(f => f.trim()) as QIField[];

  const realProfile: Partial<Record<QIField, string>> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') realProfile[k as QIField] = v;
  }

  const profiles = generateSyntheticProfiles(realProfile, { count, anchorFields, targetK: count, country });
  const k = dilutionKAnonymity(realProfile, profiles);
  const gain = dilutionEntropyGain(1, k);

  console.error(`\n${B}Data Dilution${R}: k=${GRN}${k}${R}, +${GRN}${gain.toFixed(1)} bits${R} uncertainty`);
  jsonOut({ k, entropyGain: gain, profiles });
}

// ─── me (full pipeline) ───────────────────────────────────────────────
async function cmdMe(flags: Record<string, string>): Promise<void> {
  const name = requireFlag(flags, 'name', 'your full name');
  const email = flags.email;
  const city = flags.city;
  const st = flags.state;
  const country = flags.country ?? 'US';

  const clearnet = flags.clearnet === 'true';

  console.error(`\n${B}degauss: full exposure analysis${R}`);
  console.error(`${D}═══════════════════════════════════════════════════${R}`);
  console.error(`  Target: ${name}${city ? `, ${city}` : ''}${st ? `, ${st}` : ''}`);
  console.error(`  Country: ${country}\n`);

  // OPSEC: enforce Tor
  console.error(`${D}OPSEC check:${R}`);
  const torStatus = await checkTor();
  printOpsecStatus(torStatus, clearnet);
  if (!torStatus.available && !clearnet) { process.exit(1); }
  const fetchFn = createAnonFetch({ tor: torStatus.available && !clearnet, proxyUrl: flags.proxy });
  console.error();

  // ── step 1: scan brokers ──
  console.error(`${B}[1/5] Scanning data brokers...${R}`);
  const scanResults = await scanAll({ name, city, state: st, skipJS: true, fetchFn });
  const records = resultsToRecords(scanResults);
  const foundCount = scanResults.filter(r => r.found).length;
  console.error(`  Found on ${RED}${foundCount}${R} of ${scanResults.length} brokers (${records.reduce((s, r) => s + r.qis.length, 0)} QIs extracted)\n`);

  // ── step 2: score exposure ──
  console.error(`${B}[2/5] Computing exposure score...${R}`);
  if (records.length === 0 && !flags.profile) {
    console.error(`\n  ${YEL}No records found via automated scan.${R}`);
    console.error(`  ${D}Most brokers block Tor exit nodes with Cloudflare. This is expected.${R}`);
    console.error(`  ${D}To build your profile manually (takes 5 minutes):${R}`);
    console.error(`    ${D}1. Open an incognito browser window${R}`);
    console.error(`    ${D}2. Search your name on spokeo.com, whitepages.com, beenverified.com${R}`);
    console.error(`    ${D}3. Create a profile JSON with what you find (see examples/sample-profile.json)${R}`);
    console.error(`    ${D}4. Run: degauss me --name "${name}" --profile your-profile.json${R}\n`);
    jsonOut({ records: [], note: 'no broker records found — create a profile JSON or try --clearnet' });
    return;
  }
  const profileRecords = flags.profile ? parseProfile(readJsonFile(flags.profile)) : records;
  const report = generateReport(profileRecords, country);

  const expColor = report.uniquelyIdentifiable ? RED : GRN;
  console.error(`  Exposure: ${B}${report.totalBits.toFixed(1)} bits${R} (threshold: ${report.uniquenessThreshold.toFixed(1)})`);
  console.error(`  Anonymity set: ${expColor}${report.anonymitySet}${R}`);
  console.error(`  ${expColor}${report.uniquelyIdentifiable ? 'YOU ARE UNIQUELY IDENTIFIABLE' : 'Not uniquely identifiable'}${R}\n`);

  if (report.attributes.length > 0) {
    console.error(`  ${D}Top exposures:${R}`);
    for (const attr of report.attributes.slice(0, 5)) {
      console.error(`    ${attr.field.padEnd(15)} ${CYN}${attr.exposureBits.toFixed(1)} bits${R} (${attr.sourceCount} sources)`);
    }
    console.error();
  }

  // ── step 3: attack surface ──
  console.error(`${B}[3/5] Analysing attack surface...${R}`);
  const fields = [...new Set(records.flatMap(r => r.qis.map(q => q.field)))];
  const scenarios = analyseAttackSurface(fields);
  const summary = attackSummary(scenarios);
  console.error(`  Feasible attacks: ${RED}${summary.fullyFeasible}${R} (${summary.criticalFeasible} critical)`);

  for (const threat of summary.topThreats) {
    const tc = threat.impact === 'critical' ? RED : YEL;
    console.error(`    ${tc}${threat.impact.toUpperCase()}${R} ${threat.name} (${(threat.feasibility * 100).toFixed(0)}% feasible)`);
  }
  console.error();

  // ── step 4: supply chain ──
  console.error(`${B}[4/5] Mapping data supply chain...${R}`);
  const leafBrokers = records.map(r => r.source);
  if (leafBrokers.length > 0) {
    const strategy = computeUpstreamStrategy(leafBrokers);
    console.error(`  ${strategy.removalOrder.length} upstream removal(s) would cascade to ${strategy.totalCascade} sources`);
    for (const node of strategy.removalOrder.slice(0, 3)) {
      const cascade = strategy.cascadeMap.get(node.id) ?? [];
      console.error(`    ${CYN}${node.name}${R} → cascades to ${cascade.join(', ')}`);
    }
  } else {
    console.error(`  ${D}No broker records to trace${R}`);
  }
  console.error();

  // ── step 5: removal plan ──
  console.error(`${B}[5/5] Building removal plan...${R}`);
  if (report.removalPlan.length > 0) {
    for (let i = 0; i < Math.min(report.removalPlan.length, 5); i++) {
      const step = report.removalPlan[i];
      console.error(`  ${B}${i + 1}.${R} Remove from ${CYN}${step.source}${R} (${step.jurisdiction}) — ${GRN}-${step.bitsReduced} bits${R}`);
    }
  } else {
    console.error(`  ${GRN}No removals needed${R}`);
  }

  // ── generate requests if email provided ──
  if (email && report.removalPlan.length > 0) {
    console.error(`\n${B}Generating removal requests...${R}`);
    for (const step of report.removalPlan) {
      const req = generateRequest(
        { fullName: name, email, country },
        step.source, step.fields, undefined, undefined
      );
      console.error(`  ${GRN}✓${R} ${req.jurisdiction.toUpperCase()} request for ${step.source} → ${req.recipient}`);
    }
    console.error(`\n${D}  Run 'degauss request --source <name> --fields <fields> --name "${name}" --email "${email}"' to see each request${R}`);
  }

  // ── save state ──
  const state = loadState() ?? createState({ name, city, state: st, country });
  const snapshot: ExposureSnapshot = {
    date: new Date().toISOString(),
    totalBits: report.totalBits,
    anonymitySet: report.anonymitySet,
    recordCount: records.length,
    activeSources: records.map(r => r.source),
  };
  saveState(updateState(state, records, snapshot));

  // ── summary ──
  console.error(`\n${B}═══════════════════════════════════════════════════${R}`);
  console.error(`${B}Summary${R}`);
  console.error(`  Exposure:     ${report.totalBits.toFixed(1)} bits`);
  console.error(`  Anonymity:    ${report.anonymitySet} people`);
  console.error(`  Attacks:      ${summary.fullyFeasible} feasible (${summary.criticalFeasible} critical)`);
  console.error(`  Brokers:      ${foundCount} with your data`);
  console.error(`  Next step:    ${report.removalPlan[0] ? `remove from ${report.removalPlan[0].source}` : 'none'}`);
  console.error(`${D}\n  State saved to ${STATE_FILE}`);
  console.error(`  Run 'degauss watch' to monitor changes over time${R}\n`);

  jsonOut({ report, attacks: summary, supplyChain: leafBrokers.length > 0 ? computeUpstreamStrategy(leafBrokers) : null });
}

// ─── init (interactive wizard) ─────────────────────────────────────────
async function cmdInit(flags: Record<string, string>): Promise<void> {
  const result = await runWizard();
  const outPath = flags.output ?? 'my-exposure.json';

  // save profile
  writeFileSync(outPath, JSON.stringify({ records: result.records }, null, 2));

  // save state
  const state = loadState() ?? createState({
    name: result.name, city: result.city, state: result.state, country: result.country,
  });
  const report = generateReport(result.records, result.country);
  const snapshot: ExposureSnapshot = {
    date: new Date().toISOString(),
    totalBits: report.totalBits,
    anonymitySet: report.anonymitySet,
    recordCount: result.records.length,
    activeSources: result.records.map(r => r.source),
  };
  saveState(updateState(state, result.records, snapshot));

  const fields = [...new Set(result.records.flatMap(r => r.qis.map(q => q.field)))];
  const scenarios = analyseAttackSurface(fields);
  const summary = attackSummary(scenarios);
  const exp = expectedExposure(result.name, result.country, fields);

  // ─── THE REPORT ───────────────────────────────────────────────────
  const e = console.error;
  const color = report.uniquelyIdentifiable ? RED : GRN;
  const line = '═══════════════════════════════════════════════════════';

  e(`\n${color}${line}${R}`);
  e(`${B}  EXPOSURE REPORT: ${result.name}${R}`);
  e(`${color}${line}${R}\n`);

  // ── HEADLINE ──
  e(`  ${B}${report.totalBits.toFixed(0)}${R} bits of identifying information exposed`);
  e(`  ${B}${report.anonymitySet === 1 ? `${RED}You are uniquely identifiable` : `${GRN}Anonymity set: ${report.anonymitySet} people`}${R}`);
  e(`  ${B}${summary.fullyFeasible}${R} social engineering attacks are feasible right now`);
  e(`  Your data is likely on ${B}${exp.expectedBrokers.toFixed(0)}${R} broker sites\n`);

  // ── WHAT AN ATTACKER CAN DO ──
  if (summary.fullyFeasible > 0) {
    e(`${RED}  IMMEDIATE THREATS${R}`);
    e(`${D}  ─────────────────────────────────${R}`);
    for (const s of scenarios.filter(s => s.feasibility >= 0.7).slice(0, 5)) {
      const ic = s.impact === 'critical' ? RED : YEL;
      e(`  ${ic}${s.impact.toUpperCase().padEnd(8)}${R}  ${B}${s.name}${R}`);
      e(`  ${D}          ${s.description.slice(0, 90)}${R}`);
      e(`  ${GRN}          Fix: ${s.mitigation.slice(0, 90)}${R}\n`);
    }
  }

  // ── WHERE TO REMOVE FIRST ──
  e(`${CYN}  REMOVE YOUR DATA (start here)${R}`);
  e(`${D}  ─────────────────────────────────${R}`);
  const topBrokers = report.removalPlan.slice(0, 5);
  for (let i = 0; i < topBrokers.length; i++) {
    const step = topBrokers[i];
    // find opt-out URL from coverage data
    const pred = exp.topBrokers.find(b => b.name.toLowerCase().replace(/\s/g, '') === step.source);
    e(`  ${B}${i + 1}.${R} ${CYN}${step.source}${R}`);
    e(`     ${D}Fields exposed: ${step.fields.join(', ')}${R}`);
    if (pred) e(`     ${D}Opt out: ${pred.optOutUrl}${R}`);
    e(`     ${GRN}Removing saves ${step.bitsReduced > 0 ? step.bitsReduced + ' bits' : 'reduces linkability'}${R}\n`);
  }

  // ── YOUR EXPOSURE BREAKDOWN ──
  e(`${D}  EXPOSURE BY FIELD${R}`);
  e(`${D}  ─────────────────────────────────${R}`);
  for (const attr of report.attributes.slice(0, 8)) {
    const bar = '\u2588'.repeat(Math.min(Math.round(attr.exposureBits), 25));
    e(`  ${attr.field.padEnd(15)} ${CYN}${attr.exposureBits.toFixed(1).padStart(5)}${R} bits  ${D}${bar}${R}  ${D}(${attr.sourceCount} sources)${R}`);
  }

  // ── DATA SUPPLY CHAIN ──
  const leafBrokers = result.records.map(r => r.source);
  if (leafBrokers.length > 1) {
    const strategy = computeUpstreamStrategy(leafBrokers);
    if (strategy.removalOrder.length > 0) {
      e(`\n${D}  DATA SUPPLY CHAIN${R}`);
      e(`${D}  ─────────────────────────────────${R}`);
      e(`  ${D}${strategy.removalOrder.length} upstream removal(s) cascade to ${strategy.totalCascade} downstream sources${R}`);
      for (const node of strategy.removalOrder.slice(0, 3)) {
        const cascade = strategy.cascadeMap.get(node.id) ?? [];
        e(`  ${CYN}${node.name}${R} ${D}→ cascades to: ${cascade.join(', ')}${R}`);
      }
    }
  }

  // ── NEXT ACTIONS ──
  e(`\n${B}  WHAT TO DO NOW${R}`);
  e(`${D}  ─────────────────────────────────${R}`);
  if (topBrokers.length > 0) {
    const firstSource = topBrokers[0].source;
    const firstPred = exp.topBrokers.find(b => b.name.toLowerCase().replace(/\s/g, '') === firstSource);
    e(`  ${GRN}1.${R} Go to ${firstPred?.optOutUrl ?? firstSource + ' opt-out page'} and request removal`);
  }
  e(`  ${GRN}2.${R} Generate legal requests: ${D}degauss request --source <broker> --fields full_name,email --name "${result.name}" --email your@email.com${R}`);
  e(`  ${GRN}3.${R} Set up monitoring: ${D}degauss watch${R}`);
  e(`  ${GRN}4.${R} Deep dive: ${D}degauss attacks${R}  |  ${D}degauss plan${R}  |  ${D}degauss supply-chain --sources ${leafBrokers.slice(0, 3).join(',')}${R}`);

  e(`\n${D}  Profile: ${outPath} | State: ${STATE_FILE}${R}\n`);

  jsonOut(report);
}

// ─── predict (statistical coverage without scanning) ──────────────────
function cmdPredict(flags: Record<string, string>): void {
  const name = requireFlag(flags, 'name');
  const country = flags.country ?? 'US';

  const predictions = predictAllBrokers(name, country);
  const exp = expectedExposure(name, country);

  console.error(`\n${B}Predicted Broker Coverage: ${name}${R}`);
  console.error(`${D}─────────────────────────────────${R}`);
  console.error(`  Expected on ${YEL}${exp.expectedBrokers.toFixed(1)}${R} of ${predictions.length} known brokers`);
  console.error(`  Expected exposure: ${YEL}${exp.expectedBits.toFixed(1)} bits${R}\n`);

  for (const p of predictions) {
    if (p.probability < 0.05) continue;
    const bar = '\u2588'.repeat(Math.round(p.probability * 10));
    const color = p.probability > 0.6 ? RED : p.probability > 0.3 ? YEL : D;
    console.error(`  ${color}${(p.probability * 100).toFixed(0).padStart(3)}%${R} ${bar.padEnd(10)} ${B}${p.broker.name}${R}`);
    console.error(`       ${D}Fields: ${p.likelyFields.join(', ')}${R}`);
    console.error(`       ${D}Opt out: ${p.optOutUrl}${R}`);
    console.error(`       ${D}Method: ${p.optOutMethod}${R}\n`);
  }

  jsonOut({ predictions: predictions.filter(p => p.probability > 0.05), expected: exp });
}

// ─── discover (real discovery — username + code + breaches) ───────────
async function cmdDiscover(flags: Record<string, string>): Promise<void> {
  const username = flags.username;
  const email = flags.email;
  const name = flags.name;

  if (!username && !email && !name) {
    console.error(`${RED}error:${R} at least one of --username, --email, or --name required`);
    process.exit(1);
  }

  const e = console.error;
  e(`\n${B}Discovering your digital footprint${R}`);
  e(`${D}═══════════════════════════════════════════════════${R}\n`);

  let totalFindings = 0;

  // ── username enumeration + verification ──
  if (username) {
    e(`${B}[1] Finding accounts: ${CYN}${username}${R}`);
    e(`${D}    Checking 35+ platforms...${R}\n`);

    const report = await enumerateUsername(username);
    const found = report.results.filter(r => r.exists);

    if (found.length === 0) {
      e(`    ${GRN}No accounts found for "${username}"${R}\n`);
    } else {
      e(`    ${D}${found.length} potential accounts found. Verifying...${R}\n`);

      // verify each account — check if it's really yours or a false positive
      const targetName = name ?? username;
      const verified = await verifyAllAccounts(found, targetName);
      const plan = buildRemediationPlan(verified);

      totalFindings += verified.filter(v => v.status !== 'false_positive').length;

      // show confirmed accounts with actions
      if (plan.toDelete.length > 0) {
        e(`  ${RED}DELETE these accounts:${R}`);
        for (const v of plan.toDelete) {
          e(`    ${RED}●${R} ${B}${v.platform}${R} ${D}(${v.category})${R} — ${D}${v.url}${R}`);
          if (v.action.type === 'delete') {
            e(`      ${GRN}→ ${v.action.url}${R}`);
            e(`      ${D}${v.action.instructions}${R}\n`);
          }
        }
      }

      if (plan.toPrivatise.length > 0) {
        e(`  ${YEL}PRIVATISE these accounts:${R}`);
        for (const v of plan.toPrivatise) {
          e(`    ${YEL}●${R} ${B}${v.platform}${R} ${D}(${v.category})${R} — ${D}${v.url}${R}`);
          if (v.action.type === 'privatise') {
            e(`      ${GRN}→ ${v.action.url}${R}`);
            e(`      ${D}${v.action.instructions}${R}\n`);
          }
        }
      }

      if (plan.toInvestigate.length > 0) {
        e(`  ${CYN}INVESTIGATE (might not be yours):${R}`);
        for (const v of plan.toInvestigate) {
          e(`    ${CYN}?${R} ${B}${v.platform}${R} — ${D}${v.url}${R}`);
          if (v.action.type === 'investigate') {
            e(`      ${D}${v.action.reason}${R}\n`);
          }
        }
      }

      if (plan.falsePositives.length > 0) {
        e(`  ${D}FALSE POSITIVES (${plan.falsePositives.length} filtered out): ${plan.falsePositives.map(f => f.platform).join(', ')}${R}\n`);
      }

      e(`  ${D}Estimated time to clean up: ${B}${plan.estimatedTimeMinutes} minutes${R}`);
      e(`  ${D}${report.platformsChecked} platforms checked → ${found.length} found → ${verified.filter(v => v.status !== 'false_positive').length} confirmed${R}`);

      if (report.exposedFields.length > 0) {
        e(`  ${YEL}Data exposed across platforms: ${report.exposedFields.join(', ')}${R}`);
      }
    }
    e();
  }

  // ── code search ──
  if (email || name) {
    const queries = [email, name].filter(Boolean) as string[];
    e(`${B}[2] Public code search${R}`);
    e(`${D}    Searching GitHub for your PII in public repos...${R}\n`);

    const codeReport = await codeSearchReport(queries);
    totalFindings += codeReport.totalResults;

    if (codeReport.totalResults > 0) {
      for (const r of codeReport.results.slice(0, 10)) {
        e(`    ${RED}LEAK${R}  ${B}${r.repo}${R} / ${r.filePath}`);
        e(`          ${D}${r.htmlUrl}${R}`);
        e(`          ${D}Type: ${r.leakType}${R}\n`);
      }
      e(`    ${RED}${codeReport.totalResults} files found across ${codeReport.affectedRepos.length} repos${R}`);
    } else {
      e(`    ${GRN}No PII found in public code${R}`);
    }
    e();
  }

  // ── breach check ──
  if (email) {
    e(`${B}[3] Credential exposure${R}`);
    e(`${D}    Checking breaches for ${email}...${R}\n`);

    const apiKey = flags['hibp-key'];
    const breachResult = await checkBreaches(email, apiKey);

    if (breachResult.breached) {
      totalFindings += breachResult.breachCount;
      e(`    ${RED}BREACHED${R} — found in ${B}${breachResult.breachCount}${R} data breaches\n`);
      for (const b of breachResult.breaches.slice(0, 8)) {
        e(`    ${RED}●${R} ${B}${b.name}${R} (${b.breachDate})`);
        e(`      ${D}Data exposed: ${b.dataClasses.join(', ')}${R}`);
      }
    } else if (apiKey) {
      e(`    ${GRN}No breaches found for ${email}${R}`);
    } else {
      e(`    ${YEL}Breach check requires HIBP API key (free): haveibeenpwned.com/API/Key${R}`);
      e(`    ${D}Add --hibp-key YOUR_KEY to check${R}`);
    }
    e();
  }

  // ── password check ──
  if (flags.password) {
    e(`${B}[4] Password exposure${R}\n`);
    const pwResult = await checkPassword(flags.password);
    if (pwResult.pwned) {
      totalFindings++;
      e(`    ${RED}PWNED${R} — this password appeared ${B}${pwResult.occurrences.toLocaleString()}${R} times in breach databases`);
      e(`    ${RED}Change it immediately on every service where you use it.${R}`);
    } else {
      e(`    ${GRN}Password not found in any known breach database${R}`);
    }
    e();
  }

  // ── summary ──
  e(`${D}═══════════════════════════════════════════════════${R}`);
  const summaryColor = totalFindings > 5 ? RED : totalFindings > 0 ? YEL : GRN;
  e(`${B}  ${summaryColor}${totalFindings} findings${R}${B} across all sources${R}`);
  if (totalFindings > 0) {
    e(`  ${D}Your digital footprint is traceable. Run 'degauss init' for a full exposure report.${R}`);
  } else {
    e(`  ${GRN}Minimal digital footprint detected.${R}`);
  }
  e();

  jsonOut({ username: username ?? null, findings: totalFindings });
}

// ─── main ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === '--version' || args[0] === '-v') {
  console.log('degauss 0.1.0');
  process.exit(0);
}

const { command, flags } = parseArgs(args);
wantJson = flags.json === 'true';

// async commands need top-level await wrapper
const asyncCommands: Record<string, (f: Record<string, string>) => Promise<void>> = {
  me: cmdMe,
  init: cmdInit,
  discover: cmdDiscover,
  scan: cmdScan,
  breaches: cmdBreaches,
  archive: cmdArchive,
  verify: cmdVerify,
  watch: cmdWatch,
};

const syncCommands: Record<string, (f: Record<string, string>) => void> = {
  predict: cmdPredict,
  score: cmdScore,
  plan: cmdPlan,
  attacks: cmdAttacks,
  'supply-chain': cmdSupplyChain,
  request: cmdRequest,
  dmca: cmdDmca,
  canary: cmdCanary,
  serp: cmdSerp,
  linkage: cmdLinkage,
  monitor: cmdMonitorPredict,
  dilute: cmdDilute,
  history: cmdHistory,
};

if (asyncCommands[command]) {
  asyncCommands[command](flags).catch(err => {
    console.error(`${RED}error:${R} ${err.message}`);
    process.exit(1);
  });
} else if (syncCommands[command]) {
  syncCommands[command](flags);
} else {
  usage();
}
