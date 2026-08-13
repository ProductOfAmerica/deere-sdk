/**
 * Tests for scripts/lib/spec-registry.ts.
 *
 * Two halves, mirroring the split between tests/api-surface.test.ts and
 * tests/api-surface-manifest.test.ts:
 *
 *   1. Validation logic, exercised with inline objects through
 *      validateRegistry. No filesystem, no network.
 *   2. A regression suite against the real committed
 *      scripts/spec-registry.yaml, so CI catches a hand edit that drifts the
 *      registry away from what is actually on disk in specs/raw/. Tests run
 *      from the repo root, so loadSpecRegistry()'s default cwd-based path
 *      resolves to the real file.
 *
 * The registry is the gate that decides whether an unrefreshed spec fails the
 * build, so a registry that silently disagrees with specs/raw/ would reopen
 * exactly the hole it was built to close.
 */

import assert from 'node:assert';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadSpecRegistry, validateRegistry } from '../scripts/lib/spec-registry.js';

const FILE = 'test-registry.yaml';

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { slug: 'fields', apiId: '51ba3f52-593e-42a2-bdb3-4d7c44bd0bf9', ...overrides };
}

function registry(specs: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, specs };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'spec-registry-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('spec registry validation', () => {
  it('accepts a minimal active entry and defaults it to not frozen', () => {
    const result = validateRegistry(registry({ fields: entry() }), FILE);
    assert.strictEqual(result.version, 1);
    assert.deepStrictEqual(result.entries, [
      {
        name: 'fields',
        slug: 'fields',
        apiId: '51ba3f52-593e-42a2-bdb3-4d7c44bd0bf9',
        frozen: null,
      },
    ]);
  });

  it('keeps the internal spec name distinct from the portal slug', () => {
    const result = validateRegistry(
      registry({ 'field-operations-api': entry({ slug: 'field-operations' }) }),
      FILE
    );
    assert.strictEqual(result.entries[0].name, 'field-operations-api');
    assert.strictEqual(result.entries[0].slug, 'field-operations');
  });

  it('sorts entries by name so iteration order is stable across platforms', () => {
    const result = validateRegistry(
      registry({ webhook: entry({ slug: 'webhook' }), aemp: entry({ slug: 'aemp' }) }),
      FILE
    );
    assert.deepStrictEqual(
      result.entries.map((e) => e.name),
      ['aemp', 'webhook']
    );
  });

  it('captures reason and since for a frozen entry', () => {
    const result = validateRegistry(
      registry({
        notifications: entry({
          slug: 'notifications',
          status: 'frozen',
          reason: 'portal serves swagger: where the validator requires openapi:',
          since: '2026-05-23',
        }),
      }),
      FILE
    );
    assert.deepStrictEqual(result.entries[0].frozen, {
      reason: 'portal serves swagger: where the validator requires openapi:',
      since: '2026-05-23',
    });
  });

  it('rejects an unsupported version', () => {
    assert.throws(
      () => validateRegistry({ version: 2, specs: { fields: entry() } }, FILE),
      (error: unknown) => error instanceof Error && /unsupported version 2/.test(error.message)
    );
  });

  it('rejects an empty specs mapping rather than fetching nothing successfully', () => {
    assert.throws(
      () => validateRegistry(registry({}), FILE),
      (error: unknown) => error instanceof Error && /is empty/.test(error.message)
    );
  });

  it('rejects a spec name that could escape specs/raw/', () => {
    assert.throws(
      () => validateRegistry(registry({ '../evil': entry() }), FILE),
      (error: unknown) => error instanceof Error && /spec name must match/.test(error.message)
    );
  });

  it('rejects a slug that is not safe to interpolate into the fetch URL', () => {
    assert.throws(
      () => validateRegistry(registry({ fields: entry({ slug: '../../etc/passwd' }) }), FILE),
      (error: unknown) => error instanceof Error && /"slug" must be a string/.test(error.message)
    );
  });

  it('rejects a malformed apiId', () => {
    assert.throws(
      () => validateRegistry(registry({ fields: entry({ apiId: 'not-a-uuid' }) }), FILE),
      (error: unknown) =>
        error instanceof Error && /"apiId" must be a lowercase UUID/.test(error.message)
    );
  });

  it('rejects a status other than frozen', () => {
    assert.throws(
      () => validateRegistry(registry({ fields: entry({ status: 'active' }) }), FILE),
      (error: unknown) => error instanceof Error && /"status" must be "frozen"/.test(error.message)
    );
  });

  it('rejects a frozen entry with no reason', () => {
    assert.throws(
      () =>
        validateRegistry(
          registry({ fields: entry({ status: 'frozen', since: '2026-05-23' }) }),
          FILE
        ),
      (error: unknown) => error instanceof Error && /non-empty "reason"/.test(error.message)
    );
  });

  it('rejects a frozen entry whose since is not a real date', () => {
    assert.throws(
      () =>
        validateRegistry(
          registry({ fields: entry({ status: 'frozen', reason: 'x', since: '2026-02-30' }) }),
          FILE
        ),
      (error: unknown) => error instanceof Error && /real YYYY-MM-DD date/.test(error.message)
    );
  });

  it('rejects freeze metadata on an entry that is not frozen', () => {
    assert.throws(
      () => validateRegistry(registry({ fields: entry({ reason: 'looks frozen, is not' }) }), FILE),
      (error: unknown) =>
        error instanceof Error && /only meaningful with "status: frozen"/.test(error.message)
    );
  });

  it('rejects two specs claiming the same slug', () => {
    assert.throws(
      () =>
        validateRegistry(
          registry({ fields: entry({ slug: 'fields' }), farms: entry({ slug: 'fields' }) }),
          FILE
        ),
      (error: unknown) => error instanceof Error && /both claim slug/.test(error.message)
    );
  });
});

