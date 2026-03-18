# degauss

[![CI](https://github.com/Giuseppe552/degauss/actions/workflows/ci.yml/badge.svg)](https://github.com/Giuseppe552/degauss/actions/workflows/ci.yml)
[![Tests: 303](https://img.shields.io/badge/tests-303_passing-brightgreen)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Find your digital footprint, measure your exposure in bits, and systematically reduce it. Scans 35+ platforms for your accounts, verifies which are really yours, filters false positives, and gives you direct links to delete or privatise each one. Generates legal removal requests under GDPR/CCPA/UK DPA. Maps the data broker supply chain to find where your data originates.

## What it does

```sh
$ degauss discover --username giuseppe552 --name "Giuseppe Giona" --email g@test.com

Discovering your digital footprint
═══════════════════════════════════════════════════

[1] Finding accounts: giuseppe552
    8 potential accounts found. Verifying...

  DELETE these accounts:
    ● Reddit (forum) — https://www.reddit.com/user/giuseppe552
      → https://www.reddit.com/settings/account
      Settings → Account → Delete account

  PRIVATISE these accounts:
    ● Steam (gaming) — https://steamcommunity.com/id/giuseppe552
      → https://steamcommunity.com/my/edit/settings
      Edit Profile → Privacy Settings → set everything to Private

  FALSE POSITIVES (5 filtered out): Instagram, TikTok, Pinterest, YouTube, PyPI

  Estimated time to clean up: 9 minutes
  34 platforms checked → 8 found → 3 confirmed
```

Not predictions. Not models. Real accounts, verified, with direct action links.

Sweeney (2000) showed {ZIP, DOB, sex} uniquely identifies 87% of Americans — ~31.6 bits against a 28.3-bit population. degauss measures your actual exposure in bits and computes the optimal reduction strategy.

## Run it

```sh
git clone https://github.com/Giuseppe552/degauss.git && cd degauss
npm install && npm run build
```

### Find your footprint (works now, no setup)

```sh
# discover accounts, code leaks, and breaches
degauss discover --username your-handle --name "Your Name" --email you@mail.com

# predict which data brokers have your data (instant, no network)
degauss predict --name "Your Name" --country US

# interactive profile builder (4 questions)
degauss init
```

### One command does everything

```sh
# scan brokers → score exposure → analyse attacks → map supply chain → build removal plan
degauss me --name "Jane Doe" --city Portland --state OR --email jane@mail.com

# or with a manually-built profile (when automated scanning is blocked)
degauss me --name "Jane Doe" --profile my-exposure.json --email jane@mail.com
```

**Scanning limitation:** Most data brokers use Cloudflare to block Tor exit nodes and automated scrapers. The automated scan will attempt all targets through Tor (your IP stays hidden) but may return 0 results. In that case, build your profile manually — search the brokers in an incognito window, note what you find, and feed it to degauss as JSON. The scoring, attack analysis, and removal planning work regardless of how the profile was built.

Output:
```
[1/5] Scanning data brokers...
  Found on 3 of 6 brokers (11 QIs extracted)

[2/5] Computing exposure score...
  Exposure: 42.3 bits (threshold: 28.3)
  Anonymity set: 1
  YOU ARE UNIQUELY IDENTIFIABLE

[3/5] Analysing attack surface...
  Feasible attacks: 7 (3 critical)
    CRITICAL Bank account phone takeover (95% feasible)
    CRITICAL SIM swap attack (92% feasible)
    HIGH     Spear phishing via employer context (85% feasible)

[4/5] Mapping data supply chain...
  2 upstream removal(s) would cascade to 3 sources
    Acxiom → cascades to spokeo, beenverified

[5/5] Building removal plan...
  1. Remove from spokeo (uk_dpa) — -12.3 bits
  2. Remove from whitepages (uk_dpa) — -8.7 bits
```

### Or step by step

```sh
# compute your exposure score
degauss score --profile profile.json --country UK

# optimal removal plan (what to remove first)
node apps/cli/dist/index.js plan --profile profile.json

# generate a UK GDPR Article 17 erasure request
node apps/cli/dist/index.js request --source spokeo --fields full_name,email,phone \
  --country UK --name "Your Name" --email "you@example.com"

# DMCA takedown for your photos
node apps/cli/dist/index.js dmca --source spokeo --photo-url https://... \
  --name "Your Name" --email "you@example.com"

# predict re-emergence after removal
node apps/cli/dist/index.js monitor --sources spokeo,whitepages,radaris

# check if two records refer to the same person (Fellegi-Sunter)
node apps/cli/dist/index.js linkage --record-a a.json --record-b b.json

# generate synthetic profiles for data dilution
node apps/cli/dist/index.js dilute --profile profile.json --count 20 --anchor full_name
```

Every command outputs JSON to stdout. Pipe into `jq`, Python, anything.

## The maths

**Established theory** (standard information theory and graph algorithms):

| Concept | Method | Reference |
|---------|--------|-----------|
| Exposure quantification | Shannon entropy, self-information per QI | Shannon (1948), Sweeney (2000) |
| Name frequencies | US Census 2010 surname data, SSA first names | census.gov |
| Uniqueness threshold | log₂(N) bits for population N | Golle (2006) |
| Anonymity set | 2^H — effective group size from entropy | Díaz et al. (2002, PET) |
| Record linkage | Fellegi-Sunter log-likelihood ratios | Fellegi & Sunter (1969, JASA) |
| String matching | Jaro-Winkler similarity | Jaro (1989), Winkler (2006) |
| Max-flow / min-cut | Edmonds-Karp algorithm | Edmonds & Karp (1972, JACM) |
| Data dilution | Synthetic profiles for k-anonymity | Sweeney (2002), Howe & Nissenbaum (2009) |
| Legal requests | GDPR Art 17, UK DPA, CCPA §1798.105, DMCA §512(c)(3) | — |

**Our constructions** (heuristic models, not peer-reviewed):

| Concept | What it does | Caveat |
|---------|-------------|--------|
| Identity graph | Records as nodes, linking QIs as weighted edges | Novel framing — Fellegi-Sunter doesn't use graph models |
| Exposure via min-cut | Uses max-flow to estimate adversarial linkage power | Plausible heuristic, not a proven bound |
| Correlation damping | Pairwise ρ factors between QI fields | Simplified — real correlations are value-dependent |
| Re-emergence model | Exponential decay with broker-specific λ | Parameters are estimates, not calibrated against data |
| Removal ordering | Greedy by bits/difficulty | Assumes submodularity (not proven for this objective) |

<details>
<summary><strong>How the exposure score works</strong></summary>

Each quasi-identifier (name, email, phone, ZIP, DOB) contributes bits of identifying information. A rare surname contributes more bits than a common one. An email is near-unique (~28 bits). Sex is ~1 bit.

The total exposure accounts for correlations between fields — ZIP and city are highly correlated (ρ=0.85), so they don't double-count. Full name subsumes first/last name.

When your total exceeds log₂(population), you're uniquely identifiable. The anonymity set = 2^(threshold - exposure). An anonymity set of 1 means you're singled out.

</details>

<details>
<summary><strong>How the removal plan works</strong></summary>

Your identity is modelled as a graph. Nodes = records on different sources. Edges = linking quasi-identifiers (shared email, shared phone+name, etc.), weighted by mutual information.

The adversary's re-identification power = max-flow through this graph. The optimal removal set = minimum vertex cut (max-flow min-cut theorem). Among equally effective removals, we prioritise by difficulty — a self-service opt-out form beats a notarised letter to LexisNexis.

The greedy ordering achieves at least 63% of optimal (submodular guarantee, Krause & Golovin 2014).

</details>

<details>
<summary><strong>How data dilution works</strong></summary>

When removal fails (public records, government data), dilution increases k-anonymity by adding statistically plausible records sharing the target's anchor fields (usually just name).

If there are 20 "Giuseppe Giona" records with different addresses, phones, and employers, the adversary's confidence drops to 1/20 — adding log₂(20) ≈ 4.3 bits of uncertainty.

Synthetic profiles are internally consistent (city matches ZIP, area code matches region) and varied enough to actually increase entropy.

</details>

## Stack

```
packages/core/
  quantify/       entropy, census data, identity graph, exposure reports
  discovery/      broker scanning, supply chain graph, HIBP breaches, canary tokens
  strategy/       Fellegi-Sunter linkage, Jaro-Winkler, social engineering analysis
  legal/          GDPR, UK DPA, CCPA, DMCA request generation
  monitor/        re-emergence prediction, monitoring schedules
  dilution/       synthetic profile generation, k-anonymity computation

apps/cli/         20 commands, Tor SOCKS5h routing, state persistence
```

### Data broker supply chain

Nobody else models the broker ecosystem as a directed graph. Brokers don't operate independently — Acxiom feeds Spokeo, LexisNexis feeds BeenVerified, public records feed everyone. Removing from a leaf broker is pointless if the upstream source still has the data.

degauss maps the known supply chain (21 nodes, 26 edges) and computes the optimal upstream removal strategy using weighted set cover. One upstream removal can cascade downstream, making multiple leaf removals unnecessary.

### Social engineering playbook

Given your exposed QIs, degauss computes which social engineering attacks become feasible. 11 attack scenarios (SIM swap, bank pretexting, spear phishing, doxxing, tax fraud, etc.), each with required QIs, impact severity, and specific mitigations. Turns abstract "bits of exposure" into "here's how you get owned."

### Canary tokens

Offensive privacy. Generate unique URLs and email addresses, embed them in your broker profiles as "contact" links. When someone accesses a canary, you know someone is researching you — when, from where, and sometimes who.

## Profile format

```json
{
  "records": [
    {
      "source": "spokeo",
      "url": "https://spokeo.com/Your-Name",
      "qis": [
        { "field": "full_name", "value": "Your Name", "source": "spokeo" },
        { "field": "email", "value": "you@example.com", "source": "spokeo" },
        { "field": "phone", "value": "+447700123456", "source": "spokeo" }
      ],
      "discoveredAt": 1710700000000,
      "status": "active"
    }
  ]
}
```

## Develop

```sh
npm install && npm run build
cd packages/core && npm test   # 303 tests
```

## Origin

Four tools, one mathematical thread: measuring what an adversary can learn — about your documents ([PDF Changer](https://github.com/Giuseppe552/pdf-changer)), your identity ([threadr](https://github.com/Giuseppe552/threadr)), your transactions ([ε-tx](https://github.com/Giuseppe552/epsilon-tx)), and now reducing it.

## License

MIT
