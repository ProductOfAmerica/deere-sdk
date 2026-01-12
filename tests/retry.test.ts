import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereClient, DeereError } from '../src/client.js';
import { mockFailThenSucceed, mockTimeout } from './helpers/mock-fetch.js';

describe('retry behavior', () => {
  describe('retryable status codes', () => {
    it('retries on 429 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(2, 429, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(getAttempts(), 3);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 500 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 500, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 502 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 502, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 503 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(2, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(getAttempts(), 3);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 504 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 504, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });
  });

  describe('non-retryable status codes', () => {
    it('does not retry on 401', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
        },
        maxRetries: 3,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });

    it('does not retry on 403', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 });
        },
        maxRetries: 3,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });

    it('does not retry on 400', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(JSON.stringify({ message: 'Bad request' }), { status: 400 });
        },
        maxRetries: 3,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });

    it('does not retry on 404', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
        },
        maxRetries: 3,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });

    it('does not retry on 422', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(JSON.stringify({ message: 'Unprocessable' }), { status: 422 });
        },
        maxRetries: 3,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });
  });

  describe('retry limits', () => {
    it('stops after maxRetries attempts', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(10, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          return true;
        }
      );

      // 1 initial + 3 retries = 4 total attempts
      assert.strictEqual(getAttempts(), 4);
    });

    it('respects maxRetries: 0 (no retries)', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          return new Response(null, { status: 503 });
        },
        maxRetries: 0,
      });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(attempts, 1);
    });

    it('respects maxRetries: 1 (one retry)', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(5, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 1 });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(getAttempts(), 2);
    });

    it('uses default maxRetries of 3', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(10, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await assert.rejects(() => client.get('/test'));
      assert.strictEqual(getAttempts(), 4); // 1 initial + 3 retries
    });
  });

  describe('network errors', () => {
    it('retries on TypeError network error and succeeds', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          if (attempts < 3) {
            throw new TypeError('fetch failed');
          }
          return new Response(JSON.stringify({ data: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        maxRetries: 3,
      });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(attempts, 3);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on Error with fetch in message and succeeds', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('fetch failed: network unreachable');
          }
          return new Response(JSON.stringify({ data: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        maxRetries: 3,
      });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(attempts, 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('throws after max retries on persistent network error', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          throw new TypeError('fetch failed');
        },
        maxRetries: 2,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof TypeError);
          return true;
        }
      );

      assert.strictEqual(attempts, 3); // 1 initial + 2 retries
    });

    it('does not retry on non-network errors', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          throw new Error('Some other error');
        },
        maxRetries: 3,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert.strictEqual(error.message, 'Some other error');
          return true;
        }
      );

      assert.strictEqual(attempts, 1); // No retries
    });
  });

  describe('timeout errors', () => {
    it('retries on timeout and succeeds', async () => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (_url, init) => {
          attempts++;
          if (attempts < 2) {
            // Simulate timeout by waiting for abort
            return new Promise((_, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                reject(error);
              });
            });
          }
          return new Response(JSON.stringify({ data: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        timeout: 50, // Very short timeout
        maxRetries: 3,
      });

      const result = await client.get<{ data: string }>('/test');

      assert.strictEqual(attempts, 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('throws DeereError with timeout info after max retries', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockTimeout(),
        timeout: 50,
        maxRetries: 1,
      });

      await assert.rejects(
        () => client.get('/test'),
        (error: Error) => {
          assert(error instanceof DeereError);
          assert.strictEqual(error.message, 'Request timeout');
          assert.strictEqual((error as DeereError).status, 0);
          return true;
        }
      );
    });
  });

  describe('retry-after header', () => {
    it('respects Retry-After header on 429', async () => {
      const delays: number[] = [];
      let attempts = 0;
      let lastTime = Date.now();

      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () => {
          attempts++;
          const now = Date.now();
          if (attempts > 1) {
            delays.push(now - lastTime);
          }
          lastTime = now;

          if (attempts < 3) {
            return new Response(null, {
              status: 429,
              headers: { 'Retry-After': '1' }, // 1 second
            });
          }
          return new Response(JSON.stringify({ data: 'success' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        maxRetries: 3,
      });

      await client.get('/test');

      // Both delays should be at least 900ms (allowing some tolerance)
      // since Retry-After: 1 means 1 second
      assert.strictEqual(attempts, 3);
      assert(delays.length >= 1);
      assert(delays[0] >= 900, `Expected delay >= 900ms, got ${delays[0]}ms`);
    });
  });

  describe('retry behavior with different HTTP methods', () => {
    it('retries POST requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { created: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.post<{ created: boolean }>('/test', { data: 'value' });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { created: true });
    });

    it('retries PUT requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { updated: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.put<{ updated: boolean }>('/test', { data: 'value' });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { updated: true });
    });

    it('retries DELETE requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { deleted: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.delete<{ deleted: boolean }>('/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { deleted: true });
    });

    it('retries PATCH requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { patched: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.patch<{ patched: boolean }>('/test', { field: 'value' });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { patched: true });
    });
  });
});
