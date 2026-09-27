/**
 * Tests for scripts/lib/contract-continuity.ts.
 *
 * The module is the identity guard fetch-specs runs on a merged document just
 * before it would overwrite specs/raw/<name>.yaml: it counts how many of the
 * committed contract's operation identities the slug still serves. It replaced
 * an apiId equality guard that Deere's api_id could not support (neither
 * unique per API nor stable over time).
 *
 * Inline objects only, matching the validation half of
 * tests/spec-registry.test.ts. No filesystem, no network, no fixtures.
 *
 * Counting and deciding are separate exports of the module and are tested as
 * such: assessContractContinuity returns plain counts with no verdict attached,
 * and isDiscontinuous turns those counts into the block decision. fetch-specs
 * owns neither; its job is I/O and reporting.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  assessContractContinuity,
  type ContractContinuity,
  isDiscontinuous,
} from '../scripts/lib/contract-continuity.js';

/** Minimal document shell: the module reads nothing but `paths`. */
function doc(paths: Record<string, unknown>): Record<string, unknown> {
  return { openapi: '3.0.0', info: { title: 'test', version: '1' }, paths };
}

/** Operation bodies are never inspected; only the method keys are. */
const OP = { responses: { '200': { description: 'ok' } } };

/** Shapes a truncated or hand-mangled committed file can actually take. */
const MALFORMED: unknown[] = [
  null,
  42,
  'openapi: 3.0.0',
  ['/fields'],
  {},
  { paths: 'not a mapping' },
  { paths: { '/fields': 42 } },
];

describe('contract continuity', () => {
  it('reports full survival for identical documents', () => {
    const d = doc({ '/fields': { get: OP, post: OP }, '/fields/{fieldId}': { get: OP } });
    assert.deepStrictEqual(assessContractContinuity(d, d), {
      committedCount: 3,
      survivingCount: 3,
      missing: [],
    });
  });

  // Identity is opKey, which collapses every {param} to {_}, so an upstream
  // rename of a path variable is absorbed. This is the property that keeps a
  // routine Deere param rename from reading as a slug repointed at another API.
  it('absorbs a path-param rename as a surviving operation', () => {
    assert.deepStrictEqual(
      assessContractContinuity(
        doc({ '/organizations/{orgId}/fields': { get: OP } }),
        doc({ '/organizations/{organizationId}/fields': { get: OP } })
      ),
      { committedCount: 1, survivingCount: 1, missing: [] }
    );
  });

  it('reports every committed operation missing when the contracts are disjoint', () => {
    const result = assessContractContinuity(
      doc({ '/foo/{fooId}': { get: OP, delete: OP }, '/bar': { post: OP } }),
      doc({ '/unrelated': { get: OP } })
    );
    assert.strictEqual(result.committedCount, 3);
    assert.strictEqual(result.survivingCount, 0);
    // Display format, sorted: method uppercased, path as the committed
    // document writes it. Identity, not display, is what drove the counts
    // above; the param-rename test pins that.
    assert.deepStrictEqual(result.missing, [
      'DELETE /foo/{fooId}',
      'GET /foo/{fooId}',
      'POST /bar',
    ]);
  });

  it('counts a partial overlap exactly', () => {
    const result = assessContractContinuity(
      doc({ '/a': { get: OP, post: OP }, '/b': { get: OP } }),
      doc({ '/a': { get: OP }, '/c': { get: OP } })
    );
    assert.deepStrictEqual(result, {
      committedCount: 3,
      survivingCount: 1,
      missing: ['GET /b', 'POST /a'],
    });
  });

  // `parameters` above all: a shared path-level parameter list counted as an
  // operation would inflate committedCount and dilute the survival ratio.
  it('does not count non-operation keys under a path item', () => {
    const result = assessContractContinuity(
      doc({
        '/fields': {
          parameters: [{ name: 'x-deere-signature', in: 'header' }],
          summary: 'Fields',
          description: 'Sibling keys of the methods, none of them operations',
          servers: [{ url: 'https://api.deere.com/platform' }],
          'x-deere-internal': { owner: 'someone' },
          get: OP,
        },
      }),
      doc({ '/fields': { get: OP } })
    );
    assert.deepStrictEqual(result, { committedCount: 1, survivingCount: 1, missing: [] });
  });

  it('treats method case as insignificant in either document', () => {
    assert.deepStrictEqual(
      assessContractContinuity(doc({ '/a': { GET: OP } }), doc({ '/a': { get: OP } })),
      { committedCount: 1, survivingCount: 1, missing: [] }
    );
    assert.deepStrictEqual(
      assessContractContinuity(doc({ '/a': { get: OP } }), doc({ '/a': { GET: OP } })),
      { committedCount: 1, survivingCount: 1, missing: [] }
    );
  });

  // generate-sdk emits nothing for head, options, or trace, so counting them
  // would measure continuity of surface the SDK does not have.
  it('counts only the five methods the pipeline generates from', () => {
    const result = assessContractContinuity(
      doc({
        '/a': {
          get: OP,
          post: OP,
          put: OP,
          patch: OP,
          delete: OP,
          head: OP,
          options: OP,
          trace: OP,
        },
      }),
      doc({ '/a': { get: OP, post: OP, put: OP, patch: OP, delete: OP } })
    );
    assert.deepStrictEqual(result, { committedCount: 5, survivingCount: 5, missing: [] });
  });

  // A malformed baseline must degrade to "no baseline", never to a crashed
  // sync: the committed file is one a human may have truncated by hand, and
  // parseability is what downstream stages validate, not this one.
  it('treats a malformed committed document as no baseline rather than throwing', () => {
    for (const bad of MALFORMED) {
      assert.deepStrictEqual(
        assessContractContinuity(bad, doc({ '/a': { get: OP } })),
        { committedCount: 0, survivingCount: 0, missing: [] },
        `committed ${JSON.stringify(bad)}`
      );
    }
  });

  it('treats a malformed fetched document as serving nothing rather than throwing', () => {
    for (const bad of MALFORMED) {
      assert.deepStrictEqual(
        assessContractContinuity(doc({ '/a': { get: OP } }), bad),
        { committedCount: 1, survivingCount: 0, missing: ['GET /a'] },
        `fetched ${JSON.stringify(bad)}`
      );
    }
  });

  // opKey normalizes {name} and {id} to the same {_}, so crop-types' two
  // sibling GETs are a single identity here. That is deliberate reuse of the
  // manifest's identity: a survival ratio only needs distinct identities, and
  // the manifest, which does disambiguate siblings by exact raw path, is what
  // surfaces a rename inside such a set as breaking.
  it('collapses sibling operations that differ only by param name into one identity', () => {
    const siblings = doc({ '/cropTypes/{name}': { get: OP }, '/cropTypes/{id}': { get: OP } });
    assert.deepStrictEqual(
      assessContractContinuity(siblings, doc({ '/cropTypes/{name}': { get: OP } })),
      { committedCount: 1, survivingCount: 1, missing: [] }
    );
    // Losing the identity reports one representative, the first in document
    // order, not one entry per collapsed sibling.
    assert.deepStrictEqual(assessContractContinuity(siblings, doc({ '/unrelated': { get: OP } })), {
      committedCount: 1,
      survivingCount: 0,
      missing: ['GET /cropTypes/{name}'],
    });
  });

  it('does not let operations only the fetched document has inflate the counts', () => {
    const result = assessContractContinuity(
      doc({ '/a': { get: OP } }),
      doc({ '/a': { get: OP }, '/b': { get: OP }, '/c': { post: OP } })
    );
    assert.deepStrictEqual(result, { committedCount: 1, survivingCount: 1, missing: [] });
  });

  // A 1-of-2 survival sits exactly on isDiscontinuous's boundary and still
  // reports here as plain counts, with no verdict attached.
  it('attaches no verdict to the counts it returns', () => {
    const result = assessContractContinuity(
      doc({ '/a': { get: OP }, '/b': { get: OP } }),
      doc({ '/a': { get: OP } })
    );
    assert.deepStrictEqual(result, {
      committedCount: 2,
      survivingCount: 1,
      missing: ['GET /b'],
    });
  });
});

