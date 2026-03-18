# Contributing to degauss

## Quick start

```sh
git clone https://github.com/Giuseppe552/degauss.git
cd degauss && npm install
cd packages/core && npx vitest run   # 253 tests should pass
```

## Where to help

**Broker patterns break constantly.** Data brokers change their HTML structure to block scrapers. If a scan target returns empty results, the extraction regex needs updating. This is the highest-impact contribution — file a [broker pattern issue](https://github.com/Giuseppe552/degauss/issues/new?template=broker_pattern.md) or submit a PR with the updated pattern.

**New scan targets.** The scanner currently covers 6 brokers. There are 4,000+. Adding a new `ScanTarget` definition to `packages/core/src/discovery/scraper.ts` is straightforward — you need the search URL template and regex extractors for the results page.

**Census data.** The frequency lookup covers the top 50 US surnames and 60 first names. More data = better exposure scoring. The US Census Bureau publishes 162,000 surnames at [census.gov](https://www.census.gov/topics/population/genealogy/data/2010_surnames.html).

**Supply chain edges.** If you have evidence that broker A feeds broker B (e.g., you removed from A and B's data disappeared), add the edge to `packages/core/src/discovery/supplychain.ts`.

## Code style

- TypeScript strict mode. No `any` in production code.
- Zero runtime dependencies in `packages/core`. Keep it that way.
- Tests verify mathematical properties, not just "function runs." If you add entropy code, test non-negativity, monotonicity, boundary values.
- Comments explain WHY. Code explains WHAT.
- Terse names: `selfInfo`, `fieldEntropy`, `computeMaxFlow`. Context makes them clear.

## Testing

```sh
cd packages/core && npx vitest run        # all tests
cd packages/core && npx vitest run entropy # specific file
cd apps/cli && npx tsc --noEmit           # typecheck CLI
```

Every PR must pass all existing tests. New features need tests.

## Architecture

```
packages/core/     zero-dependency library (all the maths)
  quantify/        entropy, census data, identity graph, exposure reports
  discovery/       broker scanning, supply chain, HIBP, canary tokens, SERP, archive
  strategy/        record linkage, social engineering analysis
  legal/           request generation, escalation complaints
  monitor/         re-emergence prediction, verification, monitoring daemon
  dilution/        synthetic profile generation

apps/cli/          Node.js CLI (16 commands)
```

`packages/core` has no IO, no network calls, no file system access. All side effects are in `apps/cli`. The core library is designed to be embeddable in other tools.

## Adding a new broker

```typescript
// packages/core/src/discovery/scraper.ts
{
  id: 'newbroker',
  name: 'NewBroker',
  searchUrl: 'https://newbroker.com/search?name={name}&location={city}+{state}',
  extractors: [
    { field: 'full_name', pattern: /<h2 class="name">([^<]+)<\/h2>/i },
    { field: 'phone', pattern: /href="tel:([+\d\-]+)"/i },
    // add extractors for each QI the broker displays
  ],
  delayMs: 4000,      // be respectful
  requiresJS: false,   // true if the page needs JS rendering
  removalDifficulty: 0.3,
}
```

Test with: `degauss scan --name "Jane Doe" --targets newbroker`

## Commit style

Lowercase, present tense. `add whitepages phone extractor` or `fix spokeo search URL`.
