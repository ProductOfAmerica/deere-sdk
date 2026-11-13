/**
 * Tests for src/path-pattern.ts.
 *
 * The predicate decides whether a live request gets a per-path base URL, so a
 * false positive routes an unrelated path to the wrong host. The bleed cases
 * below are the ones that matter: same segment count, different literals.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import { DeereError } from '../src/errors.js';
import {
  encodePathParam,
  matchesPathPattern,
  pathSegments,
  segmentsMatchPattern,
} from '../src/path-pattern.js';

describe('pathSegments', () => {
  it('drops empty segments from leading, trailing and doubled slashes', () => {
    assert.deepStrictEqual(pathSegments('/a/b'), ['a', 'b']);
    assert.deepStrictEqual(pathSegments('/a//b/'), ['a', 'b']);
    assert.deepStrictEqual(pathSegments('/'), []);
    assert.deepStrictEqual(pathSegments(''), []);
  });
});

describe('matchesPathPattern', () => {
  it('matches an exact literal path', () => {
    assert.ok(matchesPathPattern('/activeIngredients', '/activeIngredients'));
  });

  it('matches any value in a {param} segment', () => {
    assert.ok(matchesPathPattern('/notifications/abc', '/notifications/{sourceEvent}'));
    assert.ok(
      matchesPathPattern(
        '/notifications/b22956b7-0b43-40ea-a396-1fdc816ebb58',
        '/notifications/{sourceEvent}'
      )
    );
  });

  it('matches multiple {param} segments', () => {
    assert.ok(
      matchesPathPattern('/organizations/1/fields/2', '/organizations/{orgId}/fields/{fieldId}')
    );
  });

  it('rejects a different segment count', () => {
    assert.ok(!matchesPathPattern('/notifications', '/notifications/{sourceEvent}'));
    assert.ok(!matchesPathPattern('/notifications/a/b', '/notifications/{sourceEvent}'));
  });

  it('rejects a same-length path with a different literal head', () => {
    // The case that matters: /notificationEvents/{id} must not pick up the
    // override written for /notifications/{sourceEvent}.
    assert.ok(!matchesPathPattern('/notificationEvents/abc', '/notifications/{sourceEvent}'));
  });

  it('rejects a differing literal in a later segment', () => {
    assert.ok(!matchesPathPattern('/organizations/1/farms', '/organizations/{orgId}/fields'));
  });

  it('is case sensitive on literals', () => {
    assert.ok(!matchesPathPattern('/ActiveIngredients', '/activeIngredients'));
  });

  it('treats a leading slash as optional on both sides', () => {
    // Segments are compared, not raw strings, so a missing leading slash on
    // either side cannot cause a spurious mismatch.
    assert.ok(matchesPathPattern('notifications/abc', '/notifications/{sourceEvent}'));
  });

  it('does not match an empty path against a non-empty pattern', () => {
    assert.ok(!matchesPathPattern('', '/activeIngredients'));
  });
});

describe('segmentsMatchPattern', () => {
  it('agrees with matchesPathPattern for a pre-split path', () => {
    const segments = pathSegments('/organizations/1/fields/2');
    assert.ok(segmentsMatchPattern(segments, '/organizations/{orgId}/fields/{fieldId}'));
    assert.ok(!segmentsMatchPattern(segments, '/organizations/{orgId}/farms/{farmId}'));
  });
});

describe('encodePathParam', () => {
  const encode = (value: unknown) => encodePathParam('fieldId', value);

  // An unpaired surrogate, by code so this file stays ASCII.
  const LONE_SURROGATE = String.fromCharCode(0xd800);

  it('leaves the ids John Deere uses as they are', () => {
    const ids = ['123456', 'b22956b7-8b1c-4a6f-9c0e-2f5d3a1e7c44', 'ENERGY_CANE', 'a.b~c-d'];
    for (const id of ids) assert.strictEqual(encode(id), id);
  });

  it("encodes whatever would change the path's structure", () => {
    assert.strictEqual(encode('a/b'), 'a%2Fb');
    assert.strictEqual(encode('a?b'), 'a%3Fb');
    assert.strictEqual(encode('a#b'), 'a%23b');
    assert.strictEqual(encode('a\\b'), 'a%5Cb');
    assert.strictEqual(encode('a b'), 'a%20b');
    assert.strictEqual(encode('a\tb\nc'), 'a%09b%0Ac');
  });

  it('encodes a value that is already percent-encoded again', () => {
    assert.strictEqual(encode('a%2Fb'), 'a%252Fb');
    assert.strictEqual(encode('%2e%2e'), '%252e%252e');
  });

  // The property tests below draw single code units, so a well-formed pair
  // of surrogates almost never comes up there. One is written out here.
  it('encodes a character outside the basic plane as its UTF-8 bytes', () => {
    const emoji = String.fromCodePoint(0x1f600);
    assert.strictEqual(encode(`a${emoji}b`), 'a%F0%9F%98%80b');
    assert.strictEqual(decodeURIComponent(encode(`a${emoji}b`)), `a${emoji}b`);
  });

  it('leaves "@" and ":" alone, which are legal in a segment', () => {
    assert.strictEqual(encode('@currentUser'), '@currentUser');
    assert.strictEqual(encode('urn:deere:42'), 'urn:deere:42');
  });

  it('accepts a number, a bigint or a boolean as its text', () => {
    assert.strictEqual(encode(42), '42');
    assert.strictEqual(encode(10n), '10');
    assert.strictEqual(encode(false), 'false');
  });

  it('refuses a value that is not text or cannot be a segment, naming the parameter', () => {
    const refused: unknown[] = [
      null,
      undefined,
      {},
      ['a'],
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Symbol('x'),
      '',
      '.',
      '..',
      `a${LONE_SURROGATE}b`,
    ];
    for (const value of refused) {
      assert.throws(
        () => encode(value),
        (error: unknown) => {
          assert(error instanceof DeereError, `expected a DeereError for ${String(value)}`);
          assert.strictEqual(error.status, -1);
          assert.strictEqual(error.statusText, 'InvalidPathParameter');
          assert.match(error.message, /path parameter 'fieldId'/);
          return true;
        }
      );
    }
  });

  // Any 16-bit code unit, weighted toward the characters a URL gives meaning
  // to, so dot segments, separators and unpaired surrogates all turn up.
  const hostileValue = fc.string({
    unit: fc.oneof(
      fc.constantFrom('.', '/', '\\', '?', '#', '%', ':', '@', ';', '&', '=', '+', ' ', '\t', '\n'),
      fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code))
    ),
    maxLength: 12,
  });

  // Written independently of the encoder, which relies on encodeURIComponent
  // throwing: a high surrogate with no low one after it, or a low one with no
  // high one before it.
  const UNPAIRED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const mustBeRefused = (value: string) =>
    value === '' || value === '.' || value === '..' || UNPAIRED.test(value);

  it('refuses exactly the empty string, the dot segments and malformed text', () => {
    fc.assert(
      fc.property(hostileValue, (value) => {
        let refused = false;
        try {
          encode(value);
        } catch {
          refused = true;
        }
        assert.strictEqual(refused, mustBeRefused(value), JSON.stringify(value));
      }),
      { numRuns: 3000 }
    );
  });

  // The property the encoder exists for, stated against the parser a request
  // goes through: the value is exactly one segment, nothing spills into the
  // query or the fragment, and the server can read the original back.
  it('is one segment of the URL it is placed in, and decodes to the value', () => {
    const base = 'https://api.deere.com/platform/organizations/';
    fc.assert(
      fc.property(hostileValue, (value) => {
        fc.pre(!mustBeRefused(value));
        const encoded = encode(value);
        const url = new URL(`${base}${encoded}/fields`);

        // Comparing the pathname alone would not notice an unencoded "/": the
        // path would simply be one segment longer on both sides. So the
        // segments are counted as well.
        assert.strictEqual(url.pathname, `/platform/organizations/${encoded}/fields`);
        assert.deepStrictEqual(url.pathname.split('/'), [
          '',
          'platform',
          'organizations',
          encoded,
          'fields',
        ]);
        assert.strictEqual(url.search, '');
        assert.strictEqual(url.hash, '');
        assert.strictEqual(url.host, 'api.deere.com');
        assert.strictEqual(decodeURIComponent(encoded), value);
      }),
      { numRuns: 3000 }
    );
  });
});