describe('contract continuity block decision', () => {
  /** isDiscontinuous reads only the counts; `missing` is display detail. */
  function counts(committedCount: number, survivingCount: number): ContractContinuity {
    return { committedCount, survivingCount, missing: [] };
  }

  // No baseline is not a discontinuity, and 0/0 is NaN, which must never reach
  // the ratio.
  it('never blocks on an empty baseline', () => {
    assert.strictEqual(isDiscontinuous(counts(0, 0)), false);
  });

  // A single-identity baseline cannot distinguish same-API evolution from a
  // repointed slug: either way the ratio is 0. 7 of the 27 active specs carry
  // exactly one identity, so blocking here would turn the sync red on any one
  // legitimate upstream path edit.
  it('never blocks a one-operation spec, even when that operation is gone', () => {
    const result = assessContractContinuity(
      doc({ '/isg/machines': { get: OP } }),
      doc({ '/isg/fleet': { get: OP } })
    );
    assert.deepStrictEqual(result, {
      committedCount: 1,
      survivingCount: 0,
      missing: ['GET /isg/machines'],
    });
    assert.strictEqual(isDiscontinuous(result), false);
  });

  it('blocks a two-operation spec that lost both', () => {
    const result = assessContractContinuity(
      doc({ '/a': { get: OP }, '/b': { get: OP } }),
      doc({ '/unrelated': { get: OP } })
    );
    assert.strictEqual(result.survivingCount, 0);
    assert.strictEqual(isDiscontinuous(result), true);
  });

  // MIN_SURVIVAL is a floor to stay at or above, not to exceed.
  it('blocks strictly below MIN_SURVIVAL and not at it', () => {
    assert.strictEqual(isDiscontinuous(counts(2, 1)), false);
    assert.strictEqual(isDiscontinuous(counts(4, 2)), false);
    assert.strictEqual(isDiscontinuous(counts(101, 50)), true);
  });

  // The shape the guard exists for: products-sized contract, one operation
  // left, which is what a repointed slug looks like.
  it('blocks a survival well under the threshold', () => {
    assert.strictEqual(isDiscontinuous(counts(38, 1)), true);
  });
});
