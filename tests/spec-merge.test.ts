/**
 * Unit tests for scripts/lib/spec-merge.ts.
 *
 * mergeSpecDocs structurally merges the multiple OpenAPI documents the John
 * Deere portal returns for one slug into a single spec object. The primary
 * document (chosen by a repo-owned table, never portal array order) owns
 * `info`, wins every deep-equal dedupe, and never has its components renamed,
 * which protects the committed public type surface. Conflicting non-primary
 * components are renamed with a `$ref` rewrite across that document's whole
 * subtree, re-run to a fixpoint. Output is invariant under the input array
 * order (the positional-coupling class this branch eliminates).
 *
 * Style follows tests/spec-canonicalize.ts and tests/api-surface.test.ts
 * (node:test + node:assert, no `any`, byte-comparison via stringifySpec).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { stringifySpec } from '../scripts/lib/spec-canonicalize.js';
import { mergeSpecDocs } from '../scripts/lib/spec-merge.js';

// ---------------------------------------------------------------------------
// Helpers (no `any`: navigate results with typed accessors)
// ---------------------------------------------------------------------------

interface MergedSpec {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown>; [category: string]: unknown };
  servers?: unknown[];
  tags?: Array<{ name?: string; [key: string]: unknown }>;
  'x-source-documents'?: Array<{ endPointName: string; id: number }>;
  [key: string]: unknown;
}

/** Walk a plain object/array tree by string keys (numeric keys index arrays). */
function deepGet(root: unknown, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (Array.isArray(cur)) {
      cur = cur[Number(key)];
    } else if (cur !== null && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function schemaNames(merged: MergedSpec): string[] {
  return Object.keys(merged.components?.schemas ?? {}).sort();
}

function pathNames(merged: MergedSpec): string[] {
  return Object.keys(merged.paths ?? {}).sort();
}

/** All permutations of a small array (used for the order-independence law). */
function permutations<T>(arr: readonly T[]): T[][] {
  if (arr.length <= 1) return [[...arr]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 1) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single-doc passthrough and empty input
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: degenerate inputs', () => {
  it('returns the single document unchanged and unstamped', () => {
    const doc = {
      openapi: '3.0.0',
      info: { title: 'Fields' },
      paths: { '/fields': { get: { operationId: 'listFields' } } },
    };
    const result = mergeSpecDocs('fields', [{ endPointName: 'fields', id: 7, doc }]);
    assert.strictEqual(result, doc, 'single-doc merge must return the same reference');
    assert.ok(!('x-source-documents' in (result as object)), 'single doc must not be stamped');
  });

  it('throws when given zero documents', () => {
    assert.throws(() => mergeSpecDocs('products', []), /no documents/i);
  });
});

// ---------------------------------------------------------------------------
// Paths union and method-level merge
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: paths', () => {
  it('unions disjoint literal paths across two documents', () => {
    const varieties = {
      info: { title: 'Varieties' },
      paths: { '/varieties': { get: { operationId: 'listVarieties' } } },
    };
    const chemicals = {
      info: { title: 'Chemicals' },
      paths: { '/chemicals': { get: { operationId: 'listChemicals' } } },
    };
    // Deliberately place the secondary first to prove array order is ignored.
    const merged = mergeSpecDocs('products', [
      { endPointName: 'chemicals', id: 2, doc: chemicals },
      { endPointName: 'varieties', id: 1, doc: varieties },
    ]) as MergedSpec;

    assert.deepStrictEqual(pathNames(merged), ['/chemicals', '/varieties']);
    assert.deepStrictEqual(merged.info, { title: 'Varieties' }, 'primary info wins');
  });

  it('merges the same literal path method-by-method (GET primary + POST secondary)', () => {
    const primary = {
      info: { title: 'P' },
      paths: { '/x': { get: { operationId: 'getX' } } },
    };
    const secondary = {
      info: { title: 'S' },
      paths: { '/x': { post: { operationId: 'postX' } } },
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(Object.keys(merged.paths?.['/x'] ?? {}).sort(), ['get', 'post']);
  });

  it('dedupes an identical path+method declared in both docs (key order insensitive)', () => {
    const primary = {
      info: {},
      paths: { '/x': { get: { operationId: 'getX', summary: 'S', tags: ['a'] } } },
    };
    const secondary = {
      info: {},
      // Same GET, keys in a different order: must dedupe to the primary copy.
      paths: { '/x': { get: { tags: ['a'], summary: 'S', operationId: 'getX' } } },
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(Object.keys(merged.paths?.['/x'] ?? {}), ['get']);
    assert.strictEqual(deepGet(merged, ['paths', '/x', 'get', 'operationId']), 'getX');
  });

  it('throws on the same path+method defined differently, naming both endpoints', () => {
    const primary = {
      info: {},
      paths: { '/x': { get: { operationId: 'getX', summary: 'one' } } },
    };
    const secondary = {
      info: {},
      paths: { '/x': { get: { operationId: 'getX', summary: 'two' } } },
    };
    assert.throws(
      () =>
        mergeSpecDocs('products', [
          { endPointName: 'varieties', id: 1, doc: primary },
          { endPointName: 'chemicals', id: 2, doc: secondary },
        ]),
      (error: unknown) =>
        error instanceof Error &&
        /varieties/.test(error.message) &&
        /chemicals/.test(error.message) &&
        /\/x/.test(error.message)
    );
  });

  it('reports a differing non-method path-item member as a member, not a "method"', () => {
    // A path item can carry non-method members (description, parameters, ...).
    // When one differs across docs the conflict must name it as a "path item
    // member", not mislabel it a method with an uppercased key.
    const primary = {
      info: {},
      paths: { '/x': { get: { operationId: 'getX' }, description: 'one' } },
    };
    const secondary = {
      info: {},
      paths: { '/x': { description: 'two' } },
    };
    assert.throws(
      () =>
        mergeSpecDocs('products', [
          { endPointName: 'varieties', id: 1, doc: primary },
          { endPointName: 'chemicals', id: 2, doc: secondary },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /path item member/);
        assert.match(error.message, /"description"/);
        // Guard against regressing to the old wording, which uppercased the key
        // and called every conflicting member a "method".
        assert.doesNotMatch(error.message, /DESCRIPTION/);
        assert.doesNotMatch(error.message, /path and method/);
        return true;
      }
    );
  });

  it('keeps normalized-pattern siblings as two distinct paths without error', () => {
    // /x/{name} and /x/{id} share a normalized pattern but are different literal
    // paths; the manifest's ambiguous-group matching resolves them downstream.
    const primary = { info: {}, paths: { '/x/{name}': { get: { operationId: 'getByName' } } } };
    const secondary = { info: {}, paths: { '/x/{id}': { get: { operationId: 'getById' } } } };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(pathNames(merged), ['/x/{id}', '/x/{name}']);
  });
});

// ---------------------------------------------------------------------------
// Components: dedupe, conflict rename + $ref rewrite, fixpoint cascade
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: components', () => {
  it('dedupes a deep-equal component (modulo key order), keeping the primary copy', () => {
    const primary = {
      info: {},
      paths: {},
      components: {
        schemas: {
          Money: {
            type: 'object',
            properties: { amount: { type: 'number' }, ccy: { type: 'string' } },
          },
        },
      },
    };
    const secondary = {
      info: {},
      paths: {},
      components: {
        schemas: {
          Money: {
            properties: { ccy: { type: 'string' }, amount: { type: 'number' } },
            type: 'object',
          },
        },
      },
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(schemaNames(merged), ['Money']);
  });

  it('renames a conflicting component and rewrites $ref in paths AND nested schemas', () => {
    const primary = {
      info: { title: 'Field Ops' },
      paths: {},
      components: {
        schemas: { Error: { type: 'object', properties: { code: { type: 'integer' } } } },
      },
    };
    const secondary = {
      info: {},
      paths: {
        '/measurementTypes': {
          get: {
            responses: {
              '400': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          // Differs from the primary Error, so it must be renamed.
          Error: { type: 'object', properties: { message: { type: 'string' } } },
          // A nested $ref to Error, reachable only by the doc-wide subtree walk.
          Wrapper: { type: 'object', properties: { err: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    const merged = mergeSpecDocs('field-operations-api', [
      { endPointName: 'field-operation', id: 1, doc: primary },
      { endPointName: 'measurement-type', id: 2, doc: secondary },
    ]) as MergedSpec;

    // Primary Error kept untouched; secondary Error renamed with its suffix.
    assert.deepStrictEqual(deepGet(merged, ['components', 'schemas', 'Error', 'properties']), {
      code: { type: 'integer' },
    });
    assert.deepStrictEqual(
      deepGet(merged, ['components', 'schemas', 'Error_MeasurementType', 'properties']),
      { message: { type: 'string' } }
    );
    // The path's $ref was rewritten.
    assert.strictEqual(
      deepGet(merged, [
        'paths',
        '/measurementTypes',
        'get',
        'responses',
        '400',
        'content',
        'application/json',
        'schema',
        '$ref',
      ]),
      '#/components/schemas/Error_MeasurementType'
    );
    // The nested schema $ref was rewritten.
    assert.strictEqual(
      deepGet(merged, ['components', 'schemas', 'Wrapper', 'properties', 'err', '$ref']),
      '#/components/schemas/Error_MeasurementType'
    );
  });

  it('runs the rename to a fixpoint (a dependent that was byte-equal is renamed too)', () => {
    // Primary: S and X (X refs S). Secondary: S' (differs) and X' (byte-equal to
    // primary X). Renaming S -> S_Suffix rewrites X''s ref, so X' now differs
    // from primary X and must itself be renamed.
    const primary = {
      info: {},
      paths: {},
      components: {
        schemas: {
          S: { type: 'object', properties: { a: { type: 'string' } } },
          X: { type: 'object', properties: { s: { $ref: '#/components/schemas/S' } } },
        },
      },
    };
    const secondary = {
      info: {},
      paths: {},
      components: {
        schemas: {
          S: { type: 'object', properties: { a: { type: 'number' } } },
          X: { type: 'object', properties: { s: { $ref: '#/components/schemas/S' } } },
        },
      },
    };
    const merged = mergeSpecDocs('field-operations-api', [
      { endPointName: 'field-operation', id: 1, doc: primary },
      { endPointName: 'measurement-type', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(schemaNames(merged), [
      'S',
      'S_MeasurementType',
      'X',
      'X_MeasurementType',
    ]);
    // Primary copies are intact and still reference the original S.
    assert.deepStrictEqual(deepGet(merged, ['components', 'schemas', 'S', 'properties', 'a']), {
      type: 'string',
    });
    assert.strictEqual(
      deepGet(merged, ['components', 'schemas', 'X', 'properties', 's', '$ref']),
      '#/components/schemas/S'
    );
    // Renamed secondary S and the cascaded X pointing at it.
    assert.deepStrictEqual(
      deepGet(merged, ['components', 'schemas', 'S_MeasurementType', 'properties', 'a']),
      { type: 'number' }
    );
    assert.strictEqual(
      deepGet(merged, ['components', 'schemas', 'X_MeasurementType', 'properties', 's', '$ref']),
      '#/components/schemas/S_MeasurementType'
    );
  });

  it('throws when the rename target name is already taken by a non-equal component', () => {
    const primary = {
      info: {},
      paths: {},
      components: {
        schemas: {
          Error: { type: 'object', properties: { code: { type: 'integer' } } },
          // The name the secondary rename would target, already present and different.
          Error_MeasurementType: { type: 'object', properties: { taken: { type: 'boolean' } } },
        },
      },
    };
    const secondary = {
      info: {},
      paths: {},
      components: {
        schemas: { Error: { type: 'object', properties: { message: { type: 'string' } } } },
      },
    };
    assert.throws(
      () =>
        mergeSpecDocs('field-operations-api', [
          { endPointName: 'field-operation', id: 1, doc: primary },
          { endPointName: 'measurement-type', id: 2, doc: secondary },
        ]),
      /collides|taken|resolve/i
    );
  });

  it('throws when the rename fixpoint exceeds its iteration cap', () => {
    // A conflict that needs one rename, run with the cap forced to zero.
    const primary = {
      info: {},
      paths: {},
      components: {
        schemas: { Error: { type: 'object', properties: { code: { type: 'integer' } } } },
      },
    };
    const secondary = {
      info: {},
      paths: {},
      components: {
        schemas: { Error: { type: 'object', properties: { message: { type: 'string' } } } },
      },
    };
    assert.throws(
      () =>
        mergeSpecDocs(
          'field-operations-api',
          [
            { endPointName: 'field-operation', id: 1, doc: primary },
            { endPointName: 'measurement-type', id: 2, doc: secondary },
          ],
          { maxRenameIterations: 0 }
        ),
      /cap|fixpoint|exceed/i
    );
  });
});

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: servers', () => {
  it('keeps a servers block declared identically by both docs', () => {
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
  });

  it('inherits the declared servers block when a secondary omits servers', () => {
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = { info: {}, paths: {} };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
  });

  it('resolves platform-family host variants (api vs partnerapi) to the primary block', () => {
    // The machine-locations case: location-history declares api.deere.com,
    // breadcrumbs declares partnerapi.deere.com. Both are environment instances
    // of the one platform family, so the primary (api) wins with no throw;
    // fix-specs later normalizes the single static block to the templated form.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://partnerapi.deere.com/platform' }],
    };
    const merged = mergeSpecDocs('machine-locations', [
      { endPointName: 'location-history', id: 1, doc: primary },
      { endPointName: 'breadcrumbs', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
  });

  it('treats a bare deere.com host (no /platform path) as platform-family', () => {
    // active-ingredients ships a defect: a deere.com host with no /platform
    // path. It must count as platform-family (not a different family), so
    // pairing it with a platform block does not throw and the primary wins.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://sandboxapi.deere.com' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://sandboxapi.deere.com' }]);
  });

  it('treats an apex deere.com host (no subdomain) as platform-family', () => {
    // A server url whose host is exactly deere.com (no subdomain label) must
    // count as platform-family via the label-boundary check, so pairing it with
    // a platform block does not throw, the primary (apex) wins, and nothing is
    // rejected as junk.
    const primary = { info: {}, paths: {}, servers: [{ url: 'https://deere.com/platform' }] };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const warnings: string[] = [];
    const merged = mergeSpecDocs(
      'products',
      [
        { endPointName: 'varieties', id: 1, doc: primary },
        { endPointName: 'chemicals', id: 2, doc: secondary },
      ],
      { onWarning: (message: string) => warnings.push(message) }
    ) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://deere.com/platform' }]);
    assert.deepStrictEqual(warnings, [], 'an apex deere host is not rejected, so no warning');
  });

  it('resolves a templated + static platform mix to the primary block', () => {
    const primary = {
      info: {},
      paths: {},
      servers: [
        {
          url: 'https://{environment}.deere.com/platform',
          variables: { environment: { default: 'api', enum: ['api', 'sandboxapi'] } },
        },
      ],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [
      {
        url: 'https://{environment}.deere.com/platform',
        variables: { environment: { default: 'api', enum: ['api', 'sandboxapi'] } },
      },
    ]);
  });

  it('drops a placeholder-only servers block to non-declaring and warns', () => {
    // The products `documents` case: a bare `https://server.com` editor default.
    // It resolves to no deere.com host, so it is treated as non-declaring (it
    // inherits the merged block) and surfaces a warning naming the slug and doc.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://server.com', description: 'New server' }],
    };
    const warnings: string[] = [];
    const merged = mergeSpecDocs(
      'products',
      [
        { endPointName: 'varieties', id: 1, doc: primary },
        { endPointName: 'documents', id: 2, doc: secondary },
      ],
      { onWarning: (message: string) => warnings.push(message) }
    ) as MergedSpec;

    // The placeholder block is ignored; the primary's block is the merged servers.
    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
    // Exactly one warning, naming the slug, the offending doc, and the junk url.
    assert.strictEqual(warnings.length, 1);
    assert.ok(/products/.test(warnings[0]), 'warning names the slug');
    assert.ok(/documents/.test(warnings[0]), 'warning names the endPointName');
    assert.ok(/server\.com/.test(warnings[0]), 'warning names the placeholder url');
  });

  it('warns when a doc declares only url-less/malformed server entries', () => {
    // A servers block whose entries carry no usable url string declares nothing,
    // exactly like a placeholder-only block, so it must warn rather than be
    // dropped to non-declaring silently.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ description: 'no url here' }, {}],
    };
    const warnings: string[] = [];
    const merged = mergeSpecDocs(
      'products',
      [
        { endPointName: 'varieties', id: 1, doc: primary },
        { endPointName: 'documents', id: 2, doc: secondary },
      ],
      { onWarning: (message: string) => warnings.push(message) }
    ) as MergedSpec;

    // The url-less block is non-declaring; the primary block wins.
    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
    // But it is surfaced, naming the slug and the offending document.
    assert.strictEqual(warnings.length, 1);
    assert.ok(/products/.test(warnings[0]), 'warning names the slug');
    assert.ok(/documents/.test(warnings[0]), 'warning names the endPointName');
  });

  it('labels an http:// deere host as non-https, not "no deere.com host"', () => {
    // An http (non-https) deere host is rejected for its scheme, not its host.
    // The warning must name the offending url with the real reason and must not
    // misstate that there is no deere.com host.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'http://sandboxapi.deere.com/platform' }],
    };
    const warnings: string[] = [];
    mergeSpecDocs(
      'products',
      [
        { endPointName: 'varieties', id: 1, doc: primary },
        { endPointName: 'documents', id: 2, doc: secondary },
      ],
      { onWarning: (message: string) => warnings.push(message) }
    );

    assert.strictEqual(warnings.length, 1);
    assert.ok(/sandboxapi\.deere\.com/.test(warnings[0]), 'names the offending url');
    assert.ok(/non-https/.test(warnings[0]), 'states the real reason');
    assert.ok(!/no deere\.com host/.test(warnings[0]), 'does not misstate the reason');
  });

  it('warns once for a mixed block that pairs a good platform url with a url-less entry', () => {
    // A block with both a usable platform-family url and a url-less entry must
    // still classify platform (the good url decides the family, so the trust
    // decision is unaffected), but the url-less entry must not be silently
    // dropped: it is a genuine spec defect distinct from the all-bad blocks the
    // other warning tests above cover, which collapse to junk classification.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }, { description: 'broken' }],
    };
    const warnings: string[] = [];
    const merged = mergeSpecDocs(
      'products',
      [
        { endPointName: 'varieties', id: 1, doc: primary },
        { endPointName: 'documents', id: 2, doc: secondary },
      ],
      { onWarning: (message: string) => warnings.push(message) }
    ) as MergedSpec;

    // Still platform-family, so the merge succeeds with the primary's block.
    assert.deepStrictEqual(merged.servers, [{ url: 'https://api.deere.com/platform' }]);
    // The url-less entry is still surfaced, naming the slug, the offending
    // document, and the rejected entry.
    assert.strictEqual(warnings.length, 1);
    assert.ok(/products/.test(warnings[0]), 'warning names the slug');
    assert.ok(/documents/.test(warnings[0]), 'warning names the endPointName');
    assert.ok(/an entry with no url/.test(warnings[0]), 'warning names the rejected entry');
  });

  it('keeps two identical OTHER-family blocks without throwing', () => {
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://equipmentapi.deere.com/isg' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://equipmentapi.deere.com/isg' }],
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.servers, [{ url: 'https://equipmentapi.deere.com/isg' }]);
  });

  it('throws when a declaring doc is a different server family, naming both endpoints', () => {
    // Genuine cross-family divergence still refuses to merge: routing one
    // family's endpoints through another family's host is the v1-class bug this
    // guard prevents. equipmentapi.deere.com/isg is a deere host on a
    // non-platform path, so it is OTHER, not a platform-family variant.
    const primary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://api.deere.com/platform' }],
    };
    const secondary = {
      info: {},
      paths: {},
      servers: [{ url: 'https://equipmentapi.deere.com/isg' }],
    };
    assert.throws(
      () =>
        mergeSpecDocs('products', [
          { endPointName: 'varieties', id: 1, doc: primary },
          { endPointName: 'chemicals', id: 2, doc: secondary },
        ]),
      (error: unknown) =>
        error instanceof Error && /varieties/.test(error.message) && /chemicals/.test(error.message)
    );
  });
});

// ---------------------------------------------------------------------------
// Primary selection
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: primary selection', () => {
  it('uses the PRIMARY_ENDPOINT_NAME table entry regardless of array order', () => {
    const primary = { info: { title: 'Varieties' }, paths: { '/varieties': { get: {} } } };
    const other = { info: { title: 'Chemicals' }, paths: { '/chemicals': { get: {} } } };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'chemicals', id: 2, doc: other },
      { endPointName: 'varieties', id: 1, doc: primary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.info, { title: 'Varieties' });
  });

  it('falls back to the document whose end_point_name equals the slug', () => {
    const primary = { info: { title: 'Primary' }, paths: {} };
    const other = { info: { title: 'Other' }, paths: {} };
    // "custom-slug" is not in the table, but a document carries it as endpoint.
    const merged = mergeSpecDocs('custom-slug', [
      { endPointName: 'other', id: 2, doc: other },
      { endPointName: 'custom-slug', id: 1, doc: primary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.info, { title: 'Primary' });
  });

  it('throws listing the slug and all endpoint names when no primary can be chosen', () => {
    const a = { info: {}, paths: {} };
    const b = { info: {}, paths: {} };
    assert.throws(
      () =>
        mergeSpecDocs('unknown-slug', [
          { endPointName: 'alpha', id: 1, doc: a },
          { endPointName: 'beta', id: 2, doc: b },
        ]),
      (error: unknown) =>
        error instanceof Error &&
        /unknown-slug/.test(error.message) &&
        /alpha/.test(error.message) &&
        /beta/.test(error.message)
    );
  });
});

// ---------------------------------------------------------------------------
// info / tags / extras / stamping
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: info, tags, and stamping', () => {
  it('unions tags by name (primary first), keeps primary info, and stamps sources', () => {
    const primary = {
      info: { title: 'P' },
      paths: {},
      tags: [{ name: 'a', description: 'A' }, { name: 'b' }],
    };
    const secondary = {
      info: { title: 'S' },
      paths: {},
      tags: [{ name: 'b', description: 'dup-ignored' }, { name: 'c' }],
    };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 11, doc: primary },
      { endPointName: 'chemicals', id: 22, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(
      (merged.tags ?? []).map((t) => t.name),
      ['a', 'b', 'c']
    );
    assert.deepStrictEqual(merged.tags?.[1], { name: 'b' }, 'primary tag b wins over the dup');
    assert.deepStrictEqual(merged.info, { title: 'P' });
    assert.deepStrictEqual(merged['x-source-documents'], [
      { endPointName: 'varieties', id: 11 },
      { endPointName: 'chemicals', id: 22 },
    ]);
  });

  it('adds a distinct top-level key from a secondary only if the merged doc lacks it', () => {
    const primary = { info: {}, paths: {}, security: [{ oauth: ['read'] }] };
    const secondary = { info: {}, paths: {}, security: [{ oauth: ['write'] }], 'x-extra': 42 };
    const merged = mergeSpecDocs('products', [
      { endPointName: 'varieties', id: 1, doc: primary },
      { endPointName: 'chemicals', id: 2, doc: secondary },
    ]) as MergedSpec;

    assert.deepStrictEqual(merged.security, [{ oauth: ['read'] }], 'primary security wins');
    assert.strictEqual(merged['x-extra'], 42, 'secondary-only key is added');
  });
});

// ---------------------------------------------------------------------------
// A products-shaped 3-doc fixture: dedupe + rename together
// ---------------------------------------------------------------------------

function threeDocs(): Array<{ endPointName: string; id: number; doc: Record<string, unknown> }> {
  return [
    {
      endPointName: 'varieties',
      id: 1,
      doc: {
        info: { title: 'Varieties' },
        paths: { '/varieties': { get: { operationId: 'listVarieties' } } },
        components: {
          schemas: {
            Money: { type: 'object', properties: { amount: { type: 'number' } } },
            Variety: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    },
    {
      endPointName: 'chemicals',
      id: 2,
      doc: {
        info: { title: 'Chemicals' },
        paths: { '/chemicals': { get: { operationId: 'listChemicals' } } },
        components: {
          schemas: {
            // Deep-equal to varieties Money (different key order) -> dedupes.
            Money: { properties: { amount: { type: 'number' } }, type: 'object' },
            Chemical: {
              type: 'object',
              properties: { cost: { $ref: '#/components/schemas/Money' } },
            },
          },
        },
      },
    },
    {
      endPointName: 'fertilizers',
      id: 3,
      doc: {
        info: { title: 'Fertilizers' },
        paths: { '/fertilizers': { get: { operationId: 'listFertilizers' } } },
        components: {
          schemas: {
            // Conflicts with Money (amount string vs number) -> renamed.
            Money: { type: 'object', properties: { amount: { type: 'string' } } },
            Fertilizer: {
              type: 'object',
              properties: { price: { $ref: '#/components/schemas/Money' } },
            },
          },
        },
      },
    },
  ];
}

describe('mergeSpecDocs: products-shaped 3-doc fixture', () => {
  it('dedupes the shared boilerplate and renames only the conflicting copy', () => {
    const merged = mergeSpecDocs('products', threeDocs()) as MergedSpec;

    assert.deepStrictEqual(schemaNames(merged), [
      'Chemical',
      'Fertilizer',
      'Money',
      'Money_Fertilizers',
      'Variety',
    ]);
    assert.deepStrictEqual(pathNames(merged), ['/chemicals', '/fertilizers', '/varieties']);

    // Kept primary Money; renamed fertilizers Money.
    assert.deepStrictEqual(
      deepGet(merged, ['components', 'schemas', 'Money', 'properties', 'amount']),
      {
        type: 'number',
      }
    );
    assert.deepStrictEqual(
      deepGet(merged, ['components', 'schemas', 'Money_Fertilizers', 'properties', 'amount']),
      { type: 'string' }
    );
    // Chemical deduped its Money, so its ref is untouched.
    assert.strictEqual(
      deepGet(merged, ['components', 'schemas', 'Chemical', 'properties', 'cost', '$ref']),
      '#/components/schemas/Money'
    );
    // Fertilizer's ref was rewritten to the renamed Money.
    assert.strictEqual(
      deepGet(merged, ['components', 'schemas', 'Fertilizer', 'properties', 'price', '$ref']),
      '#/components/schemas/Money_Fertilizers'
    );
  });
});

// ---------------------------------------------------------------------------
// Purity and input-order independence
// ---------------------------------------------------------------------------

describe('mergeSpecDocs: purity and order independence', () => {
  it('never mutates its input documents', () => {
    const docs = threeDocs();
    const before = JSON.stringify(docs);
    mergeSpecDocs('products', docs);
    assert.strictEqual(JSON.stringify(docs), before);
  });

  it('produces byte-identical output for every permutation of the input array', () => {
    const base = stringifySpec(mergeSpecDocs('products', threeDocs()));
    for (const order of permutations([0, 1, 2])) {
      const source = threeDocs();
      const permuted = order.map((i) => source[i]);
      assert.strictEqual(
        stringifySpec(mergeSpecDocs('products', permuted)),
        base,
        `permutation ${order.join(',')} produced a different merge`
      );
    }
  });
});
