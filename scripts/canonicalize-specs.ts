#!/usr/bin/env tsx
/**
 * One-time (but rerunnable, idempotent) normalization of committed raw specs
 * to the canonical key order fetch-specs now emits, so live fetches diff
 * cleanly against them.
 *
 * Usage: pnpm canonicalize-specs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { canonicalizeSpec, stringifySpec } from './lib/spec-canonicalize.js';

const SPECS_DIR = join(process.cwd(), 'specs', 'raw');

async function main() {
  console.log('Canonicalizing committed raw specs...\n');

  const yamlFiles = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  console.log(`Found ${yamlFiles.length} specs to canonicalize`);

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const filePath = join(SPECS_DIR, yamlFile);

    try {
      const original = readFileSync(filePath, 'utf-8');
      const parsed = yaml.parse(original);
      const canonical = canonicalizeSpec(parsed);
      const canonicalText = stringifySpec(canonical);

      if (canonicalText === original) {
        console.log(`  unchanged: ${yamlFile}`);
        unchanged++;
      } else {
        writeFileSync(filePath, canonicalText);
        console.log(`  changed: ${yamlFile}`);
        changed++;
      }
    } catch (error) {
      console.log(`  Failed to parse ${yamlFile}: ${error}`);
      failed++;
    }
  }

  console.log(`\n${changed} changed, ${unchanged} unchanged, ${failed} failed`);
  if (failed > 0) {
    console.error(
      `canonicalize-specs: ${failed} spec(s) failed to process; failing the run so CI cannot ship a partially-canonicalized raw spec.`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
