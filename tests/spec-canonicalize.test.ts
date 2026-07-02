/**
 * Unit + property tests for scripts/lib/spec-canonicalize.ts.
 *
 * canonicalizeSpec sorts exactly two kinds of maps in a spec document (the
 * top-level `paths` map and every category map under `components`) so a
 * semantically null upstream reorder, like the one that started the June
 * 2026 field-operations incident, produces a byte-identical file once
 * stringified. stringifySpec pins the yaml emission options fix-specs.ts
 * already uses, plus `aliasDuplicateObjects: false` so deduplicated shared
 * object references never surface as YAML anchors. Style follows
 * tests/api-surface.test.ts (node:test + node:assert + fast-check, seeded
 * Fisher-Yates shuffle for order-independence checks).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import { canonicalizeSpec, stringifySpec } from '../scripts/lib/spec-canonicalize.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic LCG-backed Fisher-Yates shuffle (matches tests/api-surface.test.ts). */
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

/** Rebuild an object with the same entries in a shuffled key insertion order. */
function shuffleKeys<T>(obj: Record<string, T>, seed: number): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of seededShuffle(Object.keys(obj), seed)) {
    result[key] = obj[key];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Spec-shaped generator, shared by the order-independence and idempotence
// properties.
// ---------------------------------------------------------------------------

interface PathShape {
  segments: string[];
  param: string | null;
  methods: string[];
}

const segmentArb = fc.constantFrom(
  'orgs',
  'fields',
  'equipment',
  'measurementTypes',
  'operations',
  'assets'
);
const paramArb = fc.constantFrom('orgId', 'fieldId', 'id', 'assetId');
const methodArb = fc.constantFrom('get', 'post', 'put', 'patch', 'delete');

const pathShapeArb: fc.Arbitrary<PathShape> = fc.record({
  segments: fc.array(segmentArb, { minLength: 1, maxLength: 2 }),
  param: fc.option(paramArb, { nil: null }),
  methods: fc.uniqueArray(methodArb, { minLength: 1, maxLength: 4 }),
});

/** A unique per-index leading segment guarantees every generated path is distinct. */
function pathShapeToEntry(i: number, shape: PathShape): [string, Record<string, unknown>] {
  const parts = [`r${i}`, ...shape.segments];
  const path = shape.param ? `/${parts.join('/')}/{${shape.param}}` : `/${parts.join('/')}`;
  const item: Record<string, unknown> = {};
  for (const method of shape.methods) {
    item[method] = { summary: `${method} ${path}`, operationId: `${method}${i}` };
  }
  return [path, item];
}

interface CategoryShape {
  category: string;
  members: string[];
}

const categoryNameArb = fc.constantFrom(
  'schemas',
  'parameters',
  'responses',
  'requestBodies',
  'headers',
  'securitySchemes',
  // A synthetic non-OpenAPI category: canonicalizeComponents is whitelist-free,
  // so an unknown extension category must sort by name and have its members
  // sorted exactly like a standard one. Including it here exercises that
  // tolerance in the order-independence and idempotence properties, not just the
  // deterministic test below.
  'x-futureCategory'
);
const memberNameArb = fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta');

const categoryShapeArb: fc.Arbitrary<CategoryShape> = fc.record({
  category: categoryNameArb,
  members: fc.uniqueArray(memberNameArb, { minLength: 1, maxLength: 4 }),
});

/** 2-3 categories with distinct names (selector dedupes on `category`). */
const componentsShapeArb: fc.Arbitrary<CategoryShape[]> = fc.uniqueArray(categoryShapeArb, {
  selector: (c) => c.category,
  minLength: 2,
  maxLength: 3,
});

function buildComponents(shape: readonly CategoryShape[]): Record<string, unknown> {
  const components: Record<string, unknown> = {};
  for (const { category, members } of shape) {
    const categoryObj: Record<string, unknown> = {};
    members.forEach((member, i) => {
      categoryObj[member] = { type: 'object', description: `${category}.${member}`, 'x-index': i };
    });
    components[category] = categoryObj;
  }
  return components;
}

function buildSpec(
  pathShapes: readonly PathShape[],
  componentsShape: readonly CategoryShape[]
): {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
} {
  const paths: Record<string, unknown> = {};
  pathShapes.forEach((shape, i) => {
    const [path, item] = pathShapeToEntry(i, shape);
    paths[path] = item;
  });
  return {
    openapi: '3.0.0',
    info: { title: 'test-spec', version: '1.0.0' },
    paths,
    components: buildComponents(componentsShape),
  };
}

const specArb = fc.record({
  pathShapes: fc.array(pathShapeArb, { minLength: 1, maxLength: 6 }),
  componentsShape: componentsShapeArb,
});

// ---------------------------------------------------------------------------
// Property: order independence (the reorder-immunity law the June 2026
// incident motivated).
// ---------------------------------------------------------------------------

describe('canonicalizeSpec + stringifySpec: order independence', () => {
  it('a pure paths/components key reorder produces byte-identical stringified output', () => {
    fc.assert(
      fc.property(
        specArb,
        fc.integer(),
        fc.integer(),
        fc.integer(),
        ({ pathShapes, componentsShape }, pathSeed, categorySeed, memberSeed) => {
          const original = buildSpec(pathShapes, componentsShape);

          // Shuffle paths key order, components category order, and each
          // category's own member key order: every reorder surface the June
          // 2026 incident could recur on.
          const shuffledPaths = shuffleKeys(original.paths, pathSeed);
          const shuffledComponents = shuffleKeys(original.components, categorySeed);
          let memberState = memberSeed >>> 0 || 1;
          for (const category of Object.keys(shuffledComponents)) {
            memberState = (Math.imul(memberState, 1664525) + 1013904223) >>> 0;
            shuffledComponents[category] = shuffleKeys(
              shuffledComponents[category] as Record<string, unknown>,
              memberState
            );
          }
          const shuffled = { ...original, paths: shuffledPaths, components: shuffledComponents };

          assert.strictEqual(
            stringifySpec(canonicalizeSpec(shuffled)),
            stringifySpec(canonicalizeSpec(original))
          );
        }
      ),
      { numRuns: 60 }
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

describe('canonicalizeSpec: idempotence', () => {
  it('canonicalizeSpec(canonicalizeSpec(x)) deep-equals canonicalizeSpec(x); stringify of both matches', () => {
    fc.assert(
      fc.property(specArb, ({ pathShapes, componentsShape }) => {
        const original = buildSpec(pathShapes, componentsShape);
        const once = canonicalizeSpec(original);
        const twice = canonicalizeSpec(once);
        assert.deepStrictEqual(twice, once);
        assert.strictEqual(stringifySpec(twice), stringifySpec(once));
      }),
      { numRuns: 60 }
    );
  });
});

// ---------------------------------------------------------------------------
// Non-target order preserved
// ---------------------------------------------------------------------------

describe('canonicalizeSpec: preserves non-target ordering', () => {
  it('keeps a path item method order exactly as declared (post, get, delete)', () => {
    const doc = {
      paths: {
        '/widgets': {
          post: { summary: 'create' },
          get: { summary: 'list' },
          delete: { summary: 'remove' },
        },
      },
    };
    const result = canonicalizeSpec(doc) as { paths: { '/widgets': Record<string, unknown> } };
    assert.deepStrictEqual(Object.keys(result.paths['/widgets']), ['post', 'get', 'delete']);
  });

  it('keeps a schema property insertion order exactly as declared', () => {
    const doc = {
      components: {
        schemas: {
          Widget: { zeta: { type: 'string' }, alpha: { type: 'string' }, mid: { type: 'string' } },
        },
      },
    };
    const result = canonicalizeSpec(doc) as {
      components: { schemas: { Widget: Record<string, unknown> } };
    };
    assert.deepStrictEqual(Object.keys(result.components.schemas.Widget), ['zeta', 'alpha', 'mid']);
  });

  it('keeps a parameters array element order exactly as declared', () => {
    const params = [{ name: 'z' }, { name: 'a' }, { name: 'm' }];
    const doc = {
      paths: {
        '/widgets': {
          get: { parameters: params },
        },
      },
    };
    const result = canonicalizeSpec(doc) as {
      paths: { '/widgets': { get: { parameters: Array<{ name: string }> } } };
    };
    assert.deepStrictEqual(
      result.paths['/widgets'].get.parameters.map((p) => p.name),
      ['z', 'a', 'm']
    );
  });

  it('keeps servers array and info field order exactly as declared', () => {
    const doc = {
      info: { version: '1.0.0', title: 'Z-Spec' },
      servers: [{ url: 'https://b.deere.com' }, { url: 'https://a.deere.com' }],
    };
    const result = canonicalizeSpec(doc) as {
      info: Record<string, unknown>;
      servers: Array<{ url: string }>;
    };
    assert.deepStrictEqual(Object.keys(result.info), ['version', 'title']);
    assert.deepStrictEqual(
      result.servers.map((s) => s.url),
      ['https://b.deere.com', 'https://a.deere.com']
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown (non-OpenAPI) component categories: the sorter has no whitelist
// ---------------------------------------------------------------------------

describe('canonicalizeSpec: tolerates unknown component categories', () => {
  it('sorts an x- extension category and its members like any standard category', () => {
    const doc = {
      components: {
        schemas: { B: {}, A: {} },
        'x-futureCategory': { Zeta: { type: 'object' }, Alpha: { type: 'object' } },
      },
    };
    const result = canonicalizeSpec(doc) as {
      components: Record<string, Record<string, unknown>>;
    };
    // Category names sort, so the unknown x- category lands after schemas...
    assert.deepStrictEqual(Object.keys(result.components), ['schemas', 'x-futureCategory']);
    // ...and its members are sorted too, with no special-casing of known names.
    assert.deepStrictEqual(Object.keys(result.components['x-futureCategory']), ['Alpha', 'Zeta']);
    assert.deepStrictEqual(Object.keys(result.components.schemas), ['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// Missing / absent / malformed sections
// ---------------------------------------------------------------------------

describe('canonicalizeSpec: tolerates missing, absent, or malformed sections', () => {
  it('a doc without components is returned unchanged (paths still canonicalized)', () => {
    const doc = { openapi: '3.0.0', paths: { '/b': {}, '/a': {} } };
    const result = canonicalizeSpec(doc) as { paths: Record<string, unknown> };
    assert.deepStrictEqual(Object.keys(result.paths), ['/a', '/b']);
    assert.ok(!('components' in (result as object)));
  });

  it('a doc without paths is returned unchanged (components still canonicalized)', () => {
    const doc = { openapi: '3.0.0', components: { schemas: { B: {}, A: {} } } };
    const result = canonicalizeSpec(doc) as { components: { schemas: Record<string, unknown> } };
    assert.deepStrictEqual(Object.keys(result.components.schemas), ['A', 'B']);
    assert.ok(!('paths' in (result as object)));
  });

  it('scalar junk in the paths slot is tolerated and returned as-is, without throwing', () => {
    assert.doesNotThrow(() => canonicalizeSpec({ paths: 'not-a-map' }));
    const result = canonicalizeSpec({ paths: 'not-a-map' }) as { paths: unknown };
    assert.strictEqual(result.paths, 'not-a-map');
  });

  it('scalar junk in the components slot is tolerated and returned as-is, without throwing', () => {
    assert.doesNotThrow(() => canonicalizeSpec({ components: 42 }));
    const result = canonicalizeSpec({ components: 42 }) as { components: unknown };
    assert.strictEqual(result.components, 42);
  });

  it('null paths/components are tolerated and returned as-is', () => {
    const result = canonicalizeSpec({ paths: null, components: null }) as {
      paths: unknown;
      components: unknown;
    };
    assert.strictEqual(result.paths, null);
    assert.strictEqual(result.components, null);
  });

  // Beyond the paths/components slots: canonicalizeSpec's own signature takes
  // `unknown`, so a caller could hand it a non-object doc entirely. It should
  // not throw; it should hand the value straight back.
  it('a non-object document is returned unchanged without throwing', () => {
    assert.strictEqual(canonicalizeSpec('not-a-doc'), 'not-a-doc');
    assert.strictEqual(canonicalizeSpec(null), null);
    assert.strictEqual(canonicalizeSpec(undefined), undefined);
    assert.strictEqual(canonicalizeSpec(42), 42);
  });
});

// ---------------------------------------------------------------------------
// Input not mutated
// ---------------------------------------------------------------------------

describe('canonicalizeSpec: does not mutate its input', () => {
  it('the original document keeps its paths/components key order after canonicalize', () => {
    const doc = {
      paths: { '/z': {}, '/a': {}, '/m': {} },
      components: {
        schemas: { Z: {}, A: {} },
        parameters: { B: {}, A: {} },
      },
    };
    const originalPathKeys = Object.keys(doc.paths);
    const originalComponentKeys = Object.keys(doc.components);
    const originalSchemaKeys = Object.keys(doc.components.schemas);
    const originalParameterKeys = Object.keys(doc.components.parameters);

    const result = canonicalizeSpec(doc);

    // The original is untouched...
    assert.deepStrictEqual(Object.keys(doc.paths), originalPathKeys);
    assert.deepStrictEqual(Object.keys(doc.components), originalComponentKeys);
    assert.deepStrictEqual(Object.keys(doc.components.schemas), originalSchemaKeys);
    assert.deepStrictEqual(Object.keys(doc.components.parameters), originalParameterKeys);
    // ...while the result actually is canonicalized (so this test would catch
    // a no-op implementation that "preserves" input by never touching it).
    const canonical = result as {
      paths: Record<string, unknown>;
      components: Record<string, unknown>;
    };
    assert.deepStrictEqual(Object.keys(canonical.paths), ['/a', '/m', '/z']);
    assert.deepStrictEqual(Object.keys(canonical.components), ['parameters', 'schemas']);
  });
});

// ---------------------------------------------------------------------------
// Anchor suppression
// ---------------------------------------------------------------------------

describe('stringifySpec: alias/anchor suppression', () => {
  it('a shared object reference in two schema slots is fully duplicated, never anchored/aliased', () => {
    const shared = { type: 'object', properties: { name: { type: 'string' } } };
    const doc = {
      components: {
        schemas: {
          A: shared,
          B: shared,
        },
      },
    };
    // Round-trips through canonicalizeSpec first, matching how task 8 will
    // actually call this (canonicalize then stringify), so this also proves
    // canonicalizeSpec's "shared by reference" contract survives into output.
    const out = stringifySpec(canonicalizeSpec(doc));

    assert.ok(!out.includes('&'), `expected no YAML anchor, got:\n${out}`);
    assert.ok(!out.includes('*'), `expected no YAML alias, got:\n${out}`);
    // Both slots carry the full content rather than one being a bare alias.
    const nameOccurrences = out.match(/name:/g) ?? [];
    assert.strictEqual(nameOccurrences.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Options fidelity
// ---------------------------------------------------------------------------

describe('stringifySpec: emission options fidelity', () => {
  it('quotes plain strings with double quotes and never line-wraps a long value', () => {
    const longDescription =
      'This description is intentionally long enough that the default eighty column fold width would wrap it onto a second line if lineWidth were not disabled for this stringifier.';
    const doc = {
      components: {
        schemas: {
          Widget: { type: 'object', description: longDescription },
        },
      },
    };

    const out = stringifySpec(doc);

    // defaultStringType: QUOTE_DOUBLE -> plain string scalars render quoted.
    assert.ok(out.includes('type: "object"'), out);
    // lineWidth: 0 -> no folding; the whole description stays one physical line.
    assert.ok(out.includes(`description: "${longDescription}"`), out);
    // defaultKeyType: PLAIN -> ordinary keys stay unquoted.
    assert.ok(out.includes('Widget:'), out);
    assert.ok(!out.includes('"Widget"'), out);
  });

  it('ends with exactly the trailing newline yaml.stringify itself produces', () => {
    const out = stringifySpec({ a: 1 });
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.endsWith('\n\n'));
  });
});
