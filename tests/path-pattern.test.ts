/**
 * Tests for src/path-pattern.ts.
 *
 * The predicate decides whether a live request gets a per-path base URL, so a
 * false positive routes an unrelated path to the wrong host. The bleed cases
 * below are the ones that matter: same segment count, different literals.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { matchesPathPattern, pathSegments, segmentsMatchPattern } from '../src/path-pattern.js';

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
