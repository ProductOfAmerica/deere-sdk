/**
 * The hermetic half of the routing guard. No network.
 *
 * Two layers:
 *
 *   1. Invariants. No stage may manufacture routing data. Every servers block
 *      in specs/fixed must trace to either the raw spec Deere published or an
 *      entry in scripts/routing-overrides.yaml carrying measured evidence.
 *   2. Snapshot. scripts/routing-snapshot.yaml must match what
 *      resolveRequestUrl actually resolves, so a change to URL construction
 *      lands as a reviewable diff instead of shipping unnoticed.
 *
 * Layer 1 is the test that would have caught both bugs this work fixed:
 * notifications got a /platform servers block invented for it, and products'
 * path-level routing was discarded by the merge. Layer 2 is the one that
 * catches the next one, whatever it turns out to be, because it covers every
 * path rather than the ones somebody thought to assert.
 *
 * The live probe (scripts/probe-routes.ts) is deliberately not here. It tests
 * Deere's gateway rather than this repo, so it must never fail a build.
 */

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as yaml from 'yaml';
import { findSpecOverride, loadRoutingOverrides } from '../scripts/lib/routing-overrides.js';
import {
  buildRoutingSnapshot,
  readRoutingSnapshot,
  serializeRoutingSnapshot,
} from '../scripts/lib/routing-snapshot.js';

const RAW_DIR = join(process.cwd(), 'specs', 'raw');
const FIXED_DIR = join(process.cwd(), 'specs', 'fixed');

interface SpecDoc {
  servers?: unknown[];
  paths?: Record<string, { servers?: unknown[] } | undefined>;
}

function load(dir: string, file: string): SpecDoc {
  return (yaml.parse(readFileSync(join(dir, file), 'utf-8')) ?? {}) as SpecDoc;
}

const fixedFiles = readdirSync(FIXED_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .sort();

describe('routing invariants: no stage may manufacture routing data', () => {
  const overrides = loadRoutingOverrides();

  it('every spec-level servers block traces to the raw spec or a recorded override', () => {
    for (const file of fixedFiles) {
      const spec = file.replace(/\.yaml$/, '');
      const fixed = load(FIXED_DIR, file);
      if (!Array.isArray(fixed.servers) || fixed.servers.length === 0) continue;

      const raw = load(RAW_DIR, file);
      const rawDeclares = Array.isArray(raw.servers) && raw.servers.length > 0;
      if (rawDeclares) continue; // fix-specs may normalize a published block

      const override = findSpecOverride(overrides, spec);
      assert.ok(
        override?.urlTemplate,
        `${spec}: specs/fixed declares a servers block, specs/raw does not, and ` +
          `scripts/routing-overrides.yaml has no spec-level entry for it. Some stage invented ` +
          `a base URL. That is how notifications shipped a 404: a manufactured /platform block ` +
          `that API_SERVERS then reported as spec-derived truth.`
      );
    }
  });

  it('every path-level servers block traces to a recorded override', () => {
    for (const file of fixedFiles) {
      const spec = file.replace(/\.yaml$/, '');
      const fixed = load(FIXED_DIR, file);

      for (const [path, item] of Object.entries(fixed.paths ?? {})) {
        if (!Array.isArray(item?.servers) || item.servers.length === 0) continue;

        const override = findSpecOverride(overrides, spec);
        const recorded = override?.paths.some((p) => p.pattern === path);
        assert.ok(
          recorded,
          `${spec}: path "${path}" in specs/fixed carries its own servers block with no ` +
            `matching entry in scripts/routing-overrides.yaml. Per-path routing is only ever ` +
            `written by that registry, so this came from somewhere that owes an explanation.`
        );
      }
    }
  });

  it('every recorded override still corresponds to a real spec and path', () => {
    // The mirror of the two above: an override that applies to nothing is a
    // claim about a spec that has moved on, and would sit there looking
    // authoritative while doing nothing.
    for (const entry of overrides.specs) {
      const file = `${entry.spec}.yaml`;
      assert.ok(
        fixedFiles.includes(file),
        `routing-overrides.yaml names spec "${entry.spec}", which has no specs/fixed file`
      );
      const fixed = load(FIXED_DIR, file);
      for (const override of entry.paths) {
        assert.ok(
          fixed.paths?.[override.pattern],
          `routing-overrides.yaml overrides ${entry.spec} "${override.pattern}", which the ` +
            `spec no longer declares. Re-measure and update or delete the entry.`
        );
      }
    }
  });
});

describe('routing snapshot', () => {
  it('matches what resolveRequestUrl actually resolves', () => {
    const { rows } = buildRoutingSnapshot();
    const expected = serializeRoutingSnapshot(rows);
    const committed = readRoutingSnapshot();

    assert.strictEqual(
      committed,
      expected,
      'scripts/routing-snapshot.yaml is stale. A published method changed host. Run ' +
        '`pnpm generate-routing-snapshot`, read the diff, and confirm every moved path is ' +
        'intentional and measured before committing it.'
    );
  });

  it('covers every path in every fixed spec', () => {
    const { rows, skipped } = buildRoutingSnapshot();
    const declared = fixedFiles.reduce(
      (total, file) => total + Object.keys(load(FIXED_DIR, file).paths ?? {}).length,
      0
    );
    assert.strictEqual(
      rows.length + skipped.length,
      declared,
      'the snapshot must account for every declared path, as a row or an explicit skip'
    );
  });

  it('resolves every path in the canonical environment', () => {
    // A skip means a spec refused the environment. The three static specs
    // legitimately serve only some tiers, but none of them refuses "api", so
    // any skip here is a regression rather than a known shape.
    const { skipped } = buildRoutingSnapshot();
    assert.deepStrictEqual(
      skipped,
      [],
      `no spec should refuse the snapshot environment; got: ${skipped.join('; ')}`
    );
  });

  it('pins the two paths that used to resolve to a 404', () => {
    const { rows } = buildRoutingSnapshot();
    const find = (spec: string, path: string) =>
      rows.find((r) => r.spec === spec && r.path === path)?.base;

    assert.strictEqual(
      find('notifications', '/notifications/{sourceEvent}'),
      'https://api.deere.com/isg',
      'this path is served from /isg; /platform returns 404 (measured, see routing-overrides.yaml)'
    );
    assert.strictEqual(
      find('products', '/activeIngredients'),
      'https://api.deere.com/isg',
      'this path is served from /isg; /platform returns 404 (measured, see routing-overrides.yaml)'
    );
    assert.strictEqual(
      find('notifications', '/notificationEvents'),
      'https://api.deere.com/platform',
      'the override must not bleed onto its sibling paths'
    );
  });
});
