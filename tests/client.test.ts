import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DeereClient,
  DeereError,
  AuthError,
  RateLimitError,
  createClient,
} from '../src/client.js';
import {
  mockJsonResponse,
  mockErrorResponse,
  mockWithSpy,
} from './helpers/mock-fetch.js';

describe('DeereClient', () => {
  describe('error handling', () => {
    it('throws AuthError on 401', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(401, { message: 'Invalid token' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof AuthError);
          assert.strictEqual(error.message, 'Invalid token');
          assert.strictEqual((error as AuthError).status, 401);
          return true;
        },
      );
    });

    it('throws AuthError on 403', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(403, { message: 'Forbidden' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof AuthError);
          assert.strictEqual((error as AuthError).status, 403);
          return true;
        },
      );
    });

    it('throws RateLimitError on 429 with retryAfter', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(429, { message: 'Too many requests' }, { 'Retry-After': '30' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof RateLimitError);
          assert.strictEqual((error as RateLimitError).retryAfter, 30);
          return true;
        },
      );
    });

    it('throws RateLimitError on 429 without retryAfter', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(429, { message: 'Rate limited' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof RateLimitError);
          assert.strictEqual((error as RateLimitError).retryAfter, undefined);
          return true;
        },
      );
    });

    it('throws DeereError on 500', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(500, { message: 'Server error' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          assert(!(error instanceof AuthError));
          assert(!(error instanceof RateLimitError));
          assert.strictEqual((error as DeereError).status, 500);
          return true;
        },
      );
    });

    it('throws DeereError on 400', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, { message: 'Bad request' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          assert.strictEqual((error as DeereError).status, 400);
          return true;
        },
      );
    });

    it('extracts error message from message field', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, { message: 'Custom error message' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.strictEqual(error.message, 'Custom error message');
          return true;
        },
      );
    });

    it('extracts error message from error field', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, { error: 'Error from error field' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.strictEqual(error.message, 'Error from error field');
          return true;
        },
      );
    });

    it('extracts error message from error_description field', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, { error_description: 'OAuth error' }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.strictEqual(error.message, 'OAuth error');
          return true;
        },
      );
    });

    it('extracts error message from nested errors array', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, { errors: [{ message: 'First error' }] }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.strictEqual(error.message, 'First error');
          return true;
        },
      );
    });

    it('includes response body in error', async () => {
      const errorBody = { message: 'Error', details: { field: 'value' } };
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockErrorResponse(400, errorBody),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.deepStrictEqual((error as DeereError).body, errorBody);
          return true;
        },
      );
    });
  });

  describe('request building', () => {
    it('sets Authorization header with Bearer token', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'my-secret-token', fetch });

      await client.get('/test');

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['Authorization'],
        'Bearer my-secret-token',
      );
    });

    it('sets Accept header to Deere format', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.get('/test');

      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['Accept'],
        'application/vnd.deere.axiom.v3+json',
      );
    });

    it('sets Content-Type header to Deere format', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.get('/test');

      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['Content-Type'],
        'application/vnd.deere.axiom.v3+json',
      );
    });

    it('builds URL from path with sandbox environment by default', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.get('/organizations');

      assert.strictEqual(calls[0].url, 'https://sandboxapi.deere.com/platform/organizations');
    });

    it('builds URL with production environment', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        environment: 'production',
      });

      await client.get('/organizations');

      assert.strictEqual(calls[0].url, 'https://api.deere.com/platform/organizations');
    });

    it('uses custom baseUrl over environment', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        baseUrl: 'https://custom.api.com',
      });

      await client.get('/test');

      assert.strictEqual(calls[0].url, 'https://custom.api.com/test');
    });

    it('passes through full URLs without modification', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.get('https://other.api.com/resource');

      assert.strictEqual(calls[0].url, 'https://other.api.com/resource');
    });

    it('includes custom headers from config', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        defaultHeaders: { 'X-Custom': 'value' },
      });

      await client.get('/test');

      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['X-Custom'],
        'value',
      );
    });

    it('includes custom headers from request options', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.get('/test', { headers: { 'X-Request': 'header' } });

      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['X-Request'],
        'header',
      );
    });

    it('sends JSON body for POST requests', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.post('/test', { name: 'value' });

      assert.strictEqual(calls[0].init.method, 'POST');
      assert.strictEqual(calls[0].init.body, JSON.stringify({ name: 'value' }));
    });

    it('sends JSON body for PUT requests', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.put('/test', { updated: true });

      assert.strictEqual(calls[0].init.method, 'PUT');
      assert.strictEqual(calls[0].init.body, JSON.stringify({ updated: true }));
    });

    it('sends JSON body for PATCH requests', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.patch('/test', { partial: 'update' });

      assert.strictEqual(calls[0].init.method, 'PATCH');
      assert.strictEqual(calls[0].init.body, JSON.stringify({ partial: 'update' }));
    });

    it('sends no body for DELETE requests', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.delete('/test');

      assert.strictEqual(calls[0].init.method, 'DELETE');
      assert.strictEqual(calls[0].init.body, undefined);
    });
  });

  describe('response handling', () => {
    it('parses JSON response', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockJsonResponse({ id: 1, name: 'Test' }),
      });

      const result = await client.get<{ id: number; name: string }>('/test');

      assert.deepStrictEqual(result, { id: 1, name: 'Test' });
    });

    it('handles 204 No Content', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => new Response(null, { status: 204 }),
      });

      const result = await client.delete('/test');

      assert.strictEqual(result, undefined);
    });

    it('handles empty content-length', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response('', {
            status: 200,
            headers: { 'Content-Length': '0' },
          }),
      });

      const result = await client.get('/test');

      assert.strictEqual(result, undefined);
    });

    it('handles Deere content type', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(JSON.stringify({ data: 'value' }), {
            status: 200,
            headers: { 'Content-Type': 'application/vnd.deere.axiom.v3+json' },
          }),
      });

      const result = await client.get<{ data: string }>('/test');

      assert.deepStrictEqual(result, { data: 'value' });
    });

    it('returns text for non-JSON responses', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response('Plain text response', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      });

      const result = await client.get('/test');

      assert.strictEqual(result, 'Plain text response');
    });
  });

  describe('followLink', () => {
    it('follows HAL link object', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'linked' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.followLink({ rel: 'self', uri: 'https://api.deere.com/resource/123' });

      assert.strictEqual(calls[0].url, 'https://api.deere.com/resource/123');
    });

    it('follows string URL', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'linked' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.followLink('https://api.deere.com/resource/456');

      assert.strictEqual(calls[0].url, 'https://api.deere.com/resource/456');
    });

    it('handles relative URI in link', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'linked' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await client.followLink({ rel: 'next', uri: '/page/2' });

      assert.strictEqual(calls[0].url, 'https://sandboxapi.deere.com/platform/page/2');
    });
  });

  describe('createClient factory', () => {
    it('creates a DeereClient instance', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = createClient({ accessToken: 'factory-token', fetch });

      assert(client instanceof DeereClient);
      await client.get('/test');

      assert.strictEqual(
        (calls[0].init.headers as Record<string, string>)['Authorization'],
        'Bearer factory-token',
      );
    });
  });

  describe('edge cases', () => {
    it('falls back to text body when JSON parsing fails', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response('Plain text error message', {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' }, // Claims JSON but isn't
          }),
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          // Should fall back to statusText when body can't be parsed
          assert.strictEqual(error.message, 'Bad Request');
          return true;
        },
      );
    });

    it('handles error response with text body fallback that also fails', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          const response = new Response(null, {
            status: 400,
            statusText: 'Bad Request',
          });
          return response;
        },
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          assert.strictEqual(error.message, 'Bad Request');
          return true;
        },
      );
    });

    it('respects custom signal option', async () => {
      const controller = new AbortController();
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (_url, init) => {
          // Check if already aborted
          if (init?.signal?.aborted) {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            throw error;
          }
          return new Response(JSON.stringify({ data: 'test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        maxRetries: 0,
      });

      // Abort before making request
      controller.abort();

      await assert.rejects(
        () => client.get('/test', { signal: controller.signal }),
        (error: Error) => {
          // AbortError gets wrapped in DeereError with 'Request timeout' message
          assert(error instanceof DeereError);
          assert.strictEqual(error.message, 'Request timeout');
          return true;
        },
      );
    });

    it('uses all environment URLs correctly', async () => {
      const environments = ['production', 'sandbox', 'partner', 'cert', 'qa'] as const;
      const expectedUrls: Record<string, string> = {
        production: 'https://api.deere.com/platform/test',
        sandbox: 'https://sandboxapi.deere.com/platform/test',
        partner: 'https://partnerapi.deere.com/platform/test',
        cert: 'https://apicert.deere.com/platform/test',
        qa: 'https://apiqa.tal.deere.com/platform/test',
      };

      for (const env of environments) {
        const { fetch, calls } = mockWithSpy({ data: 'test' });
        const client = new DeereClient({ accessToken: 'test', fetch, environment: env });

        await client.get('/test');

        assert.strictEqual(calls[0].url, expectedUrls[env], `Failed for environment: ${env}`);
      }
    });

    it('handles request timeout option override', async () => {
      let requestStartTime = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (_url, init) => {
          requestStartTime = Date.now();
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        },
        timeout: 10000, // Default 10s
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/test', { timeout: 50 }), // Override to 50ms
        (error: Error) => {
          const elapsed = Date.now() - requestStartTime;
          assert(elapsed < 200, `Timeout should have triggered quickly, took ${elapsed}ms`);
          return true;
        },
      );
    });

    it('works without any optional config', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      // Only required field is accessToken
      const client = new DeereClient({ accessToken: 'minimal', fetch });

      const result = await client.get<{ data: string }>('/test');

      assert.deepStrictEqual(result, { data: 'test' });
      // Should use default sandbox environment
      assert(calls[0].url.includes('sandboxapi.deere.com'));
    });

    it('works without defaultHeaders config', async () => {
      const { fetch, calls } = mockWithSpy({ data: 'test' });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        // No defaultHeaders provided
      });

      await client.get('/test');

      // Should still have the required Deere headers
      const headers = calls[0].init.headers as Record<string, string>;
      assert.strictEqual(headers['Accept'], 'application/vnd.deere.axiom.v3+json');
      assert.strictEqual(headers['Content-Type'], 'application/vnd.deere.axiom.v3+json');
    });
  });
});
