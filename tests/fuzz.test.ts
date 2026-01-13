/**
 * Fuzz tests using fast-check for property-based testing.
 * These tests verify the SDK handles arbitrary inputs safely.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import { DeereClient, DeereError } from '../src/client.js';

/**
 * Mock fetch that returns a controlled response
 */
function mockFetch(responseData: unknown, status = 200) {
  return async (): Promise<Response> =>
    new Response(JSON.stringify(responseData), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Mock fetch that returns error responses
 */
function mockErrorFetch(status: number, body: unknown) {
  return async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      statusText: 'Error',
      headers: { 'Content-Type': 'application/json' },
    });
}

describe('Fuzz Tests', () => {
  describe('DeereClient input handling', () => {
    it('handles arbitrary access tokens without crashing', () => {
      fc.assert(
        fc.property(fc.string(), (token) => {
          // Should not throw during construction
          const client = new DeereClient({
            accessToken: token,
            fetch: mockFetch({ data: 'test' }),
            maxRetries: 0,
          });
          assert(client instanceof DeereClient);
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary path strings safely', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (path) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockFetch({ data: 'test' }),
            maxRetries: 0,
          });

          // Should either succeed or throw a controlled error
          try {
            await client.get(path);
          } catch (error) {
            // Should only throw DeereError or TypeError for invalid URLs
            assert(
              error instanceof DeereError || error instanceof TypeError,
              `Unexpected error type: ${(error as Error).constructor.name}`
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary JSON bodies in POST requests', async () => {
      await fc.assert(
        fc.asyncProperty(fc.jsonValue(), async (body) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockFetch({ created: true }),
            maxRetries: 0,
          });

          // Should handle any JSON-serializable value
          const result = await client.post('/test', body);
          assert.deepStrictEqual(result, { created: true });
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary custom headers', async () => {
      await fc.assert(
        fc.asyncProperty(fc.dictionary(fc.string(), fc.string()), async (headers) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockFetch({ data: 'test' }),
            maxRetries: 0,
          });

          // Should not crash with arbitrary headers
          try {
            await client.get('/test', { headers });
          } catch (error) {
            // Header validation errors are acceptable
            assert(error instanceof Error, 'Should throw an Error instance if it fails');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary environment values in config', () => {
      const validEnvironments = ['production', 'sandbox', 'partner', 'cert', 'qa'] as const;

      fc.assert(
        fc.property(fc.constantFrom(...validEnvironments), (env) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            environment: env,
            fetch: mockFetch({ data: 'test' }),
            maxRetries: 0,
          });
          assert(client instanceof DeereClient);
        }),
        { numRuns: 50 }
      );
    });

    it('handles arbitrary timeout values', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 600000 }), (timeout) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            timeout,
            fetch: mockFetch({ data: 'test' }),
            maxRetries: 0,
          });
          assert(client instanceof DeereClient);
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary maxRetries values', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), (maxRetries) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            maxRetries,
            fetch: mockFetch({ data: 'test' }),
          });
          assert(client instanceof DeereClient);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Error response handling', () => {
    it('extracts messages from arbitrary error response shapes', async () => {
      const errorShapeArb = fc.oneof(
        fc.record({ message: fc.string() }),
        fc.record({ error: fc.string() }),
        fc.record({ error_description: fc.string() }),
        fc.record({
          errors: fc.array(fc.record({ message: fc.string() }), { minLength: 1, maxLength: 3 }),
        }),
        fc.dictionary(fc.string(), fc.jsonValue())
      );

      await fc.assert(
        fc.asyncProperty(errorShapeArb, async (errorBody) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockErrorFetch(400, errorBody),
            maxRetries: 0,
          });

          try {
            await client.get('/test');
            assert.fail('Should have thrown');
          } catch (error) {
            assert(error instanceof DeereError);
            // Message should be a string (extracted or fallback)
            assert(typeof error.message === 'string');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary HTTP status codes', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 400, max: 599 }), async (status) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockErrorFetch(status, { message: 'Error' }),
            maxRetries: 0,
          });

          try {
            await client.get('/test');
            assert.fail('Should have thrown');
          } catch (error) {
            assert(error instanceof DeereError);
            assert.strictEqual(error.status, status);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('HAL link handling', () => {
    it('handles arbitrary link objects', async () => {
      const linkArb = fc.record({
        rel: fc.string(),
        uri: fc.oneof(
          fc.webUrl(),
          fc.string().map((s) => `/${s}`)
        ),
      });

      await fc.assert(
        fc.asyncProperty(linkArb, async (link) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockFetch({ data: 'linked' }),
            maxRetries: 0,
          });

          try {
            await client.followLink(link);
          } catch (error) {
            // URL parsing errors are acceptable
            assert(error instanceof Error, 'Should throw an Error instance if it fails');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('handles arbitrary string URLs in followLink', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (url) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            fetch: mockFetch({ data: 'linked' }),
            maxRetries: 0,
          });

          try {
            await client.followLink(url);
          } catch (error) {
            // URL parsing errors are acceptable
            assert(error instanceof Error, 'Should throw an Error instance if it fails');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Pagination handling', () => {
    it('handles arbitrary paginated response shapes', async () => {
      const paginatedResponseArb = fc.record({
        values: fc.array(fc.jsonValue(), { maxLength: 10 }),
        total: fc.option(fc.integer({ min: 0, max: 1000 })),
        links: fc.option(
          fc.array(
            fc.record({
              rel: fc.constantFrom('self', 'nextPage', 'prevPage'),
              uri: fc.string(),
            }),
            { maxLength: 3 }
          )
        ),
      });

      await fc.assert(
        fc.asyncProperty(paginatedResponseArb, async (response) => {
          const client = new DeereClient({
            accessToken: 'test-token',
            // Return the response once, then empty to stop pagination
            fetch: (() => {
              let called = false;
              return async () => {
                if (!called) {
                  called = true;
                  return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  });
                }
                return new Response(JSON.stringify({ values: [] }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                });
              };
            })(),
            maxRetries: 0,
          });

          // Should handle arbitrary response shapes without crashing
          const results: unknown[] = [];
          for await (const page of client.paginate('/test')) {
            results.push(...page);
            // Prevent infinite loops in test
            if (results.length > 100) break;
          }
        }),
        { numRuns: 50 }
      );
    });
  });
});
