/**
 * Unit + property tests for scripts/lib/api-surface.ts.
 *
 * The library is the committed operation-identity manifest: it maps
 * (HTTP method, normalized path) to public method names so an upstream spec
 * reorder cannot silently rebind a name. These tests cover loader validation,
 * deterministic serialization + round-trip, shared op extraction, the
 * deterministic name proposer, order-independent resolution, and run
 * classification. Style follows tests/fix-specs-embed.test.ts (node:test +
 * node:assert + mkdtempSync for the file-backed cases) and tests/fuzz.test.ts
 * (fast-check properties).
 */

import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import {
  type ApiSurface,
  classifyRun,
  extractOps,
  loadApiSurface,
  normalizePathPattern,
  opKey,
  proposeName,
  resolveMethodNames,
  type SurfaceOp,
  serializeApiSurface,
} from '../scripts/lib/api-surface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'api-surface-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write manifest YAML text to a temp file and load it through loadApiSurface. */
function loadYaml(text: string): ApiSurface {
  return withTempDir((dir) => {
    const p = join(dir, 'api-surface.yaml');
    writeFileSync(p, text, 'utf-8');
    return loadApiSurface(p);
  });
}

/** Deterministic LCG-backed Fisher-Yates shuffle for order-independence checks. */
function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// normalizePathPattern + opKey
// ---------------------------------------------------------------------------

describe('normalizePathPattern + opKey', () => {
  it('collapses every path param to {_}', () => {
    assert.strictEqual(
      normalizePathPattern('/orgs/{orgId}/fields/{fieldId}'),
      '/orgs/{_}/fields/{_}'
    );
    assert.strictEqual(normalizePathPattern('/equipment'), '/equipment');
  });

  it('opKey uppercases the method and normalizes the path', () => {
    assert.strictEqual(opKey('get', '/fieldOperations/{operationId}'), 'GET /fieldOperations/{_}');
  });

  it('param-name churn does not change identity ({orgId} == {organizationId})', () => {
    assert.strictEqual(opKey('GET', '/orgs/{orgId}'), opKey('get', '/orgs/{organizationId}'));
  });
});

// ---------------------------------------------------------------------------
// loadApiSurface: happy path + validation failures
// ---------------------------------------------------------------------------

