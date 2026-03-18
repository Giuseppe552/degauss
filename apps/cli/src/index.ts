#!/usr/bin/env node

/**
 * degauss CLI — identity attack surface reduction
 *
 * Commands:
 *   degauss score       compute your exposure score from a profile
 *   degauss plan        generate optimal removal plan
 *   degauss request     generate legal removal requests
 *   degauss dmca        generate DMCA takedown for photos
 *   degauss linkage     check if two records refer to the same person
 *   degauss monitor     predict re-emergence after removal
 *   degauss dilute      generate synthetic profiles for k-anonymity
 */

import { readFileSync } from 'node:fs';
import {
  generateReport,
  generateRequest,
  generateDmcaRequest,
  computeLinkage,
  predictReemergence,
  monitoringSchedule,
  generateSyntheticProfiles,
  dilutionKAnonymity,
  dilutionEntropyGain,
  uniquenessThreshold,
  anonymitySetSize,
  totalExposureBits,
} from '@degauss/core';
import type {
  ExposureRecord,
  QIField,
  RequesterInfo,
} from '@degauss/core';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

function usage(): void {
  console.log(`
${BOLD}degauss${RESET} — identity attack surface reduction

${DIM}Commands:${RESET}
  ${CYAN}score${RESET}     ${DIM}compute exposure from a profile JSON${RESET}
  ${CYAN}plan${RESET}      ${DIM}generate optimal removal plan${RESET}
  ${CYAN}request${RESET}   ${DIM}generate legal removal request${RESET}
  ${CYAN}dmca${RESET}      ${DIM}generate DMCA takedown for photos${RESET}
  ${CYAN}linkage${RESET}   ${DIM}check if two records match${RESET}
  ${CYAN}monitor${RESET}   ${DIM}predict re-emergence after removal${RESET}
  ${CYAN}dilute${RESET}    ${DIM}generate synthetic profiles${RESET}

${DIM}Usage:${RESET}
  degauss score --profile profile.json
  degauss plan --profile profile.json --country UK
  degauss request --source spokeo --fields name,email --country UK
  degauss dmca --source spokeo --photo-url https://...
  degauss linkage --record-a a.json --record-b b.json
  degauss monitor --sources spokeo,whitepages,beenverified
  degauss dilute --profile profile.json --count 20 --anchor name

${DIM}All commands output JSON to stdout. Pipe into jq, python, anything.${RESET}
`);
}

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? '';
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = val;
    }
  }
  return { command, flags };
}

