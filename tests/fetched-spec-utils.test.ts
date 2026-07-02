import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeSpecContent,
  validateFetchedSpecDocs,
} from '../scripts/lib/fetched-spec-utils.js';

describe('fetched spec utilities', () => {
  describe('normalizeSpecContent', () => {
    it('normalizes CRLF line endings to LF', () => {
      assert.strictEqual(
        normalizeSpecContent('openapi: 3.0.0\r\npaths: {}\r\n'),
        'openapi: 3.0.0\npaths: {}\n'
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

    it('validates a single-document response the same way multi-document slugs are validated', () => {
      const body = [element(1, 'varieties', varietiesYml)];
      const result = validateFetchedSpecDocs('products', body, multiAllowed);
      assert.ok(result, 'expected a non-null array');
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0], {
        slug: 'products',
        id: 1,
        name: 'products',
        endPointName: 'varieties',
        ymlContent: varietiesYml,
      });
    });

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

    it('fails the slug (null) when one element has an invalid field type', () => {
      const body = [
        element(1, 'varieties', varietiesYml),
        { id: '2', name: 'products', end_point_name: 'chemicals', yml_content: chemicalsYml },
      ];
      assert.strictEqual(validateFetchedSpecDocs('products', body, multiAllowed), null);
    });

    it('fails the slug (null) when one element is not an object', () => {
      const body = [element(1, 'varieties', varietiesYml), 'not-an-object'];
      assert.strictEqual(validateFetchedSpecDocs('products', body, multiAllowed), null);
    });

    it('fails the slug (null) when one element has empty or invalid OpenAPI content', () => {
      const bodyWith = (yml_content: string) => [
        element(1, 'varieties', varietiesYml),
        element(2, 'chemicals', yml_content),
      ];
      assert.strictEqual(validateFetchedSpecDocs('products', bodyWith(''), multiAllowed), null);
      assert.strictEqual(
        validateFetchedSpecDocs('products', bodyWith('openapi: [\n'), multiAllowed),
        null
      );
      assert.strictEqual(
        validateFetchedSpecDocs(
          'products',
          bodyWith('info:\n  title: Missing version\npaths: {}\n'),
          multiAllowed
        ),
        null
      );
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
