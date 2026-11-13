/**
 * Unit + property tests for scripts/lib/api-surface.ts.
 *
 * The library is the committed operation-identity manifest: it maps
 * (HTTP method, normalized path) to public method names so an upstream spec
 * reorder cannot silently rebind a name. These tests cover loader validation,
 * deterministic serialization + round-trip, the deterministic name proposer,
 * order-independent resolution, and run
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
  acceptSignatures,
  buildSyncReport,
  classifyRun,
  loadApiSurface,
  normalizePathPattern,
  opKey,
  proposeName,
  resolveMethodNames,
  resolveSurface,
  type SurfaceEntry,
  type SurfaceOp,
  serializeApiSurface,
  stopReasons,
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

  it('throws a clear error when the manifest file is missing (points at git history, not a seed script)', () => {
    withTempDir((dir) => {
      const missing = join(dir, 'nope.yaml');
      assert.throws(
        () => loadApiSurface(missing),
        (err: Error) => {
          assert.match(err.message, /manifest file missing/);
          assert.match(err.message, /committed and version-controlled/);
          assert.match(err.message, /git history/);
          // The seed script was deleted; the remediation must not point at it.
          assert.doesNotMatch(err.message, /seed-api-surface/);
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

  it('loads sibling entries sharing a normalized key when their raw paths differ', () => {
    // crop-types declares GET /cropTypes/{name} and GET /cropTypes/{id} as two
    // distinct operations. Both normalize to GET /cropTypes/{_}, but their raw
    // paths differ, so the manifest may legally carry both: param names are the
    // only feature distinguishing these siblings.
    const surface = loadYaml(`
version: 1
specs:
  crop-types:
    - op: GET /cropTypes/{name}
      name: get
    - op: GET /cropTypes/{id}
      name: getCroptypes
`);
    assert.deepStrictEqual(surface.specs['crop-types'], [
      { op: 'GET /cropTypes/{name}', name: 'get' },
      { op: 'GET /cropTypes/{id}', name: 'getCroptypes' },
    ]);
  });

  it('throws on a duplicate raw op string within a spec (identical method + exact path)', () => {
    assert.throws(
      () =>
        loadYaml(`
version: 1
specs:
  crop-types:
    - op: GET /cropTypes/{name}
      name: getA
    - op: GET /cropTypes/{name}
      name: getB
`),
      (err: Error) => {
        assert.match(err.message, /spec "crop-types"/);
        assert.match(err.message, /duplicate operation/);
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

  it('loads a signature, and leaves the key off an entry that has none', () => {
    const surface = loadYaml(
      'version: 1\nspecs:\n  equipment:\n' +
        '    - op: GET /equipment\n      name: get\n' +
        '      signature: "(options?: RequestOptions) => unknown"\n' +
        '    - op: GET /equipmentMakes\n      name: list\n'
    );
    assert.deepStrictEqual(surface.specs.equipment, [
      { op: 'GET /equipment', name: 'get', signature: '(options?: RequestOptions) => unknown' },
      { op: 'GET /equipmentMakes', name: 'list' },
    ]);
    assert.ok(!('signature' in surface.specs.equipment[1]), 'no key, not a key set to undefined');
  });

  // The text is printed when it stops a run, so it has to be one line of it.
  for (const [what, value] of [
    ['empty', '""'],
    ['a number', '42'],
    ['null', 'null'],
    ['a list', '[a, b]'],
    ['on two lines', '"(string) =>\\n void"'],
    ['split by a carriage return', '"(string) =>\\r void"'],
  ] as const) {
    it(`throws when a signature is ${what}`, () => {
      assert.throws(
        () =>
          loadYaml(
            `version: 1\nspecs:\n  equipment:\n    - op: GET /equipment\n      name: get\n      signature: ${value}`
          ),
        (err: Error) => {
          assert.match(err.message, /spec "equipment" entry\[0\]: "signature" must be/);
          assert.match(err.message, /pnpm accept-signatures/);
          return true;
        }
      );
    });
  }
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
    // The identity paragraph states the sibling-param exception (crop-types).
    assert.match(out, /sibling operations/);
    assert.match(out, /cropTypes/);
    // What a pinned signature is, and the two ways out when one stops a run.
    assert.match(out, /"signature:"/);
    assert.match(out, /pnpm accept-signatures/);
    assert.match(out, /scripts\/fix-specs\.ts/);
    assert.ok(!out.includes('—') && !out.includes('–'), 'no em or en dashes in header');
    assert.ok(!out.includes(' -- '), 'no dash-substitute in header');
  });

  // A signature holds quotes, braces, colons and pipes, all of which mean
  // something to YAML.
  const pinned: ApiSurface = {
    version: 1,
    specs: {
      fields: [
        {
          op: 'DELETE /organizations/{orgId}/fields/{fieldId}',
          name: 'delete',
          signature: '(string, string, options?: RequestOptions) => void',
        },
        {
          op: 'GET /organizations/{orgId}/fields',
          name: 'list',
          signature:
            "(string, params?: { embed?: string[]; recordFilter?: 'ALL' | 'ARCHIVED' }, " +
            "options?: RequestOptions) => PaginatedResponse<components['schemas']['Field']>",
        },
        { op: 'POST /organizations/{orgId}/fields', name: 'create' },
      ],
    },
  };

  it('round-trips the signatures the generator writes', () => {
    assert.deepStrictEqual(loadYaml(serializeApiSurface(pinned)), pinned);
  });

  // The loader's rule is "any one line of text", so that is what has to
  // survive: text that reads to YAML as a number, a boolean, a comment, an
  // anchor, a tag, a list, or a line break of YAML's own.
  it('round-trips any one line of text as a signature, on one line', () => {
    const awkward = [
      ' leading and trailing ',
      '# not a comment',
      'a #b',
      'key: value',
      '!tag',
      '&anchor',
      '*alias',
      '%TAG',
      '@at',
      '`tick`',
      'it\'s "both"',
      'back\\slash',
      'é 漢字 😀',
      'line separator',
      'next\u0085line',
      'tab\there',
      '123',
      '1e3',
      'true',
      'null',
      '~',
      '- a',
      '? q',
      '[a]',
      '{a}',
      '|',
      '>',
      '---',
      'x'.repeat(5000),
      // Long, with places to break it and a ": " in every word: what a writer
      // that folds long lines would fold.
      `${'key: value '.repeat(800)}end`,
    ];
    const oneLine = fc.string({ unit: 'grapheme', minLength: 1 }).filter((s) => !/[\r\n]/.test(s));

    const roundTrips = (signature: string) => {
      const surface: ApiSurface = {
        version: 1,
        specs: { spec: [{ op: 'GET /a', name: 'get', signature }] },
      };
      const out = serializeApiSurface(surface);
      assert.deepStrictEqual(loadYaml(out), surface, JSON.stringify(signature));
      const body = out.slice(out.indexOf('version: 1')).trimEnd().split('\n');
      assert.strictEqual(body.length, 6, `signature spilled onto another line: ${out}`);
    };

    for (const signature of awkward) roundTrips(signature);
    fc.assert(fc.property(oneLine, roundTrips), { numRuns: 150 });
  });

  it('writes a signature after op and name, on one line, and no key where there is none', () => {
    // The key order of the object handed in is not what decides it.
    const scrambled: ApiSurface = {
      version: 1,
      specs: {
        fields: pinned.specs.fields.map(({ op, name, signature }) =>
          signature === undefined ? { name, op } : { signature, name, op }
        ),
      },
    };
    const out = serializeApiSurface(scrambled);
    assert.strictEqual(out, serializeApiSurface(pinned));

    const body = out.slice(out.indexOf('version: 1')).split('\n');
    const keys = body.map((line) => /^\s+(?:- )?(op|name|signature):/.exec(line)?.[1] ?? '');
    assert.deepStrictEqual(keys.filter(Boolean), [
      'op',
      'name',
      'signature',
      'op',
      'name',
      'signature',
      'op',
      'name',
    ]);
    // Every line of the body is a key of its own: no signature was folded.
    assert.deepStrictEqual(
      body.filter((line) => line.trim() !== '' && !/^\s*(?:- )?[a-z]+:/.test(line)),
      []
    );
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

  it('falls back to Item for an all-punctuation segment instead of a bare verb', () => {
    // A non-param segment with no alphanumerics strips to '' under capHump,
    // which would otherwise leave a bare "delete"; the suffix falls back to Item.
    const op: SurfaceOp = { operationId: '', method: 'delete', path: '/!!!', isCollection: false };
    assert.strictEqual(proposeName(op, new Set()), 'deleteItem');
    // The By<Param> tiebreak still chains off the Item fallback.
    const withParam: SurfaceOp = {
      operationId: '',
      method: 'delete',
      path: '/!!!/{id}',
      isCollection: false,
    };
    assert.strictEqual(proposeName(withParam, new Set()), 'deleteItem');
    assert.strictEqual(proposeName(withParam, new Set(['deleteItem'])), 'deleteItemById');
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

  // listAll is never an entry's name. It is the twin the generator derives
  // from `list`, and the loader refuses a manifest that names one, so a
  // proposal of it was written out and then stopped every later run at load.
  it('never proposes listAll, even when nothing has taken it', () => {
    const nested: SurfaceOp = {
      operationId: '',
      method: 'get',
      path: '/things/all',
      isCollection: true,
    };
    assert.strictEqual(proposeName(nested, new Set()), 'listThingsAll');

    // With no other segment to prepend there is nothing left to propose, and
    // a person has to name it.
    const lone: SurfaceOp = { operationId: '', method: 'get', path: '/all', isCollection: true };
    assert.throws(
      () => proposeName(lone, new Set()),
      (err: Error) => {
        assert.match(err.message, /GET \/all/);
        assert.match(err.message, /listAll/);
        return true;
      }
    );
  });

  it('proposes a name the loader accepts for a collection whose last segment is "all"', () => {
    const ops: SurfaceOp[] = [
      { operationId: '', method: 'get', path: '/things/all', isCollection: true },
    ];
    const { newEntries } = resolveMethodNames('spec', ops, { version: 1, specs: {} });
    const written = serializeApiSurface({ version: 1, specs: { spec: newEntries } });

    assert.deepStrictEqual(loadYaml(written).specs.spec, [
      { op: 'GET /things/all', name: 'listThingsAll' },
    ]);
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
    // names is keyed by the op's raw path (real param names), not the normalized key.
    assert.strictEqual(names.get('GET /fieldOperations/{operationId}'), 'get');
    assert.deepStrictEqual(newEntries, []);
    assert.deepStrictEqual(missing, []);
  });

  it('pins both sibling ops sharing a normalized key by exact raw path (crop-types shape)', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: {
        'crop-types': [
          { op: 'GET /cropTypes/{name}', name: 'get' },
          { op: 'GET /cropTypes/{id}', name: 'getCroptypes' },
        ],
      },
    };
    const ops: SurfaceOp[] = [
      { operationId: 'a', method: 'get', path: '/cropTypes/{name}', isCollection: false },
      { operationId: 'b', method: 'get', path: '/cropTypes/{id}', isCollection: false },
    ];
    const { names, newEntries, missing } = resolveMethodNames('crop-types', ops, surface);
    assert.strictEqual(names.get('GET /cropTypes/{name}'), 'get');
    assert.strictEqual(names.get('GET /cropTypes/{id}'), 'getCroptypes');
    assert.deepStrictEqual(newEntries, []);
    assert.deepStrictEqual(missing, []);
  });

  it('surfaces a param rename inside an ambiguous group as breaking (exact match only)', () => {
    // Manifest still declares both siblings; upstream renamed {id} -> {code}.
    const surface: ApiSurface = {
      version: 1,
      specs: {
        'crop-types': [
          { op: 'GET /cropTypes/{name}', name: 'get' },
          { op: 'GET /cropTypes/{id}', name: 'getCroptypes' },
        ],
      },
    };
    const ops: SurfaceOp[] = [
      { operationId: 'a', method: 'get', path: '/cropTypes/{name}', isCollection: false },
      { operationId: 'b', method: 'get', path: '/cropTypes/{code}', isCollection: false },
    ];
    const { names, newEntries, missing } = resolveMethodNames('crop-types', ops, surface);
    // {name} still pins by exact match.
    assert.strictEqual(names.get('GET /cropTypes/{name}'), 'get');
    // {id} entry has no exact op -> missing (the breaking signal).
    assert.deepStrictEqual(missing, [{ op: 'GET /cropTypes/{id}', name: 'getCroptypes' }]);
    // {code} op has no exact entry -> new.
    assert.strictEqual(newEntries.length, 1);
    assert.strictEqual(newEntries[0].op, 'GET /cropTypes/{code}');
    assert.strictEqual(names.get('GET /cropTypes/{code}'), newEntries[0].name);
    assert.strictEqual(classifyRun({ newEntries, missing }), 'breaking');
  });

  it('absorbs a param rename in a single-entry group (orgId -> organizationId)', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: {
        'field-operations-api': [{ op: 'GET /organizations/{orgId}/fields', name: 'listFields' }],
      },
    };
    const ops: SurfaceOp[] = [
      {
        operationId: 'x',
        method: 'get',
        path: '/organizations/{organizationId}/fields',
        isCollection: true,
      },
    ];
    const { names, newEntries, missing } = resolveMethodNames('field-operations-api', ops, surface);
    // One entry + one op sharing a normalized key: the rename is absorbed silently.
    assert.strictEqual(names.get('GET /organizations/{organizationId}/fields'), 'listFields');
    assert.deepStrictEqual(newEntries, []);
    assert.deepStrictEqual(missing, []);
  });

  it('ambiguity growth: one entry vs two ops pins the exact match, flags the other new', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: { spec: [{ op: 'GET /x/{a}', name: 'foo' }] },
    };
    const ops: SurfaceOp[] = [
      { operationId: '1', method: 'get', path: '/x/{a}', isCollection: false },
      { operationId: '2', method: 'get', path: '/x/{b}', isCollection: false },
    ];
    const { names, newEntries, missing } = resolveMethodNames('spec', ops, surface);
    assert.strictEqual(names.get('GET /x/{a}'), 'foo'); // exact match pins
    assert.deepStrictEqual(missing, []);
    assert.strictEqual(newEntries.length, 1);
    assert.strictEqual(newEntries[0].op, 'GET /x/{b}'); // no exact entry -> new
    assert.strictEqual(classifyRun({ newEntries, missing }), 'additive');
  });

  it('ambiguity growth with no exact match: the entry is missing and both ops are new', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: { spec: [{ op: 'GET /x/{a}', name: 'foo' }] },
    };
    const ops: SurfaceOp[] = [
      { operationId: '1', method: 'get', path: '/x/{b}', isCollection: false },
      { operationId: '2', method: 'get', path: '/x/{c}', isCollection: false },
    ];
    const { newEntries, missing } = resolveMethodNames('spec', ops, surface);
    // Two ops make the group ambiguous; the single entry has no exact-path op.
    assert.deepStrictEqual(missing, [{ op: 'GET /x/{a}', name: 'foo' }]);
    assert.deepStrictEqual(newEntries.map((e) => e.op).sort(), ['GET /x/{b}', 'GET /x/{c}']);
    assert.strictEqual(classifyRun({ newEntries, missing }), 'breaking');
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
// Pinned signatures
// ---------------------------------------------------------------------------

describe('resolveMethodNames with pinned signatures', () => {
  const ONE = '(string, options?: RequestOptions) => void';
  const TWO = '(string, string, options?: RequestOptions) => void';

  const item = (path: string, signature?: string): SurfaceOp => ({
    operationId: '',
    method: 'get',
    path,
    isCollection: false,
    ...(signature === undefined ? {} : { signature }),
  });
  const surfaceOf = (...entries: SurfaceEntry[]): ApiSurface => ({
    version: 1,
    specs: { spec: entries },
  });

  it('reports nothing when the pinned signature is the current one', () => {
    const surface = surfaceOf({ op: 'GET /widgets/{id}', name: 'get', signature: ONE });
    const { changedSignatures } = resolveMethodNames('spec', [item('/widgets/{id}', ONE)], surface);
    assert.deepStrictEqual(changedSignatures, []);
  });

  it('reports a different one with both texts, and still resolves the name', () => {
    const surface = surfaceOf({ op: 'GET /widgets/{id}', name: 'get', signature: ONE });
    const { changedSignatures, names, newEntries, missing } = resolveMethodNames(
      'spec',
      [item('/widgets/{id}', TWO)],
      surface
    );
    assert.deepStrictEqual(changedSignatures, [
      { op: 'GET /widgets/{id}', name: 'get', pinned: ONE, current: TWO },
    ]);
    // A signature never decides a name, or whether an operation is new or gone.
    assert.strictEqual(names.get('GET /widgets/{id}'), 'get');
    assert.deepStrictEqual(newEntries, []);
    assert.deepStrictEqual(missing, []);
  });

  it('reports an entry with no signature, with nothing as what was pinned', () => {
    const surface = surfaceOf({ op: 'GET /widgets/{id}', name: 'get' });
    const { changedSignatures } = resolveMethodNames('spec', [item('/widgets/{id}', ONE)], surface);
    assert.deepStrictEqual(changedSignatures, [
      { op: 'GET /widgets/{id}', name: 'get', current: ONE },
    ]);
    assert.ok(!('pinned' in changedSignatures[0]));
  });

  it("gives a new entry its operation's signature, and reports no change for it", () => {
    const { newEntries, changedSignatures } = resolveMethodNames(
      'spec',
      [item('/widgets/{id}', ONE)],
      surfaceOf()
    );
    assert.deepStrictEqual(newEntries, [
      { op: 'GET /widgets/{id}', name: 'getWidgets', signature: ONE },
    ]);
    assert.deepStrictEqual(changedSignatures, []);
  });

  // The entry still says {widgetId}. The rename is absorbed for the name, and
  // the signature is compared across it all the same.
  it('compares across a renamed path parameter, reporting under the entry as written', () => {
    const surface = surfaceOf({ op: 'GET /widgets/{widgetId}', name: 'get', signature: ONE });
    assert.deepStrictEqual(
      resolveMethodNames('spec', [item('/widgets/{id}', ONE)], surface).changedSignatures,
      []
    );
    assert.deepStrictEqual(
      resolveMethodNames('spec', [item('/widgets/{id}', TWO)], surface).changedSignatures,
      [{ op: 'GET /widgets/{widgetId}', name: 'get', pinned: ONE, current: TWO }]
    );
  });

  it('compares siblings that differ only by parameter name each with its own entry', () => {
    const surface = surfaceOf(
      { op: 'GET /cropTypes/{name}', name: 'get', signature: ONE },
      { op: 'GET /cropTypes/{id}', name: 'getById', signature: TWO }
    );
    const ops = [item('/cropTypes/{id}', TWO), item('/cropTypes/{name}', TWO)];
    assert.deepStrictEqual(resolveMethodNames('spec', ops, surface).changedSignatures, [
      { op: 'GET /cropTypes/{name}', name: 'get', pinned: ONE, current: TWO },
    ]);
  });

  it('compares nothing for an operation handed in without a signature', () => {
    const surface = surfaceOf({ op: 'GET /widgets/{id}', name: 'get', signature: ONE });
    const { changedSignatures } = resolveMethodNames('spec', [item('/widgets/{id}')], surface);
    assert.deepStrictEqual(changedSignatures, []);
  });

  it('reports the same changes in the same order whatever order the ops come in', () => {
    const surface = surfaceOf(
      { op: 'GET /a/{id}', name: 'getA', signature: ONE },
      { op: 'GET /b/{id}', name: 'getB', signature: ONE },
      { op: 'GET /c/{id}', name: 'getC', signature: ONE }
    );
    const ops = [item('/c/{id}', TWO), item('/a/{id}', TWO), item('/b/{id}', ONE)];
    const forwards = resolveMethodNames('spec', ops, surface).changedSignatures;
    const backwards = resolveMethodNames('spec', [...ops].reverse(), surface).changedSignatures;
    assert.deepStrictEqual(
      forwards.map((c) => c.op),
      ['GET /a/{id}', 'GET /c/{id}']
    );
    assert.deepStrictEqual(backwards, forwards);
  });
});

describe('acceptSignatures', () => {
  const surface: ApiSurface = {
    version: 1,
    specs: {
      fields: [
        { op: 'GET /a', name: 'list', signature: 'old' },
        { op: 'GET /a/{id}', name: 'get', signature: 'kept' },
        { op: 'POST /a', name: 'create' },
      ],
      farms: [{ op: 'GET /b', name: 'list', signature: 'untouched' }],
    },
  };

  it('replaces the signatures it is given and nothing else', () => {
    const before = structuredClone(surface);
    const accepted = acceptSignatures(surface, [
      {
        specName: 'fields',
        changedSignatures: [
          { op: 'GET /a', name: 'list', pinned: 'old', current: 'new' },
          { op: 'POST /a', name: 'create', current: 'first' },
        ],
      },
      { specName: 'farms', changedSignatures: [] },
    ]);

    assert.deepStrictEqual(accepted, {
      version: 1,
      specs: {
        fields: [
          { op: 'GET /a', name: 'list', signature: 'new' },
          { op: 'GET /a/{id}', name: 'get', signature: 'kept' },
          { op: 'POST /a', name: 'create', signature: 'first' },
        ],
        farms: [{ op: 'GET /b', name: 'list', signature: 'untouched' }],
      },
    });
    assert.deepStrictEqual(surface, before, 'the surface handed in is left as it was');
  });

  it('refuses a signature for an entry the spec does not have', () => {
    assert.throws(
      () =>
        acceptSignatures(surface, [
          {
            specName: 'fields',
            changedSignatures: [{ op: 'GET /nowhere', name: 'x', current: 'y' }],
          },
        ]),
      /cannot accept a signature for GET \/nowhere: spec "fields" has no such entry/
    );
  });

  // The point of accepting: the same operations, resolved against what comes
  // back, have nothing left to report, and keep the names they had.
  it('leaves nothing to report when its result is resolved again', () => {
    const ops: SurfaceOp[] = [
      { operationId: '', method: 'get', path: '/a', isCollection: true, signature: 'new' },
      { operationId: '', method: 'get', path: '/a/{key}', isCollection: false, signature: 'kept' },
      { operationId: '', method: 'post', path: '/a', isCollection: false, signature: 'first' },
    ];
    const first = resolveMethodNames('fields', ops, surface);
    assert.strictEqual(first.changedSignatures.length, 2);

    const accepted = acceptSignatures(surface, [
      { specName: 'fields', changedSignatures: first.changedSignatures },
    ]);
    const second = resolveMethodNames('fields', ops, accepted);
    assert.deepStrictEqual(second.changedSignatures, []);
    assert.deepStrictEqual([...second.names], [...first.names]);
  });
});

// generate-sdk's main() only reports what this decides, and main() cannot be
// run from a test. Every combination is written out because one wrong answer
// here is an unreviewed release.
describe('stopReasons', () => {
  const operation = { spec: 's', method: 'GET', path: '/a', name: 'get' };
  const report = (missing: boolean, changed: boolean, absent: boolean) => ({
    missingOperations: missing ? [operation] : [],
    changedSignatures: changed ? [{ ...operation, pinned: 'A', current: 'B' }] : [],
    absentSpecs: absent ? ['s'] : [],
  });

  const cases: Array<
    [
      missing: boolean,
      changed: boolean,
      absent: boolean,
      accept: boolean,
      stopsFor: [boolean, boolean],
      why: string,
    ]
  > = [
    [false, false, false, false, [false, false], 'nothing to stop for'],
    [false, false, false, true, [false, false], 'nothing to accept either'],
    [false, true, false, false, [false, true], 'a changed signature stops a plain run'],
    [false, true, false, true, [false, false], 'accepting is what lets it through'],
    [true, false, false, false, [true, false], 'a missing operation stops a plain run'],
    [true, false, false, true, [true, false], 'and an accepting run just the same'],
    [true, true, false, false, [true, true], 'both are reported when both are true'],
    [
      true,
      true,
      false,
      true,
      [true, false],
      'accepting signatures does not accept a missing operation',
    ],
    // An absent spec comes with its entries as missing operations. It stops
    // the run on its own as well, so the class cannot be dropped even if its
    // entries were somehow not listed.
    [true, false, true, false, [true, false], 'a spec with no file stops a plain run'],
    [true, false, true, true, [true, false], 'accepting signatures does not accept it either'],
    [false, false, true, false, [true, false], 'the absent spec alone is enough to stop'],
    [false, false, true, true, [true, false], 'also when accepting signatures'],
  ];

  for (const [missing, changed, absent, accept, [forMissing, forSignatures], why] of cases) {
    it(`missing=${missing} changed=${changed} absent=${absent} accept=${accept}: ${why}`, () => {
      assert.deepStrictEqual(
        stopReasons(report(missing, changed, absent), { acceptSignatures: accept }),
        { missing: forMissing, signatures: forSignatures }
      );
    });
  }
});

// ---------------------------------------------------------------------------
// resolveSurface
// ---------------------------------------------------------------------------

describe('resolveSurface', () => {
  const op = (method: SurfaceOp['method'], path: string): SurfaceOp => ({
    operationId: `${method}${path}`,
    method,
    path,
    isCollection: false,
  });
  const entry = (op: string, name: string): SurfaceEntry => ({ op, name });

  it('reports every entry of a manifest spec with no file as missing, and the run as breaking', () => {
    const surface: ApiSurface = {
      version: 1,
      specs: {
        present: [entry('GET /p', 'getP')],
        gone: [entry('GET /g/{id}', 'get'), entry('DELETE /g/{id}', 'delete')],
      },
    };
    const { namesBySpec, perSpec } = resolveSurface(surface, [
      { specName: 'present', operations: [op('get', '/p')] },
    ]);

    assert.deepStrictEqual(perSpec, [
      {
        specName: 'gone',
        newEntries: [],
        missing: surface.specs.gone,
        changedSignatures: [],
        absent: true,
      },
      { specName: 'present', newEntries: [], missing: [], changedSignatures: [], absent: false },
    ]);
    // It gets no names: there is no class to write for it.
    assert.deepStrictEqual([...namesBySpec.keys()], ['present']);

    const report = buildSyncReport(perSpec);
    assert.strictEqual(report.classification, 'breaking');
    assert.deepStrictEqual(report.absentSpecs, ['gone']);
    assert.deepStrictEqual(
      report.missingOperations.map((o) => `${o.spec} ${o.method} ${o.path} ${o.name}`),
      ['gone DELETE /g/{id} delete', 'gone GET /g/{id} get']
    );
    assert.deepStrictEqual(stopReasons(report, { acceptSignatures: true }).missing, true);
  });

  it('passes over a manifest spec with no entries and no file', () => {
    const surface: ApiSurface = { version: 1, specs: { empty: [] } };
    const { namesBySpec, perSpec } = resolveSurface(surface, []);
    assert.deepStrictEqual(perSpec, []);
    assert.strictEqual(namesBySpec.size, 0);
    const report = buildSyncReport(perSpec);
    assert.strictEqual(report.classification, 'benign');
    assert.deepStrictEqual(report.absentSpecs, []);
  });

  it('reports a spec file with no operations as missing them, not as absent', () => {
    const surface: ApiSurface = { version: 1, specs: { hollow: [entry('GET /h', 'getH')] } };
    const { perSpec } = resolveSurface(surface, [{ specName: 'hollow', operations: [] }]);
    assert.deepStrictEqual(perSpec, [
      {
        specName: 'hollow',
        newEntries: [],
        missing: surface.specs.hollow,
        changedSignatures: [],
        absent: false,
      },
    ]);
    const report = buildSyncReport(perSpec);
    assert.strictEqual(report.classification, 'breaking');
    assert.deepStrictEqual(report.absentSpecs, []);
  });

  it('proposes names for a spec the manifest does not know, as an additive run', () => {
    const { namesBySpec, perSpec } = resolveSurface({ version: 1, specs: {} }, [
      { specName: 'fresh', operations: [op('get', '/widgets/{id}')] },
    ]);
    assert.deepStrictEqual(perSpec, [
      {
        specName: 'fresh',
        newEntries: [entry('GET /widgets/{id}', 'getWidgets')],
        missing: [],
        changedSignatures: [],
        absent: false,
      },
    ]);
    assert.deepStrictEqual(Object.fromEntries(namesBySpec.get('fresh') ?? []), {
      'GET /widgets/{id}': 'getWidgets',
    });
    const report = buildSyncReport(perSpec);
    assert.strictEqual(report.classification, 'additive');
    assert.deepStrictEqual(report.absentSpecs, []);
  });

  // The committed manifest, with every spec's operations rebuilt from its own
  // entries, and three specs left out so that they are absent.
  const committed = loadApiSurface();
  const specNames = Object.keys(committed.specs).sort();
  const left = specNames.slice(0, 3);
  const parsed = specNames
    .filter((name) => !left.includes(name))
    .map((specName) => ({
      specName,
      operations: committed.specs[specName].map((e) => {
        const [method, path] = e.op.split(' ');
        return { ...op(method.toLowerCase() as SurfaceOp['method'], path), signature: e.signature };
      }),
    }));

  it('gives the names and results the per-spec loop in generate-sdk gave', () => {
    const { namesBySpec, perSpec } = resolveSurface(committed, parsed);
    for (const { specName, operations } of parsed) {
      const old = resolveMethodNames(specName, operations, committed);
      assert.deepStrictEqual(namesBySpec.get(specName), old.names, specName);
      const result = perSpec.find((r) => r.specName === specName);
      assert.deepStrictEqual(
        result,
        {
          specName,
          newEntries: old.newEntries,
          missing: old.missing,
          changedSignatures: old.changedSignatures,
          absent: false,
        },
        specName
      );
    }
    assert.deepStrictEqual(
      perSpec.filter((r) => r.absent).map((r) => r.specName),
      left
    );
  });

  it('does not depend on the order the specs are handed in', () => {
    const expected = resolveSurface(committed, parsed);
    for (const seed of [1, 2, 3, 4, 5]) {
      const shuffled = resolveSurface(committed, seededShuffle(parsed, seed));
      assert.deepStrictEqual(shuffled.perSpec, expected.perSpec, `seed ${seed}`);
      assert.deepStrictEqual(shuffled.namesBySpec, expected.namesBySpec, `seed ${seed}`);
      assert.deepStrictEqual(buildSyncReport(shuffled.perSpec), buildSyncReport(expected.perSpec));
    }
  });
});

describe('the committed manifest', () => {
  // generate-sdk stops on an entry with no signature. This says so sooner,
  // and names them.
  it('pins a signature for every entry', () => {
    const unpinned = Object.entries(loadApiSurface().specs).flatMap(([spec, entries]) =>
      entries
        .filter((entry) => entry.signature === undefined)
        .map((entry) => `${spec}: ${entry.op}`)
    );
    assert.deepStrictEqual(unpinned, [], 'run `pnpm accept-signatures` to pin these');
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
  it('is breaking when a signature changed, alone or alongside new ops', () => {
    assert.strictEqual(
      classifyRun({ newEntries: [], missing: [], changedSignatures: [{}] }),
      'breaking'
    );
    assert.strictEqual(
      classifyRun({ newEntries: [{}], missing: [], changedSignatures: [{}] }),
      'breaking'
    );
  });
  it('takes an empty list of changed signatures for none', () => {
    assert.strictEqual(
      classifyRun({ newEntries: [{}], missing: [], changedSignatures: [] }),
      'additive'
    );
    assert.strictEqual(
      classifyRun({ newEntries: [], missing: [], changedSignatures: [] }),
      'benign'
    );
  });
  it('is additive when there are new ops and nothing missing', () => {
    assert.strictEqual(classifyRun({ newEntries: [{}], missing: [] }), 'additive');
  });
  it('is benign when nothing is new or missing', () => {
    assert.strictEqual(classifyRun({ newEntries: [], missing: [] }), 'benign');
  });
});

// ---------------------------------------------------------------------------
// buildSyncReport
// ---------------------------------------------------------------------------

describe('buildSyncReport', () => {
  it('classifies empty input as benign with four empty arrays', () => {
    const report = buildSyncReport([]);
    assert.strictEqual(report.classification, 'benign');
    assert.deepStrictEqual(report.newOperations, []);
    assert.deepStrictEqual(report.missingOperations, []);
    assert.deepStrictEqual(report.changedSignatures, []);
    assert.deepStrictEqual(report.absentSpecs, []);
  });

  it('lists the absent specs, sorted, and only those', () => {
    const report = buildSyncReport([
      { specName: 'zeta', newEntries: [], missing: [{ op: 'GET /z', name: 'getZ' }], absent: true },
      { specName: 'mid', newEntries: [], missing: [{ op: 'GET /m', name: 'getM' }] },
      {
        specName: 'alpha',
        newEntries: [],
        missing: [{ op: 'GET /a', name: 'getA' }],
        absent: true,
      },
    ]);
    assert.deepStrictEqual(report.absentSpecs, ['alpha', 'zeta']);
    assert.strictEqual(report.classification, 'breaking');
  });

  it('carries changed signatures, null for one that was not pinned, and is breaking', () => {
    const report = buildSyncReport([
      {
        specName: 'zeta',
        newEntries: [{ op: 'GET /new', name: 'listNew' }],
        missing: [],
        changedSignatures: [{ op: 'GET /z', name: 'getZ', pinned: 'A', current: 'B' }],
      },
      {
        specName: 'alpha',
        newEntries: [],
        missing: [],
        changedSignatures: [
          { op: 'GET /organizations/{orgId}/fields', name: 'list', pinned: 'C', current: 'D' },
          { op: 'DELETE /organizations/{orgId}/fields/{fieldId}', name: 'delete', current: 'E' },
        ],
      },
      // A spec handed in the way it was before signatures: no list at all.
      { specName: 'omega', newEntries: [], missing: [] },
    ]);

    assert.strictEqual(report.classification, 'breaking');
    // Flattened, and sorted by (spec, method, path) like the other two lists.
    assert.deepStrictEqual(report.changedSignatures, [
      {
        spec: 'alpha',
        method: 'DELETE',
        path: '/organizations/{orgId}/fields/{fieldId}',
        name: 'delete',
        pinned: null,
        current: 'E',
      },
      {
        spec: 'alpha',
        method: 'GET',
        path: '/organizations/{orgId}/fields',
        name: 'list',
        pinned: 'C',
        current: 'D',
      },
      { spec: 'zeta', method: 'GET', path: '/z', name: 'getZ', pinned: 'A', current: 'B' },
    ]);
  });

  it('classifies new-only as additive and carries the additions', () => {
    const report = buildSyncReport([
      {
        specName: 'equipment',
        newEntries: [{ op: 'GET /widgets', name: 'listWidgets' }],
        missing: [],
      },
    ]);
    assert.strictEqual(report.classification, 'additive');
    assert.deepStrictEqual(report.newOperations, [
      { spec: 'equipment', method: 'GET', path: '/widgets', name: 'listWidgets' },
    ]);
    assert.deepStrictEqual(report.missingOperations, []);
  });

  it('classifies any missing as breaking, even alongside new entries', () => {
    const report = buildSyncReport([
      {
        specName: 'field-operations-api',
        newEntries: [{ op: 'POST /fieldOperations', name: 'create' }],
        missing: [{ op: 'GET /fieldOps/{operationId}', name: 'getFieldops' }],
      },
    ]);
    assert.strictEqual(report.classification, 'breaking');
    assert.deepStrictEqual(report.missingOperations, [
      {
        spec: 'field-operations-api',
        method: 'GET',
        path: '/fieldOps/{operationId}',
        name: 'getFieldops',
      },
    ]);
  });

  it('splits each op display string into method and path (paths with params intact)', () => {
    const report = buildSyncReport([
      {
        specName: 'fields',
        newEntries: [{ op: 'DELETE /organizations/{orgId}/fields/{fieldId}', name: 'delete' }],
        missing: [],
      },
    ]);
    assert.deepStrictEqual(report.newOperations[0], {
      spec: 'fields',
      method: 'DELETE',
      path: '/organizations/{orgId}/fields/{fieldId}',
      name: 'delete',
    });
  });

  it('sorts newOperations by (spec, method, path) across specs', () => {
    const report = buildSyncReport([
      { specName: 'zeta', newEntries: [{ op: 'GET /b', name: 'getB' }], missing: [] },
      {
        specName: 'alpha',
        newEntries: [
          { op: 'POST /a', name: 'createA' },
          { op: 'GET /a', name: 'getA' },
        ],
        missing: [],
      },
    ]);
    assert.deepStrictEqual(
      report.newOperations.map((o) => `${o.spec} ${o.method} ${o.path}`),
      ['alpha GET /a', 'alpha POST /a', 'zeta GET /b']
    );
  });

  it('sorts missingOperations by (spec, method, path) across specs', () => {
    const report = buildSyncReport([
      { specName: 'zeta', newEntries: [], missing: [{ op: 'GET /z', name: 'getZ' }] },
      {
        specName: 'alpha',
        newEntries: [],
        missing: [
          { op: 'GET /m', name: 'getM' },
          { op: 'DELETE /m', name: 'deleteM' },
        ],
      },
    ]);
    assert.deepStrictEqual(
      report.missingOperations.map((o) => `${o.spec} ${o.method} ${o.path}`),
      ['alpha DELETE /m', 'alpha GET /m', 'zeta GET /z']
    );
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
          .map((op) => {
            // names is keyed by the op's raw path, so pin against that key.
            const raw = `${op.method.toUpperCase()} ${op.path}`;
            return { op: raw, name: base.get(raw) as string };
          });
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

// ---------------------------------------------------------------------------
// Property tests with SIBLING ops (same normalized key, distinct param names).
// These exercise the ambiguous-group matching branch: crop-types is the real
// case where two operations differ only by path-param name.
// ---------------------------------------------------------------------------

/** Param names drawn from a set disjoint from paramArb, so a sibling's last
 *  param always differs from the base's and their raw paths are guaranteed
 *  distinct (never a same-raw-path duplicate). */
