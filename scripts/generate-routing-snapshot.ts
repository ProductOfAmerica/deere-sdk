#!/usr/bin/env tsx
/**
 * Regenerates scripts/routing-snapshot.yaml.
 *
 * Usage: pnpm generate-routing-snapshot
 *
 * Deliberately NOT part of `pnpm generate`. The snapshot is a human approval
 * point, and a file the pipeline rewrites on its own approves nothing. Run this
 * when you have changed URL construction on purpose, read the diff, and commit
 * it with the change that caused it.
 */

import { writeFileSync } from 'node:fs';
import {
  buildRoutingSnapshot,
  SNAPSHOT_PATH,
  serializeRoutingSnapshot,
} from './lib/routing-snapshot.js';

const { rows, skipped } = buildRoutingSnapshot();

writeFileSync(SNAPSHOT_PATH, serializeRoutingSnapshot(rows));

console.log(`Wrote ${SNAPSHOT_PATH}`);
console.log(`  ${rows.length} paths across ${new Set(rows.map((r) => r.spec)).size} specs`);

const nonPlatform = rows.filter((r) => !r.base.endsWith('/platform'));
if (nonPlatform.length > 0) {
  console.log(`\n  ${nonPlatform.length} path(s) on a base other than /platform:`);
  for (const row of nonPlatform) {
    console.log(`    ${row.spec}: ${row.path} -> ${row.base}`);
  }
}

if (skipped.length > 0) {
  console.log(`\n  ${skipped.length} path(s) skipped (spec does not serve the snapshot env):`);
  for (const line of skipped) console.log(`    ${line}`);
}
