/**
 * Tests for scripts/lib/routing-overrides.ts.
 *
 * Two halves, mirroring tests/spec-registry.test.ts: validation logic against
 * the exported pure validator with inline objects, then a regression suite
 * against the real committed scripts/routing-overrides.yaml.
 *
 * The rule this file most needs to hold is the evidence requirement. An
 * override without recorded evidence is the guess it was meant to replace, and
 * that is not a stylistic preference: an endpoint injected on an unrecorded
 * observation returned 404 for months because nobody could tell what it had
 * been based on.
 */

import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  findSpecOverride,
  loadRoutingOverrides,
  validateRoutingOverrides,
} from '../scripts/lib/routing-overrides.js';

const FILE = 'test-routing-overrides.yaml';
const EVIDENCE = 'Measured 2026-08-13 on api and sandboxapi: /platform 404, /isg 401.';
const ISG = 'https://{environment}.deere.com/isg';
const PLATFORM = 'https://{environment}.deere.com/platform';

function overrides(specs: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, specs };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'routing-overrides-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('routing override validation', () => {
  it('accepts a path-only override', () => {
    const result = validateRoutingOverrides(
      overrides({
        products: { paths: { '/activeIngredients': { servers: ISG, evidence: EVIDENCE } } },
      }),
      FILE
    );
    assert.strictEqual(result.specs.length, 1);
    assert.deepStrictEqual(result.specs[0].paths, [
      { pattern: '/activeIngredients', urlTemplate: ISG, evidence: EVIDENCE },
    ]);
    assert.strictEqual(result.specs[0].urlTemplate, null);
    assert.strictEqual(result.specs[0].acknowledgedDivergentServers, false);
  });

  it('accepts a spec-level override with evidence', () => {
    const result = validateRoutingOverrides(
      overrides({ notifications: { servers: PLATFORM, evidence: EVIDENCE } }),
      FILE
    );
    assert.strictEqual(result.specs[0].urlTemplate, PLATFORM);
  });

  it('sorts specs and paths for stable iteration', () => {
    const result = validateRoutingOverrides(
      overrides({
        products: {
          paths: {
            '/b': { servers: ISG, evidence: EVIDENCE },
            '/a': { servers: ISG, evidence: EVIDENCE },
          },
        },
        notifications: { servers: PLATFORM, evidence: EVIDENCE },
      }),
      FILE
    );
    assert.deepStrictEqual(
      result.specs.map((s) => s.spec),
      ['notifications', 'products']
    );
    assert.deepStrictEqual(
      result.specs[1].paths.map((p) => p.pattern),
      ['/a', '/b']
    );
  });

  it('rejects a spec-level override with no evidence', () => {
    assert.throws(
      () => validateRoutingOverrides(overrides({ notifications: { servers: PLATFORM } }), FILE),
      (e: unknown) => e instanceof Error && /needs "evidence"/.test(e.message)
    );
  });

  it('rejects a path override with no evidence', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({ products: { paths: { '/activeIngredients': { servers: ISG } } } }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /needs "evidence"/.test(e.message)
    );
  });

  it('rejects evidence too short to re-check', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({ notifications: { servers: PLATFORM, evidence: 'it 404s' } }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /at least 40 characters/.test(e.message)
    );
  });

  it('rejects an acknowledgement with no evidence', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({ products: { acknowledgedDivergentServers: true } }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /needs "evidence"/.test(e.message)
    );
  });

  it('rejects a non-templated server URL', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({
            products: {
              paths: { '/x': { servers: 'https://api.deere.com/isg', evidence: EVIDENCE } },
            },
          }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /templated deere.com https URL/.test(e.message)
    );
  });

  it('rejects a non-deere server URL', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({
            products: {
              paths: {
                '/x': { servers: 'https://{environment}.evil.com/isg', evidence: EVIDENCE },
              },
            },
          }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /templated deere.com https URL/.test(e.message)
    );
  });

  it('rejects a path pattern without a leading slash', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({
            products: { paths: { activeIngredients: { servers: ISG, evidence: EVIDENCE } } },
          }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /must start with "\/"/.test(e.message)
    );
  });

  it('rejects an entry that overrides nothing', () => {
    assert.throws(
      () => validateRoutingOverrides(overrides({ products: { evidence: EVIDENCE } }), FILE),
      (e: unknown) => e instanceof Error && /overrides nothing/.test(e.message)
    );
  });

  it('rejects an unsupported version', () => {
    assert.throws(
      () => validateRoutingOverrides({ version: 2, specs: {} }, FILE),
      (e: unknown) => e instanceof Error && /unsupported version 2/.test(e.message)
    );
  });

  it('rejects a non-boolean acknowledgement', () => {
    assert.throws(
      () =>
        validateRoutingOverrides(
          overrides({ products: { acknowledgedDivergentServers: 'yes', evidence: EVIDENCE } }),
          FILE
        ),
      (e: unknown) => e instanceof Error && /must be a boolean/.test(e.message)
    );
  });
});

describe('routing override loading', () => {
  it('reads and validates from disk', () => {
    withTempDir((dir) => {
      const path = join(dir, 'routing-overrides.yaml');
      // Evidence is quoted: it contains ": ", which YAML would otherwise read
      // as a nested mapping.
      writeFileSync(
        path,
        `version: 1\nspecs:\n  products:\n    paths:\n      /activeIngredients:\n        servers: "${ISG}"\n        evidence: "${EVIDENCE}"\n`
      );
      const result = loadRoutingOverrides(path);
      assert.strictEqual(result.specs[0].paths[0].urlTemplate, ISG);
    });
  });

  it('refuses a missing file rather than defaulting to no overrides', () => {
    withTempDir((dir) => {
      assert.throws(
        () => loadRoutingOverrides(join(dir, 'absent.yaml')),
        (e: unknown) => e instanceof Error && /overrides file missing/.test(e.message)
      );
    });
  });
});

describe('the committed scripts/routing-overrides.yaml', () => {
  const committed = loadRoutingOverrides();

  it('loads without error', () => {
    assert.ok(committed.specs.length > 0);
  });

  it('routes notifications GET /notifications/{sourceEvent} to /isg', () => {
    const spec = findSpecOverride(committed, 'notifications');
    assert.ok(spec, 'notifications must have an override');
    const override = spec.paths.find((p) => p.pattern === '/notifications/{sourceEvent}');
    assert.ok(override, 'the /isg path override must be present');
    assert.strictEqual(override.urlTemplate, ISG);
  });

  it('routes products /activeIngredients to /isg and acknowledges the divergence', () => {
    const spec = findSpecOverride(committed, 'products');
    assert.ok(spec);
    assert.strictEqual(spec.acknowledgedDivergentServers, true);
    assert.strictEqual(
      spec.paths.find((p) => p.pattern === '/activeIngredients')?.urlTemplate,
      ISG
    );
  });

  it('carries a measurement date in every piece of evidence', () => {
    for (const spec of committed.specs) {
      const claims = [
        ...(spec.evidence ? [{ where: spec.spec, evidence: spec.evidence }] : []),
        ...spec.paths.map((p) => ({ where: `${spec.spec} ${p.pattern}`, evidence: p.evidence })),
      ];
      for (const claim of claims) {
        assert.match(
          claim.evidence,
          /\d{4}-\d{2}-\d{2}/,
          `${claim.where}: evidence must say when it was measured, so it can be re-checked`
        );
      }
    }
  });
});