const siblingParamArb = fc.constantFrom('name', 'code', 'key');

interface SiblingShape {
  base: OpShape;
  siblingParam: string | null;
}

const siblingShapeArb = fc.record<SiblingShape>({
  base: shapeArb,
  siblingParam: fc.option(siblingParamArb, { nil: null }),
});

/**
 * Expand shapes into ops. For any base op that ends in a path param, optionally
 * emit a SIBLING op with the last param renamed. The sibling shares the base's
 * normalized key (all params collapse to {_}) but has a distinct raw path, so
 * some generated ops share a normalized key while others do not.
 */
function shapesToOpsWithSiblings(shapes: SiblingShape[]): SurfaceOp[] {
  const ops: SurfaceOp[] = [];
  shapes.forEach((shape, i) => {
    const base = shapeToOp(i, shape.base);
    ops.push(base);
    if (shape.siblingParam && base.path.endsWith('}')) {
      const siblingPath = base.path.replace(/\{[^}]+\}$/, `{${shape.siblingParam}}`);
      ops.push({
        operationId: `op${i}sibling`,
        method: base.method,
        path: siblingPath,
        isCollection: false,
      });
    }
  });
  return ops;
}

const opsWithSiblingsArb = fc
  .array(siblingShapeArb, { minLength: 1, maxLength: 8 })
  .map(shapesToOpsWithSiblings);