describe('spec registry loading', () => {
  it('reads and validates a registry from disk', () => {
    withTempDir((dir) => {
      const path = join(dir, 'spec-registry.yaml');
      writeFileSync(
        path,
        'version: 1\nspecs:\n  fields:\n    slug: fields\n' +
          '    apiId: 51ba3f52-593e-42a2-bdb3-4d7c44bd0bf9\n'
      );
      const result = loadSpecRegistry(path);
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.entries[0].slug, 'fields');
    });
  });

  it('refuses to run with a missing registry instead of defaulting to an empty one', () => {
    withTempDir((dir) => {
      assert.throws(
        () => loadSpecRegistry(join(dir, 'absent.yaml')),
        (error: unknown) => error instanceof Error && /registry file missing/.test(error.message)
      );
    });
  });

  it('reports unparseable YAML rather than throwing a bare parse error', () => {
    withTempDir((dir) => {
      const path = join(dir, 'spec-registry.yaml');
      writeFileSync(path, 'version: 1\nspecs:\n  fields:\n   - [unbalanced\n');
      assert.throws(
        () => loadSpecRegistry(path),
        (error: unknown) => error instanceof Error && /unparseable YAML/.test(error.message)
      );
    });
  });
});

describe('the committed scripts/spec-registry.yaml', () => {
  const committed = loadSpecRegistry();
  const rawSpecNames = readdirSync(join(process.cwd(), 'specs', 'raw'))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();

  it('loads without error', () => {
    assert.ok(committed.entries.length > 0);
  });

  it('has exactly one row per committed raw spec, and no orphans', () => {
    assert.deepStrictEqual(
      committed.entries.map((e) => e.name),
      rawSpecNames,
      'every specs/raw/*.yaml needs a registry row, and every row needs its raw spec. ' +
        'A row with no raw file would fetch into a spec nothing generates from; a raw file ' +
        'with no row would never be refreshed and never be reported as stale.'
    );
  });

  it('keeps field-operations-api pinned to its renamed portal slug', () => {
    const fieldOps = committed.entries.find((e) => e.name === 'field-operations-api');
    assert.ok(fieldOps, 'field-operations-api must stay in the registry');
    assert.strictEqual(
      fieldOps.slug,
      'field-operations',
      'the portal renamed this slug; the internal name is a public SpecName literal and stays'
    );
  });

  it('documents every freeze with a reason and a date', () => {
    for (const frozen of committed.entries.filter((e) => e.frozen)) {
      assert.ok(
        (frozen.frozen?.reason.length ?? 0) > 40,
        `${frozen.name}: a freeze reason needs enough detail to evaluate lifting it`
      );
      assert.match(frozen.frozen?.since ?? '', /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