describe('loadApiSurface', () => {
  it('parses a valid manifest', () => {
    const surface = loadYaml(`
version: 1
specs:
  field-operations-api:
    - op: GET /fieldOperations/{operationId}
      name: get
    - op: POST /fieldOperations
      name: create
  organizations:
    - op: GET /organizations
      name: list
`);
    assert.strictEqual(surface.version, 1);
    assert.deepStrictEqual(Object.keys(surface.specs).sort(), [
      'field-operations-api',
      'organizations',
    ]);
    assert.deepStrictEqual(surface.specs['field-operations-api'], [
      { op: 'GET /fieldOperations/{operationId}', name: 'get' },
      { op: 'POST /fieldOperations', name: 'create' },
    ]);
  });

  it('throws a clear error when the manifest file is missing (points at the seed script)', () => {
    withTempDir((dir) => {
      const missing = join(dir, 'nope.yaml');
      assert.throws(
        () => loadApiSurface(missing),
        (err: Error) => {
          assert.match(err.message, /manifest file missing/);
          assert.match(err.message, /seed-api-surface\.ts/);
          assert.match(err.message, /nope\.yaml/);
          return true;
        }
      );
    });
  });

  it('throws on unparseable YAML', () => {
    assert.throws(() => loadYaml('version: 1\nspecs:\n  : broken:\n    : :'), /unparseable YAML/);
  });

  it('throws when version is not 1', () => {
    assert.throws(() => loadYaml('version: 2\nspecs: {}'), /unsupported version/);
  });

  it('throws when specs is not a mapping', () => {
    assert.throws(() => loadYaml('version: 1\nspecs: not-a-map'), /"specs".*must be a mapping/);
  });

  it('throws when a spec does not map to an array', () => {
    assert.throws(
      () => loadYaml('version: 1\nspecs:\n  equipment: not-an-array'),
      /spec "equipment".*must map to an array/
    );
  });

  it('throws when an entry is missing op', () => {
    assert.throws(
      () => loadYaml('version: 1\nspecs:\n  equipment:\n    - name: get'),
      (err: Error) => {
        assert.match(err.message, /spec "equipment" entry\[0\]/);
        assert.match(err.message, /"op" must be a non-empty string/);
        return true;
      }
    );
  });

  it('throws when an entry is missing name', () => {
    assert.throws(
      () => loadYaml('version: 1\nspecs:\n  equipment:\n    - op: GET /equipment'),
      /"name" must be a non-empty string/
    );
  });

  it('throws when op is not METHOD /path (bad method)', () => {
    assert.throws(
      () =>
        loadYaml('version: 1\nspecs:\n  equipment:\n    - op: FETCH /equipment\n      name: get'),
      (err: Error) => {
        assert.match(err.message, /spec "equipment" entry\[0\]/);
        assert.match(err.message, /must be "METHOD \/path"/);
        return true;
      }
    );
  });

  it('throws when op has no leading-slash path', () => {
    assert.throws(
      () => loadYaml('version: 1\nspecs:\n  equipment:\n    - op: GET equipment\n      name: get'),
      /must be "METHOD \/path"/
    );
  });

  it('throws on duplicate normalized opKey within a spec (param-name churn collapses)', () => {
    assert.throws(
      () =>
        loadYaml(`
version: 1
specs:
  organizations:
    - op: GET /orgs/{orgId}
      name: a
    - op: GET /orgs/{organizationId}
      name: b
`),
      (err: Error) => {
        assert.match(err.message, /spec "organizations"/);
        assert.match(err.message, /duplicate operation identity/);
        return true;
      }
    );
  });

  it('throws on duplicate name within a spec', () => {
    assert.throws(
      () =>
        loadYaml(`
version: 1
specs:
  organizations:
    - op: GET /a
      name: same
    - op: GET /b
      name: same
`),
      (err: Error) => {
        assert.match(err.message, /spec "organizations"/);
        assert.match(err.message, /duplicate method name "same"/);
        return true;
      }
    );
  });

  it('throws when name does not match /^[a-z][a-zA-Z0-9]*$/', () => {
    assert.throws(
      () => loadYaml('version: 1\nspecs:\n  equipment:\n    - op: GET /equipment\n      name: Bad'),
      /name "Bad" must match/
    );
  });

  it('throws when name collides with a generated class field (spec)', () => {
    assert.throws(
      () =>
        loadYaml('version: 1\nspecs:\n  equipment:\n    - op: GET /equipment\n      name: spec'),
      (err: Error) => {
        assert.match(err.message, /collides with a generated class field/);
        assert.match(err.message, /"spec"/);
        return true;
      }
    );
  });

  it('throws when a name is listAll (reserved for the derived twin)', () => {
    assert.throws(
      () =>
        loadYaml('version: 1\nspecs:\n  equipment:\n    - op: GET /equipment\n      name: listAll'),
      (err: Error) => {
        assert.match(err.message, /listAll/);
        assert.match(err.message, /derived/);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// serializeApiSurface + round-trip
// ---------------------------------------------------------------------------

describe('serializeApiSurface', () => {
  const canonical: ApiSurface = {
    version: 1,
    specs: {
      equipment: [
        { op: 'GET /equipment', name: 'get' },
        { op: 'GET /equipmentMakes', name: 'list' },
      ],
      'field-operations-api': [
        { op: 'GET /fieldOperations/{operationId}', name: 'get' },
        { op: 'POST /fieldOperations', name: 'create' },
      ],
    },
  };

  it('round-trips: load(serialize(x)) deep-equals a canonical x', () => {
    const loaded = loadYaml(serializeApiSurface(canonical));
    assert.deepStrictEqual(loaded, canonical);
  });

  it('canonicalizes ordering: specs sorted, entries sorted by opKey', () => {
    const shuffled: ApiSurface = {
      version: 1,
      specs: {
        'field-operations-api': [
          { op: 'POST /fieldOperations', name: 'create' },
          { op: 'GET /fieldOperations/{operationId}', name: 'get' },
        ],
        equipment: [
          { op: 'GET /equipmentMakes', name: 'list' },
          { op: 'GET /equipment', name: 'get' },
        ],
      },
    };
    // Same content in a different order serializes byte-identically.
    assert.strictEqual(serializeApiSurface(shuffled), serializeApiSurface(canonical));
    // And is stable across repeated calls.
    assert.strictEqual(serializeApiSurface(canonical), serializeApiSurface(canonical));
  });

  it('emits the fixed header runbook and never a dash', () => {
    const out = serializeApiSurface(canonical);
    assert.match(out, /Operation identity/);
    assert.match(out, /REGENERATED/);
    assert.match(out, /renamed/);
    assert.match(out, /removed/);
    assert.match(out, /camel/);
    assert.match(out, /listAll/);
    assert.ok(!out.includes('—') && !out.includes('–'), 'no em or en dashes in header');
    assert.ok(!out.includes(' -- '), 'no dash-substitute in header');
  });
});

// ---------------------------------------------------------------------------
// extractOps
// ---------------------------------------------------------------------------

describe('extractOps', () => {
  it('synthesizes operationIds, flags isCollection, and honors explicit ids', () => {
    const spec = {
      paths: {
        '/widgets': {
          get: {}, // no operationId -> synthesized; collection GET
          post: { operationId: 'createWidget' }, // POST -> not a collection
        },
        '/widgets/{id}': {
          get: { operationId: 'getWidgetById' }, // item GET -> not a collection
        },
      },
    };
    const ops = extractOps(spec);
    const byKey = new Map(ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]));

    const list = byKey.get('GET /widgets');
    assert.ok(list);
    assert.strictEqual(list.operationId, 'getwidgets');
    assert.strictEqual(list.isCollection, true);

    const create = byKey.get('POST /widgets');
    assert.ok(create);
    assert.strictEqual(create.operationId, 'createWidget');
    assert.strictEqual(create.isCollection, false);

    const item = byKey.get('GET /widgets/{id}');
    assert.ok(item);
    assert.strictEqual(item.operationId, 'getWidgetById');
    assert.strictEqual(item.isCollection, false);
  });

  it('tolerates missing / empty / malformed paths', () => {
    assert.deepStrictEqual(extractOps({}), []);
    assert.deepStrictEqual(extractOps({ paths: {} }), []);
    assert.deepStrictEqual(extractOps({ paths: null }), []);
    assert.deepStrictEqual(extractOps(null), []);
    assert.deepStrictEqual(extractOps('nope'), []);
  });
});

// ---------------------------------------------------------------------------
// proposeName
// ---------------------------------------------------------------------------

describe('proposeName', () => {
  const empty = new Set<string>();

  it('maps verbs by method, splitting GET on isCollection', () => {
    assert.strictEqual(
      proposeName({ operationId: '', method: 'get', path: '/widgets', isCollection: true }, empty),
      'listWidgets'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'get', path: '/widgets/{id}', isCollection: false },
        empty
      ),
      'getWidgets'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'post', path: '/widgets', isCollection: false },
        empty
      ),
      'createWidgets'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'put', path: '/widgets/{id}', isCollection: false },
        empty
      ),
      'updateWidgets'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'patch', path: '/widgets/{id}', isCollection: false },
        empty
      ),
      'patchWidgets'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'delete', path: '/widgets/{id}', isCollection: false },
        empty
      ),
      'deleteWidgets'
    );
  });

  it('preserves interior camel humps (unlike legacy toPascalCase)', () => {
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'get', path: '/measurementTypes', isCollection: true },
        empty
      ),
      'listMeasurementTypes'
    );
    assert.strictEqual(
      proposeName(
        { operationId: '', method: 'get', path: '/equipmentISGTypes', isCollection: true },
        empty
      ),
      'listEquipmentISGTypes'
    );
  });

  it('walks the tiebreak chain: base -> two-segment -> full path -> By<Param>', () => {
    const op: SurfaceOp = {
      operationId: '',
      method: 'get',
      path: '/alpha/beta/gamma/{id}',
      isCollection: false,
    };
    assert.strictEqual(proposeName(op, new Set()), 'getGamma');
    assert.strictEqual(proposeName(op, new Set(['getGamma'])), 'getBetaGamma');
    assert.strictEqual(proposeName(op, new Set(['getGamma', 'getBetaGamma'])), 'getAlphaBetaGamma');
    assert.strictEqual(
      proposeName(op, new Set(['getGamma', 'getBetaGamma', 'getAlphaBetaGamma'])),
      'getAlphaBetaGammaById'
    );
  });

  it('never returns a bare verb: pathless-of-segments falls back to Item, then By<Param>', () => {
    const op: SurfaceOp = { operationId: '', method: 'get', path: '/{id}', isCollection: false };
    assert.strictEqual(proposeName(op, new Set()), 'getItem');
    assert.strictEqual(proposeName(op, new Set(['getItem'])), 'getItemById');
  });

  it('throws when every candidate is taken, naming the op and the candidates', () => {
    const op: SurfaceOp = {
      operationId: '',
      method: 'get',
      path: '/alpha/beta/gamma/{id}',
      isCollection: false,
    };
    const taken = new Set([
      'getGamma',
      'getBetaGamma',
      'getAlphaBetaGamma',
      'getAlphaBetaGammaById',
    ]);
    assert.throws(
      () => proposeName(op, taken),
      (err: Error) => {
        assert.match(err.message, /GET \/alpha\/beta\/gamma\/\{_\}/);
        assert.match(err.message, /getGamma/);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// resolveMethodNames
// ---------------------------------------------------------------------------

describe('resolveMethodNames', () => {
  it('pins to the manifest name even when the heuristic would differ', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: {
        'field-operations-api': [{ op: 'GET /fieldOperations/{operationId}', name: 'get' }],
      },
    };
    const ops: SurfaceOp[] = [
      {
        operationId: 'x',
        method: 'get',
        path: '/fieldOperations/{operationId}',
        isCollection: false,
      },
    ];
    const { names, newEntries, missing } = resolveMethodNames('field-operations-api', ops, surface);
    // Heuristic would say getFieldOperations; the manifest pins it to get.
    assert.strictEqual(names.get('GET /fieldOperations/{_}'), 'get');
    assert.deepStrictEqual(newEntries, []);
    assert.deepStrictEqual(missing, []);
  });

  it('proposes names for new ops and reports them as newEntries', () => {
    const surface: ApiSurface = { version: 1, specs: {} };
    const ops: SurfaceOp[] = [
      { operationId: 'x', method: 'get', path: '/widgets', isCollection: true },
    ];
    const { names, newEntries, missing } = resolveMethodNames('spec', ops, surface);
    assert.strictEqual(names.get('GET /widgets'), 'listWidgets');
    assert.deepStrictEqual(newEntries, [{ op: 'GET /widgets', name: 'listWidgets' }]);
    assert.deepStrictEqual(missing, []);
    assert.strictEqual(classifyRun({ newEntries, missing }), 'additive');
  });

  it('reports manifest entries with no matching op as missing (breaking)', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: { spec: [{ op: 'GET /gone', name: 'listGone' }] },
    };
    const { missing } = resolveMethodNames('spec', [], surface);
    assert.deepStrictEqual(missing, [{ op: 'GET /gone', name: 'listGone' }]);
    assert.strictEqual(classifyRun({ newEntries: [], missing }), 'breaking');
  });

  it('lets an implied listAll twin block a colliding proposal', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: { spec: [{ op: 'GET /widgets', name: 'list' }] },
    };
    const ops: SurfaceOp[] = [
      // Pinned collection GET named list -> reserves the derived listAll twin.
      { operationId: 'a', method: 'get', path: '/widgets', isCollection: true },
      // New collection GET whose natural candidate is listAll -> must skip past it.
      { operationId: 'b', method: 'get', path: '/things/all', isCollection: true },
    ];
    const { names, newEntries } = resolveMethodNames('spec', ops, surface);
    assert.strictEqual(names.get('GET /widgets'), 'list');
    assert.strictEqual(names.get('GET /things/all'), 'listThingsAll');
    assert.deepStrictEqual(newEntries, [{ op: 'GET /things/all', name: 'listThingsAll' }]);
  });
});