describe('resolveMethodNames properties with sibling ops', () => {
  it('names are invariant under ops order when siblings share a normalized key (empty surface)', () => {
    fc.assert(
      fc.property(opsWithSiblingsArb, fc.integer(), (ops, seed) => {
        const surface: ApiSurface = { version: 1, specs: {} };
        assert.deepStrictEqual(
          namesObject('spec', ops, surface),
          namesObject('spec', seededShuffle(ops, seed), surface)
        );
      }),
      { numRuns: 60 }
    );
  });

  it('names are invariant under ops order with siblings (surface pinning a random subset)', () => {
    fc.assert(
      fc.property(opsWithSiblingsArb, fc.integer(), fc.integer(), (ops, pinSeed, shufSeed) => {
        const base = resolveMethodNames('spec', ops, { version: 1, specs: {} }).names;
        let s = pinSeed >>> 0 || 1;
        const pinned = ops
          .filter(() => {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            return s % 2 === 0;
          })
          .map((op) => {
            const raw = `${op.method.toUpperCase()} ${op.path}`;
            return { op: raw, name: base.get(raw) as string };
          });
        const surface: ApiSurface = { version: 1, specs: { spec: pinned } };
        assert.deepStrictEqual(
          namesObject('spec', ops, surface),
          namesObject('spec', seededShuffle(ops, shufSeed), surface)
        );
      }),
      { numRuns: 60 }
    );
  });

  it('resolved names never collide even with sibling ops', () => {
    fc.assert(
      fc.property(opsWithSiblingsArb, (ops) => {
        const { names } = resolveMethodNames('spec', ops, { version: 1, specs: {} });
        const values = [...names.values()];
        assert.strictEqual(new Set(values).size, values.length);
      }),
      { numRuns: 60 }
    );
  });
});
