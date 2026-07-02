import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeSpecContent,
  validateFetchedSpec,
  validateFetchedSpecDocs,
} from '../scripts/lib/fetched-spec-utils.js';

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

  describe('validateFetchedSpecDocs', () => {
    const multiAllowed = new Set(['products']);
    const varietiesYml = "openapi: '3.0.0'\ninfo:\n  title: Varieties\npaths: {}\n";
    const chemicalsYml =
      "openapi: '3.0.0'\ninfo:\n  title: Chemicals\npaths:\n  /chemicals:\n    get:\n      description: 'Email someone@deere.com for help'\n      responses: {}\n";

    function element(
      id: number,
      end_point_name: string,
      yml_content: string
    ): Record<string, unknown> {
      return { id, name: 'products', end_point_name, yml_content };
    }

    it('validates every element, captures endPointName, and applies redaction', () => {
      const body = [element(1, 'varieties', varietiesYml), element(2, 'chemicals', chemicalsYml)];
      const result = validateFetchedSpecDocs('products', body, multiAllowed);
      assert.ok(result, 'expected a non-null array');
      assert.strictEqual(result.length, 2);

      assert.deepStrictEqual(
        result.map((doc) => doc.endPointName),
        ['varieties', 'chemicals']
      );
      assert.strictEqual(result[0].slug, 'products');
      assert.strictEqual(result[0].id, 1);
      assert.strictEqual(result[0].name, 'products');

      // Redaction ran on each element: the example email is rewritten.
      assert.ok(result[1].ymlContent.includes('redacted@example.com'));
      assert.ok(!result[1].ymlContent.includes('someone@deere.com'));
    });

    it('fails the whole slug (null) when one element is missing end_point_name', () => {
      const body = [
        element(1, 'varieties', varietiesYml),
        { id: 2, name: 'products', yml_content: varietiesYml },
      ];
      assert.strictEqual(validateFetchedSpecDocs('products', body, multiAllowed), null);
    });

    it('fails the slug (null) when one element has an empty end_point_name', () => {
      const body = [element(1, 'varieties', varietiesYml), element(2, '', varietiesYml)];
      assert.strictEqual(validateFetchedSpecDocs('products', body, multiAllowed), null);
    });

    it('fails the slug (null) when one element has invalid OpenAPI content', () => {
      const body = [
        element(1, 'varieties', varietiesYml),
        element(2, 'chemicals', 'info:\n  title: No version\npaths: {}\n'),
      ];
      assert.strictEqual(validateFetchedSpecDocs('products', body, multiAllowed), null);
    });

    it('returns null for an empty array', () => {
      assert.strictEqual(validateFetchedSpecDocs('products', [], multiAllowed), null);
    });

    it('returns null for a non-array response body', () => {
      assert.strictEqual(validateFetchedSpecDocs('products', {}, multiAllowed), null);
      assert.strictEqual(validateFetchedSpecDocs('products', null, multiAllowed), null);
    });

    it('throws on slugs outside the trusted local catalog', () => {
      assert.throws(
        () => validateFetchedSpecDocs('not-a-local-slug', [], multiAllowed),
        /Unexpected API slug/
      );
    });
  });
});
