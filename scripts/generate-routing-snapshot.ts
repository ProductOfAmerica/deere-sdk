#!/usr/bin/env tsx
/**
 * Regenerates scripts/routing-snapshot.yaml.
 *
 * Usage: pnpm generate-routing-snapshot
 *
 * Deliberately NOT part of `pnpm generate`. The snapshot is a human approval
 * point for routing changes: run this when you have changed URL construction on
 * purpose, read the diff, and commit it with the change that caused it.
 *
 * The one automated caller is sync-api.yml, and only AFTER the routing guard
 * passes. The guard fails on every change that needs a human (a path changing
 * host, a path disappearing, a new path off its spec's default base), so what
 * the sync writes back is limited to new paths on their spec's default base.
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