// ---------------------------------------------------------------------------
// classifyRun
// ---------------------------------------------------------------------------

describe('classifyRun', () => {
  it('is breaking when anything is missing (even with new ops)', () => {
    assert.strictEqual(classifyRun({ newEntries: [{}], missing: [{}] }), 'breaking');
    assert.strictEqual(classifyRun({ newEntries: [], missing: [{}] }), 'breaking');
  });
  it('is additive when there are new ops and nothing missing', () => {
    assert.strictEqual(classifyRun({ newEntries: [{}], missing: [] }), 'additive');
  });
  it('is benign when nothing is new or missing', () => {
    assert.strictEqual(classifyRun({ newEntries: [], missing: [] }), 'benign');
  });
});

// ---------------------------------------------------------------------------
// Property tests (class-elimination law + collision-freedom)
// ---------------------------------------------------------------------------

interface OpShape {
  method: SurfaceOp['method'];
  tailSegs: string[];
  params: string[];
}

const methodArb = fc.constantFrom<SurfaceOp['method']>('get', 'post', 'put', 'patch', 'delete');
const segArb = fc.constantFrom(
  'widgets',
  'fields',
  'equipment',
  'measurementTypes',
  'all',
  'types'
);
const paramArb = fc.constantFrom('id', 'orgId', 'fieldId');

