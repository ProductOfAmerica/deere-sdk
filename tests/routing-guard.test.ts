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
  diffRoutingSnapshot,
  parseSnapshotRoutes,
  type RoutingSnapshotRow,
  readRoutingSnapshot,
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
  // Fails on what needs a human: a published path changing host, a path
  // disappearing, or a new path landing anywhere but its spec's default base.
  // A new path on the default base is what Deere published (layer 1 proves the
  // base was not manufactured), so it passes, and the sync then rewrites the
  // snapshot to include it; see sync-api.yml "Refresh routing snapshot".
  const diff = diffRoutingSnapshot(
    parseSnapshotRoutes(readRoutingSnapshot()),
    buildRoutingSnapshot().rows
  );
  const regenerate =
    'Run `pnpm generate-routing-snapshot`, read the diff, and confirm every change is ' +
    'intentional and measured before committing it.';

  it('no committed path changed host', () => {
    assert.deepStrictEqual(
      diff.moved,
      [],
      `a published method changed host. ${regenerate} ${JSON.stringify(diff.moved)}`
    );
  });

  it('no committed path disappeared', () => {
    assert.deepStrictEqual(
      diff.removed,
      [],
      `scripts/routing-snapshot.yaml lists paths no fixed spec declares. ${regenerate} ` +
        JSON.stringify(diff.removed)
    );
  });

  it('every new path resolves to its spec default base', () => {
    assert.deepStrictEqual(
      diff.newOffDefault,
      [],
      `a new path resolves somewhere other than its spec's default base, so a routing ` +
        `decision was made for it. ${regenerate} ${JSON.stringify(diff.newOffDefault)}`
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

describe('diffRoutingSnapshot', () => {
  const row = (spec: string, path: string, base: string): RoutingSnapshotRow => ({
    spec,
    path,
    base,
  });
  const PLATFORM = 'https://api.deere.com/platform';
  const ISG = 'https://api.deere.com/isg';
  const defaults = (spec: string) => (spec === 'gone' ? undefined : PLATFORM);
  const committed = { users: { '/users/{username}': PLATFORM } };

  it('reports nothing when rows match the snapshot', () => {
    const d = diffRoutingSnapshot(
      committed,
      [row('users', '/users/{username}', PLATFORM)],
      defaults
    );
    assert.deepStrictEqual(d, { moved: [], removed: [], newOffDefault: [], newOnDefault: [] });
  });

  it('accepts a new path on its spec default base', () => {
    const d = diffRoutingSnapshot(
      committed,
      [row('users', '/users/{username}', PLATFORM), row('users', '/users/@currentUser', PLATFORM)],
      defaults
    );
    assert.deepStrictEqual(d.newOnDefault, [
      { spec: 'users', path: '/users/@currentUser', base: PLATFORM },
    ]);
    assert.deepStrictEqual([...d.moved, ...d.removed, ...d.newOffDefault], []);
  });

  it('flags a new path off its spec default base', () => {
    const d = diffRoutingSnapshot(
      committed,
      [row('users', '/users/{username}', PLATFORM), row('users', '/users/x', ISG)],
      defaults
    );
    assert.strictEqual(d.newOffDefault.length, 1);
  });

  it('flags a new path in a spec that refuses the snapshot environment', () => {
    const d = diffRoutingSnapshot({}, [row('gone', '/a', PLATFORM)], defaults);
    assert.strictEqual(d.newOffDefault.length, 1);
  });

  it('flags a committed path that changed host or disappeared', () => {
    const moved = diffRoutingSnapshot(
      committed,
      [row('users', '/users/{username}', ISG)],
      defaults
    );
    assert.deepStrictEqual(moved.moved, [
      { spec: 'users', path: '/users/{username}', from: PLATFORM, to: ISG },
    ]);
    const removed = diffRoutingSnapshot(committed, [], defaults);
    assert.strictEqual(removed.removed.length, 1);
  });
});