function readJsonFile(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Parse a profile JSON into ExposureRecord[] */
function parseProfile(data: any): ExposureRecord[] {
  if (Array.isArray(data)) return data;
  if (data.records) return data.records;
  // single profile → single record
  const fields = Object.entries(data)
    .filter(([k]) => !['source', 'url', 'status'].includes(k))
    .map(([field, value]) => ({
      field: field as QIField,
      value: String(value),
      source: data.source ?? 'self-reported',
    }));
  return [{
    source: data.source ?? 'self-reported',
    url: data.url,
    qis: fields,
    discoveredAt: Date.now(),
    status: 'active' as const,
  }];
}

function cmdScore(flags: Record<string, string>): void {
  const profilePath = flags.profile;
  if (!profilePath) {
    console.error(`${RED}error:${RESET} --profile required`);
    process.exit(1);
  }

  const data = readJsonFile(profilePath);
  const records = parseProfile(data);
  const country = flags.country ?? 'UK';
  const report = generateReport(records, country);

  // human-readable summary
  console.error(`\n${BOLD}Exposure Report${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);

  const color = report.uniquelyIdentifiable ? RED : GREEN;
  console.error(`  Total exposure:     ${BOLD}${report.totalBits.toFixed(1)} bits${RESET}`);
  console.error(`  Uniqueness threshold: ${report.uniquenessThreshold.toFixed(1)} bits`);
  console.error(`  Anonymity set:      ${color}${report.anonymitySet}${RESET}`);
  console.error(`  Uniquely identifiable: ${color}${report.uniquelyIdentifiable ? 'YES' : 'NO'}${RESET}`);

  if (report.attributes.length > 0) {
    console.error(`\n${BOLD}  Per-attribute exposure:${RESET}`);
    for (const attr of report.attributes.slice(0, 10)) {
      const bar = '█'.repeat(Math.min(Math.round(attr.conditionalMI), 30));
      console.error(`    ${attr.field.padEnd(15)} ${CYAN}${attr.conditionalMI.toFixed(1).padStart(5)} bits${RESET}  ${DIM}${bar}${RESET}  ${DIM}(${attr.sourceCount} sources)${RESET}`);
    }
  }

  console.error(`\n${DIM}  Identity graph: ${report.graph.edges.length} edges, ${report.graph.components.length} components, max-flow ${report.graph.maxFlow.toFixed(1)} bits${RESET}`);

  // JSON to stdout
  console.log(JSON.stringify(report, null, 2));
}

function cmdPlan(flags: Record<string, string>): void {
  const profilePath = flags.profile;
  if (!profilePath) {
    console.error(`${RED}error:${RESET} --profile required`);
    process.exit(1);
  }

  const data = readJsonFile(profilePath);
  const records = parseProfile(data);
  const country = flags.country ?? 'UK';
  const report = generateReport(records, country);

  console.error(`\n${BOLD}Optimal Removal Plan${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);
  console.error(`  Current exposure: ${RED}${report.totalBits.toFixed(1)} bits${RESET} → anonymity set: ${report.anonymitySet}`);
  console.error();

  for (let i = 0; i < report.removalPlan.length; i++) {
    const step = report.removalPlan[i];
    console.error(`  ${BOLD}${i + 1}.${RESET} Remove from ${CYAN}${step.source}${RESET}`);
    console.error(`     Fields: ${step.fields.join(', ')}`);
    console.error(`     Bits reduced: ${GREEN}-${step.bitsReduced}${RESET}`);
    console.error(`     Anonymity after: ${step.anonymitySetAfter}`);
    console.error(`     Jurisdiction: ${step.jurisdiction}`);
    console.error();
  }

  console.log(JSON.stringify(report.removalPlan, null, 2));
}

function cmdRequest(flags: Record<string, string>): void {
  const source = flags.source;
  const fieldsStr = flags.fields;
  const country = flags.country ?? 'UK';
  const name = flags.name ?? 'Your Name';
  const email = flags.email ?? 'your@email.com';

  if (!source || !fieldsStr) {
    console.error(`${RED}error:${RESET} --source and --fields required`);
    process.exit(1);
  }

  const fields = fieldsStr.split(',').map(f => f.trim()) as QIField[];
  const requester: RequesterInfo = {
    fullName: name,
    email,
    country,
    address: flags.address,
  };

  const req = generateRequest(requester, source, fields, flags.url, flags.recipient);

  console.error(`\n${BOLD}${req.jurisdiction.toUpperCase()} Removal Request${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);
  console.error(`  To: ${req.recipient}`);
  console.error(`  Subject: ${req.subject}`);
  console.error(`  Deadline: ${req.deadlineDays} days`);
  console.error(`  Penalty: ${req.penalty}`);
  console.error();

  // print the request body to stdout (pipe to mail, etc.)
  console.log(req.body);
}

function cmdDmca(flags: Record<string, string>): void {
  const source = flags.source ?? 'unknown';
  const photoUrl = flags['photo-url'];
  const name = flags.name ?? 'Your Name';
  const email = flags.email ?? 'your@email.com';

  if (!photoUrl) {
    console.error(`${RED}error:${RESET} --photo-url required`);
    process.exit(1);
  }

  const req = generateDmcaRequest(
    { fullName: name, email, country: flags.country ?? 'UK' },
    source, photoUrl, flags.recipient
  );

  console.error(`\n${BOLD}DMCA Takedown Notice${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);
  console.error(`  To: ${req.recipient}`);
  console.error(`  Photo: ${photoUrl}`);
  console.error();

  console.log(req.body);
}

function cmdLinkage(flags: Record<string, string>): void {
  const pathA = flags['record-a'];
  const pathB = flags['record-b'];

  if (!pathA || !pathB) {
    console.error(`${RED}error:${RESET} --record-a and --record-b required`);
    process.exit(1);
  }

  const a = readJsonFile(pathA);
  const b = readJsonFile(pathB);

  const recordA = Object.entries(a).map(([field, value]) => ({
    field: field as QIField,
    value: String(value),
  }));
  const recordB = Object.entries(b).map(([field, value]) => ({
    field: field as QIField,
    value: String(value),
  }));

  const result = computeLinkage(recordA, recordB);

  console.error(`\n${BOLD}Record Linkage Analysis${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);

  const color = result.classification === 'match' ? RED
    : result.classification === 'possible' ? YELLOW : GREEN;
  console.error(`  Classification: ${color}${BOLD}${result.classification}${RESET}`);
  console.error(`  Match probability: ${(result.matchProbability * 100).toFixed(1)}%`);
  console.error(`  Composite weight: ${result.compositeWeight.toFixed(2)} bits`);
  console.error();

  for (const f of result.fields) {
    const icon = f.agrees ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.error(`  ${icon} ${f.field.padEnd(15)} weight: ${f.weight > 0 ? '+' : ''}${f.weight.toFixed(2)}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

function cmdMonitor(flags: Record<string, string>): void {
  const sourcesStr = flags.sources;
  if (!sourcesStr) {
    console.error(`${RED}error:${RESET} --sources required (comma-separated)`);
    process.exit(1);
  }

  const sources = sourcesStr.split(',').map(s => s.trim());
  const dropCompliant = flags.drop === 'true';

  console.error(`\n${BOLD}Re-emergence Predictions${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);

  for (const source of sources) {
    const est = predictReemergence(source, { dropCompliant });
    console.error(`\n  ${CYAN}${source}${RESET}`);
    console.error(`    Refresh cycle: ${est.refreshDays} days`);
    console.error(`    Expected reappearance: ${est.expectedDaysUntilReappearance} days`);
    console.error(`    P(reappear by 30d): ${YELLOW}${(est.probabilities.days30 * 100).toFixed(0)}%${RESET}`);
    console.error(`    P(reappear by 90d): ${RED}${(est.probabilities.days90 * 100).toFixed(0)}%${RESET}`);
    console.error(`    Recheck every: ${est.recheckInterval} days`);
  }

  const schedule = monitoringSchedule(sources, { dropCompliant });
  console.log(JSON.stringify(schedule, null, 2));
}

function cmdDilute(flags: Record<string, string>): void {
  const profilePath = flags.profile;
  if (!profilePath) {
    console.error(`${RED}error:${RESET} --profile required`);
    process.exit(1);
  }

  const data = readJsonFile(profilePath);
  const count = parseInt(flags.count ?? '20');
  const country = flags.country ?? 'UK';
  const anchorStr = flags.anchor ?? 'full_name';
  const anchorFields = anchorStr.split(',').map(f => f.trim()) as QIField[];

  const realProfile: Partial<Record<QIField, string>> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') realProfile[k as QIField] = v;
  }

  const profiles = generateSyntheticProfiles(realProfile, {
    count,
    anchorFields,
    targetK: count,
    country,
  });

  const k = dilutionKAnonymity(realProfile, profiles);
  const gain = dilutionEntropyGain(1, k);

  console.error(`\n${BOLD}Data Dilution Report${RESET}`);
  console.error(`${DIM}─────────────────────────────────${RESET}`);
  console.error(`  Synthetic profiles: ${count}`);
  console.error(`  k-anonymity achieved: ${GREEN}${k}${RESET}`);
  console.error(`  Entropy gain: ${GREEN}+${gain.toFixed(1)} bits${RESET}`);
  console.error(`  Anchor fields: ${anchorFields.join(', ')}`);
  console.error();

  console.log(JSON.stringify({ k, entropyGain: gain, profiles }, null, 2));
}

// main
const args = process.argv.slice(2);
const { command, flags } = parseArgs(args);

switch (command) {
  case 'score': cmdScore(flags); break;
  case 'plan': cmdPlan(flags); break;
  case 'request': cmdRequest(flags); break;
  case 'dmca': cmdDmca(flags); break;
  case 'linkage': cmdLinkage(flags); break;
  case 'monitor': cmdMonitor(flags); break;
  case 'dilute': cmdDilute(flags); break;
  default: usage(); break;
}
