/**
 * Interactive profile builder.
 *
 * `degauss init` asks 4 questions max, then computes everything else
 * from census data and broker coverage models. No broker checkboxes.
 * No JSON. No reading docs.
 */

import { createInterface } from 'node:readline';
import {
  predictAllBrokers,
  expectedExposure,
} from '@degauss/core';
import type { ExposureRecord, QIField } from '@degauss/core';

const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
const CYN = '\x1b[36m', GRN = '\x1b[32m', YEL = '\x1b[33m', RED = '\x1b[31m';

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

export async function runWizard(): Promise<{
  records: ExposureRecord[];
  name: string;
  city?: string;
  state?: string;
  country: string;
  email?: string;
}> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error(`\n${B}degauss${R}\n`);

  // 4 questions. that's it.
  const name = await ask(rl, `  ${CYN}Name${R} (as it appears on public records): `);
  if (!name) { console.error(`${RED}  Name required.${R}`); rl.close(); process.exit(1); }

  const location = await ask(rl, `  ${CYN}City, Country${R} (e.g. Manchester, UK): `);
  const email = await ask(rl, `  ${CYN}Email${R} (if publicly findable, or skip): `);
  const extra = await ask(rl, `  ${CYN}Anything else exposed?${R} phone / address / employer (comma-separated, or skip): `);

  rl.close();

  // parse location
  const locParts = location.split(',').map(s => s.trim());
  const city = locParts[0] || undefined;
  const countryRaw = locParts[locParts.length - 1] || '';
  const country = ['uk', 'gb', 'united kingdom', 'england', 'scotland', 'wales']
    .includes(countryRaw.toLowerCase()) ? 'UK'
    : ['us', 'usa', 'united states'].includes(countryRaw.toLowerCase()) ? 'US'
    : countryRaw.toUpperCase() || 'US';
  const state = locParts.length === 3 ? locParts[1] : undefined;

  // parse extra fields
  const extraFields: Array<{ field: QIField; value: string }> = [];
  if (extra) {
    for (const item of extra.split(',').map(s => s.trim().toLowerCase())) {
      if (item.match(/phone|mobile|cell/)) extraFields.push({ field: 'phone', value: 'listed' });
      else if (item.match(/address|street|home/)) extraFields.push({ field: 'address', value: 'listed' });
      else if (item.match(/employer|company|work/)) extraFields.push({ field: 'employer', value: item });
      else if (item.match(/dob|birth|born/)) extraFields.push({ field: 'dob', value: 'listed' });
      else if (item.match(/linkedin/)) extraFields.push({ field: 'job_title', value: 'listed' });
    }
  }

  // use the coverage model to predict which brokers have this person
  const knownFields: QIField[] = ['full_name'];
  if (city) knownFields.push('city');
  if (email) knownFields.push('email');
  for (const ef of extraFields) knownFields.push(ef.field);

  const predictions = predictAllBrokers(name, country, knownFields);
  const likelyBrokers = predictions.filter(p => p.probability > 0.25);

  console.error(`\n${B}Predicted exposure${R}`);
  console.error(`${D}─────────────────────────────────${R}`);

  // build records from predictions — each likely broker becomes a record
  const records: ExposureRecord[] = [];
  const nameParts = name.split(/\s+/);

  for (const pred of likelyBrokers) {
    const qis: Array<{ field: QIField; value: string; source: string }> = [];

    // add the fields this broker typically has
    for (const field of pred.likelyFields) {
      let value = '';
      switch (field) {
        case 'full_name': value = name; break;
        case 'first_name': value = nameParts[0] ?? ''; break;
        case 'last_name': value = nameParts[nameParts.length - 1] ?? ''; break;
        case 'city': value = city ?? ''; break;
        case 'email': value = email ?? ''; break;
        default:
          // check if user mentioned this field
          const ef = extraFields.find(e => e.field === field);
          value = ef?.value ?? '';
          break;
      }
      if (value) {
        qis.push({ field, value, source: pred.broker.id });
      }
    }

    if (qis.length > 0) {
      records.push({
        source: pred.broker.id,
        qis,
        discoveredAt: Date.now(),
        status: 'active',
      });

      const prob = (pred.probability * 100).toFixed(0);
      console.error(`  ${prob.padStart(3)}% ${CYN}${pred.broker.name}${R} — ${qis.length} fields — opt out: ${D}${pred.optOutUrl}${R}`);
    }
  }

  // if no broker predictions, at least create a self-reported record
  if (records.length === 0) {
    const qis: Array<{ field: QIField; value: string; source: string }> = [
      { field: 'full_name', value: name, source: 'self-reported' },
    ];
    if (nameParts.length >= 2) {
      qis.push({ field: 'first_name', value: nameParts[0], source: 'self-reported' });
      qis.push({ field: 'last_name', value: nameParts[nameParts.length - 1], source: 'self-reported' });
    }
    if (city) qis.push({ field: 'city', value: city, source: 'self-reported' });
    if (email) qis.push({ field: 'email', value: email, source: 'self-reported' });
    for (const ef of extraFields) qis.push({ field: ef.field, value: ef.value, source: 'self-reported' });

    records.push({ source: 'self-reported', qis, discoveredAt: Date.now(), status: 'active' });
  }

  console.error(`\n${GRN}  ${records.length} probable broker records, ${records.reduce((s, r) => s + r.qis.length, 0)} fields total.${R}`);

  return { records, name, city, state, country, email: email || undefined };
}