const shapeArb = fc.record<OpShape>({
  method: methodArb,
  tailSegs: fc.array(segArb, { maxLength: 2 }),
  params: fc.array(paramArb, { maxLength: 2 }),
});

/**
 * A unique per-index leading segment (`r${i}`) guarantees every generated op
 * has a distinct opKey and a distinct full-path proposal candidate, so the
 * proposer never exhausts (no spurious throws inside the properties).
 */
function shapeToOp(i: number, shape: OpShape): SurfaceOp {
  const parts = [`r${i}`, ...shape.tailSegs];
  let path = `/${parts.join('/')}`;
  for (const p of shape.params) path += `/{${p}}`;
  const lastSegment = path.split('/').pop() || '';
  return {
    operationId: `op${i}`,
    method: shape.method,
    path,
    isCollection: shape.method === 'get' && !lastSegment.startsWith('{'),
  };
}

const opsArb = fc
  .array(shapeArb, { minLength: 1, maxLength: 8 })
  .map((shapes) => shapes.map((s, i) => shapeToOp(i, s)));

function namesObject(spec: string, ops: SurfaceOp[], surface: ApiSurface): Record<string, string> {
  return Object.fromEntries(resolveMethodNames(spec, ops, surface).names);
}

describe('resolveMethodNames properties', () => {
  it('names are invariant under ops order (empty surface)', () => {
    fc.assert(
      fc.property(opsArb, fc.integer(), (ops, seed) => {
        const surface: ApiSurface = { version: 1, specs: {} };
        assert.deepStrictEqual(
          namesObject('spec', ops, surface),
          namesObject('spec', seededShuffle(ops, seed), surface)
        );
      }),
      { numRuns: 60 }
    );
  });

  it('names are invariant under ops order (surface pinning a random subset)', () => {
    fc.assert(
      fc.property(opsArb, fc.integer(), fc.integer(), (ops, pinSeed, shufSeed) => {
        const base = resolveMethodNames('spec', ops, { version: 1, specs: {} }).names;
        let s = pinSeed >>> 0 || 1;
        const pinned = ops
          .filter(() => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s % 2 === 0;
          })
          .map((op) => ({
            op: `${op.method.toUpperCase()} ${op.path}`,
            name: base.get(opKey(op.method, op.path)) as string,
          }));
        const surface: ApiSurface = { version: 1, specs: { spec: pinned } };
        assert.deepStrictEqual(
          namesObject('spec', ops, surface),
          namesObject('spec', seededShuffle(ops, shufSeed), surface)
        );
      }),
      { numRuns: 60 }
    );
  });

  it('resolved names never collide with each other', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const { names } = resolveMethodNames('spec', ops, { version: 1, specs: {} });
        const values = [...names.values()];
        assert.strictEqual(new Set(values).size, values.length);
      }),
      { numRuns: 60 }
    );
  });
});
