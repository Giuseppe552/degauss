/**
 * Interactive profile builder.
 *
 * `degauss init` asks plain questions and builds the profile JSON.
 * No hand-crafting JSON. No reading source code to understand the schema.
 *
 * Uses Node's built-in readline — zero dependencies.
 */

import { createInterface } from 'node:readline';
import type { ExposureRecord, QIField } from '@degauss/core';

const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
const CYN = '\x1b[36m', GRN = '\x1b[32m', YEL = '\x1b[33m';

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

/** Run the interactive profile builder. Returns ExposureRecord[]. */
export async function runWizard(): Promise<{
  records: ExposureRecord[];
  name: string;
  city?: string;
  state?: string;
  country: string;
  email?: string;
}> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error(`\n${B}degauss — build your exposure profile${R}`);
  console.error(`${D}Answer these questions to compute your exposure score.${R}`);
  console.error(`${D}Press Enter to skip any question.${R}\n`);

  // basic identity
  const name = await ask(rl, `${CYN}Full name${R} (as it appears on public records): `);
  if (!name) {
    console.error(`${YEL}Name is required.${R}`);
    rl.close();
    process.exit(1);
  }

  const city = await ask(rl, `${CYN}City${R} (where you live or last lived): `);
  const state = await ask(rl, `${CYN}State/Region${R}: `);
  const country = (await ask(rl, `${CYN}Country${R} [US/UK/other]: `)) || 'US';
  const email = await ask(rl, `${CYN}Email address${R} (if publicly findable): `);
  const phone = await ask(rl, `${CYN}Phone number${R} (if listed anywhere): `);
  const address = await ask(rl, `${CYN}Street address${R} (if on public records): `);
  const dob = await ask(rl, `${CYN}Date of birth${R} (YYYY-MM-DD, if findable): `);
  const employer = await ask(rl, `${CYN}Current employer${R} (if on LinkedIn/public): `);
  const jobTitle = await ask(rl, `${CYN}Job title${R}: `);

  console.error(`\n${D}Now — which sites have your data? Answer y/n for each.${R}\n`);

  const brokers = [
    'Spokeo', 'WhitePages', 'BeenVerified', 'TruePeopleSearch',
    'FastPeopleSearch', 'LinkedIn', 'Radaris', 'Intelius', 'Pipl',
  ];

  const foundOn: string[] = [];
  for (const broker of brokers) {
    const answer = await ask(rl, `  ${broker}? [y/n/unsure]: `);
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      foundOn.push(broker.toLowerCase().replace(/\s/g, ''));
    }
  }

  // if they don't know, assume the major ones
  if (foundOn.length === 0) {
    const defaultAnswer = await ask(rl, `\n${YEL}You said none — assume major US brokers likely have your data?${R} [y/n]: `);
    if (defaultAnswer.toLowerCase() !== 'n') {
      foundOn.push('spokeo', 'whitepages', 'beenverified', 'truepeoplesearch');
      console.error(`${D}  Assuming: Spokeo, WhitePages, BeenVerified, TruePeopleSearch${R}`);
    }
  }

  rl.close();

  // build records
  const records: ExposureRecord[] = [];

  for (const source of foundOn.length > 0 ? foundOn : ['self-reported']) {
    const qis: Array<{ field: QIField; value: string; source: string }> = [];

    if (name) qis.push({ field: 'full_name', value: name, source });
    if (city) qis.push({ field: 'city', value: city, source });
    if (state) qis.push({ field: 'state', value: state, source });
    if (email) qis.push({ field: 'email', value: email, source });
    if (phone) qis.push({ field: 'phone', value: phone, source });
    if (address) qis.push({ field: 'address', value: address, source });
    if (employer) qis.push({ field: 'employer', value: employer, source });
    if (jobTitle) qis.push({ field: 'job_title', value: jobTitle, source });
    if (dob) {
      qis.push({ field: 'dob', value: dob, source });
      qis.push({ field: 'birth_year', value: dob.slice(0, 4), source });
    }

    records.push({
      source,
      qis,
      discoveredAt: Date.now(),
      status: 'active',
    });
  }

  const nameParts = name.split(/\s+/);
  // add individual name components for better frequency analysis
  if (nameParts.length >= 2) {
    for (const rec of records) {
      rec.qis.push({ field: 'first_name', value: nameParts[0], source: rec.source });
      rec.qis.push({ field: 'last_name', value: nameParts[nameParts.length - 1], source: rec.source });
    }
  }

  console.error(`\n${GRN}Profile built: ${records.length} records, ${records[0]?.qis.length ?? 0} fields each.${R}`);

  return { records, name, city: city || undefined, state: state || undefined, country, email: email || undefined };
}
