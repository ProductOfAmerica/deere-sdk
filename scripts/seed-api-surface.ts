#!/usr/bin/env tsx
/**
 * One-time bootstrap: replays the legacy, order-sensitive method-naming
 * algorithm over the COMMITTED specs/fixed/*.yaml to pin today's public
 * method names into scripts/api-surface.yaml.
 *
 * Refuses to overwrite an existing manifest. Re-seeding later would replay
 * the legacy algorithm over whatever specs/fixed/*.yaml contains at that
 * later moment, not the specs that were committed when the manifest was
 * first pinned. If an upstream path had moved by then, a re-seed would
 * silently capture a possibly-rebound name instead of the name actually
 * published today: exactly the incident this pipeline exists to fix.
 *
 * Scheduled for deletion together with scripts/lib/legacy-method-names.ts
 * once a later commit on this branch switches the generator onto the
 * manifest.
 *
 * Usage: pnpm exec tsx scripts/seed-api-surface.ts
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as yaml from 'yaml';
import {
  type ApiSurface,
  extractOps,
  loadApiSurface,
  type SurfaceEntry,
  serializeApiSurface,
} from './lib/api-surface.js';
import { resolveLegacyMethodNames } from './lib/legacy-method-names.js';

const SPECS_DIR = join(process.cwd(), 'specs', 'fixed');
const SURFACE_PATH = join(process.cwd(), 'scripts', 'api-surface.yaml');

function printRefusal(): void {
  console.error(
    `Refusing to overwrite the existing manifest at ${SURFACE_PATH}.\n\n` +
      'Re-seeding replays the legacy naming algorithm over whatever ' +
      'specs/fixed/*.yaml contains right now, not the specs that were ' +
      'committed when the manifest was first pinned. If an upstream path has ' +
      'moved since then, a re-seed would silently capture a possibly-rebound ' +
      'name instead of the name actually published today, which is the exact ' +
      'incident this manifest exists to prevent.\n\n' +
      'Hand-edit scripts/api-surface.yaml instead: update the "op:" of the ' +
      'affected entry to follow a renamed path, or add an entry for a new ' +
      'operation. Pass --force only if a from-scratch reseed is genuinely ' +
      'intended.'
  );
}

/**
 * Build one spec's manifest entries by replaying the legacy naming
 * algorithm over its operations in document order. extractOps preserves the
 * order operations appear in the spec's `paths` block, which matters because
 * the legacy naming algorithm resolves collisions by which op it sees first;
 * this order-fidelity is what makes the seed reproduce today's published
 * names. serializeApiSurface canonicalizes ordering on write, so the order
 * these entries are built in has no effect on the written file.
 */
function seedSpecEntries(specName: string, spec: unknown): SurfaceEntry[] {
  const ops = extractOps(spec);
  const names = resolveLegacyMethodNames(ops);

  return ops.map((op) => {
    const opDisplay = `${op.method.toUpperCase()} ${op.path}`;
    const name = names.get(opDisplay);
    if (!name) {
      // Cannot happen: resolveLegacyMethodNames names every op it is given,
      // keyed by this exact string. A miss here means extractOps and
      // resolveLegacyMethodNames disagree about op identity, a bug worth
      // failing loudly on rather than writing an incomplete entry.
      throw new Error(`seed-api-surface: no resolved name for ${opDisplay} in spec "${specName}"`);
    }
    return { op: opDisplay, name };
  });
}

async function main() {
  const force = process.argv.includes('--force');

  if (existsSync(SURFACE_PATH) && !force) {
    printRefusal();
    process.exitCode = 1;
    return;
  }

  if (!existsSync(SPECS_DIR)) {
    console.error(`Specs directory not found: ${SPECS_DIR}`);
    console.error('Run `pnpm fetch-specs` and `pnpm fix-specs` first.');
    process.exitCode = 1;
    return;
  }

  // Sort for determinism, same pattern as generate-sdk.ts main().
  const yamlFiles = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  const specs: Record<string, SurfaceEntry[]> = {};
  for (const file of yamlFiles) {
    const specName = basename(file, '.yaml');
    const content = readFileSync(join(SPECS_DIR, file), 'utf-8');
    const spec = yaml.parse(content);
    specs[specName] = seedSpecEntries(specName, spec);
  }

  const surface: ApiSurface = { version: 1, specs };
  writeFileSync(SURFACE_PATH, serializeApiSurface(surface));

  // Self-check: reload the file just written through the same validation
  // every future consumer goes through. A seeded name the manifest rules
  // would reject (a stray operationId collision, a reserved word, etc.)
  // fails loudly here instead of shipping silently.
  const reloaded = loadApiSurface(SURFACE_PATH);

  console.log(`Wrote ${SURFACE_PATH}\n`);
  let total = 0;
  for (const specName of Object.keys(reloaded.specs).sort()) {
    const count = reloaded.specs[specName].length;
    total += count;
    console.log(`  ${specName}: ${count} entries`);
  }
  console.log(`\nTotal entries: ${total}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
