import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeSpecContent, validateFetchedSpec } from '../scripts/lib/fetched-spec-utils.js';

const allowedSlugs = new Set(['fields']);

function validResponse(yml_content = "openapi: '3.0.0'\ninfo:\n  title: Fields\npaths: {}\n") {
  return [
    {
      id: 123,
      name: 'Fields',
      yml_content,
    },
  ];
}

describe('fetched spec utilities', () => {
  describe('normalizeSpecContent', () => {
    it('normalizes CRLF line endings to LF', () => {
      assert.strictEqual(
        normalizeSpecContent('openapi: 3.0.0\r\npaths: {}\r\n'),
        'openapi: 3.0.0\npaths: {}\n'
      );
    });
  });

  describe('validateFetchedSpec', () => {
    it('accepts a known slug with a valid OpenAPI response payload', () => {
      assert.deepStrictEqual(validateFetchedSpec('fields', validResponse(), allowedSlugs), {
        slug: 'fields',
        id: 123,
        name: 'Fields',
        ymlContent: "openapi: '3.0.0'\ninfo:\n  title: Fields\npaths: {}\n",
      });
    });

    it('rejects unexpected response shapes', () => {
      assert.strictEqual(validateFetchedSpec('fields', {}, allowedSlugs), null);
      assert.strictEqual(validateFetchedSpec('fields', [], allowedSlugs), null);
      assert.strictEqual(validateFetchedSpec('fields', [{ id: '123' }], allowedSlugs), null);
    });

    it('rejects empty or invalid OpenAPI content', () => {
      assert.strictEqual(validateFetchedSpec('fields', validResponse(''), allowedSlugs), null);
      assert.strictEqual(
        validateFetchedSpec('fields', validResponse('openapi: [\n'), allowedSlugs),
        null
      );
      assert.strictEqual(
        validateFetchedSpec(
          'fields',
          validResponse('info:\n  title: Missing version\npaths: {}\n'),
          allowedSlugs
        ),
        null
      );
    });

    it('throws on slugs outside the trusted local catalog', () => {
      assert.throws(
        () => validateFetchedSpec('not-a-local-slug', validResponse(), allowedSlugs),
        /Unexpected API slug/
      );
    });
  });
});
