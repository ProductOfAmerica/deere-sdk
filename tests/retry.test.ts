import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DeereClient, DeereError } from '../src/client.js';
import { mockFailThenSucceed, mockTimeout } from './helpers/mock-fetch.js';

describe('retry behavior', () => {
  describe('retryable status codes', () => {
    it('retries on 429 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(2, 429, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('organizations', '/test');

      assert.strictEqual(getAttempts(), 3);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 500 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 500, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('organizations', '/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 502 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 502, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('organizations', '/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 503 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(2, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('organizations', '/test');

      assert.strictEqual(getAttempts(), 3);
      assert.deepStrictEqual(result, { data: 'success' });
    });

    it('retries on 504 and succeeds', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 504, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.get<{ data: string }>('organizations', '/test');

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

      await assert.rejects(() => client.get('organizations', '/test'));
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

      await assert.rejects(() => client.get('organizations', '/test'));
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

      await assert.rejects(() => client.get('organizations', '/test'));
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

      await assert.rejects(() => client.get('organizations', '/test'));
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

      await assert.rejects(() => client.get('organizations', '/test'));
      assert.strictEqual(attempts, 1);
    });
  });

  describe('retry limits', () => {
    it('stops after maxRetries attempts', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(10, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      await assert.rejects(
        () => client.get('organizations', '/test'),
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

      await assert.rejects(() => client.get('organizations', '/test'));
      assert.strictEqual(attempts, 1);
    });

    // Below zero means no retries too. It used to mean no request at all: the
    // call rejected with 'RetryExhausted' and nothing had been sent.
    it('still makes the request when maxRetries is below zero', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(0, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: -1 });

      assert.deepStrictEqual(await client.get('organizations', '/test'), { data: 'success' });
      assert.strictEqual(getAttempts(), 1);
    });

    it('respects maxRetries: 1 (one retry)', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(5, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 1 });

      await assert.rejects(() => client.get('organizations', '/test'));
      assert.strictEqual(getAttempts(), 2);
    });

    it('uses default maxRetries of 3', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(10, 503, { data: 'success' });
      const client = new DeereClient({ accessToken: 'test', fetch });

      await assert.rejects(() => client.get('organizations', '/test'));
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

      const result = await client.get<{ data: string }>('organizations', '/test');

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

      const result = await client.get<{ data: string }>('organizations', '/test');

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
        () => client.get('organizations', '/test'),
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
        () => client.get('organizations', '/test'),
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

      const result = await client.get<{ data: string }>('organizations', '/test');

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
        () => client.get('organizations', '/test'),
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

      await client.get('organizations', '/test');

      // Both delays should be at least 900ms (allowing some tolerance)
      // since Retry-After: 1 means 1 second
      assert.strictEqual(attempts, 3);
      assert(delays.length >= 1);
      assert(delays[0] >= 900, `Expected delay >= 900ms, got ${delays[0]}ms`);
    });
  });

  // POST and PATCH name the option here, so these two say what it does and
  // not what its default is. The default has a test of its own, below.
  describe('retry behavior with different HTTP methods', () => {
    it('retries POST requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { created: true });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        maxRetries: 3,
        retryNonIdempotent: true,
      });

      const result = await client.post<{ created: boolean }>('organizations', '/test', {
        data: 'value',
      });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { created: true });
    });

    it('retries PUT requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { updated: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.put<{ updated: boolean }>('organizations', '/test', {
        data: 'value',
      });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { updated: true });
    });

    it('retries DELETE requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { deleted: true });
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

      const result = await client.delete<{ deleted: boolean }>('organizations', '/test');

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { deleted: true });
    });

    it('retries PATCH requests', async () => {
      const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { patched: true });
      const client = new DeereClient({
        accessToken: 'test',
        fetch,
        maxRetries: 3,
        retryNonIdempotent: true,
      });

      const result = await client.patch<{ patched: boolean }>('organizations', '/test', {
        field: 'value',
      });

      assert.strictEqual(getAttempts(), 2);
      assert.deepStrictEqual(result, { patched: true });
    });
  });

  // A POST or PATCH that failed may still have been carried out, and sending
  // it again can do the work twice. With retryNonIdempotent off those two are
  // sent again only after a 429, which a rate limiter gives without handling
  // the request (how rate limiters behave, not something HTTP promises).
  describe('with retryNonIdempotent off', () => {
    type Respond = (init?: RequestInit) => Promise<Response>;

    const send = {
      GET: (client: DeereClient) => client.get('organizations', '/test'),
      POST: (client: DeereClient) => client.post('organizations', '/test', { name: 'x' }),
      PUT: (client: DeereClient) => client.put('organizations', '/test', { name: 'x' }),
      PATCH: (client: DeereClient) => client.patch('organizations', '/test', { name: 'x' }),
      DELETE: (client: DeereClient) => client.delete('organizations', '/test'),
    };

    /** A client with the option off, and how many attempts its fetch has seen. */
    const clientAnsweredBy = (respond: Respond) => {
      let attempts = 0;
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (_input, init) => {
          attempts++;
          return respond(init);
        },
        retryNonIdempotent: false,
        maxRetries: 3,
        timeout: 30,
      });
      return { client, attempts: () => attempts };
    };

    const ok = () =>
      new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    /** Answers `status` the first time and 200 after that. */
    const failsOnceWith = (status: number): Respond => {
      let failed = false;
      return async () => {
        if (failed) return ok();
        failed = true;
        return new Response(null, { status });
      };
    };

    // Each is a failure after which the server may have done the work, and
    // the error the caller is left with when it is not tried again.
    const failures: Array<[name: string, respond: Respond, isTheError: (e: unknown) => boolean]> = [
      [
        'a 503',
        async () => new Response(null, { status: 503 }),
        (e) => e instanceof DeereError && e.status === 503,
      ],
      [
        'a network error',
        async () => {
          throw new TypeError('fetch failed');
        },
        (e) => e instanceof TypeError,
      ],
      [
        'a timeout',
        (init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
        (e) => e instanceof DeereError && e.statusText === 'Timeout',
      ],
    ];

    for (const method of ['POST', 'PATCH'] as const) {
      for (const [failure, respond, isTheError] of failures) {
        it(`sends a ${method} once when it meets ${failure}`, { timeout: 2000 }, async (t) => {
          t.mock.method(Math, 'random', () => 0); // no wait, were it retried
          const { client, attempts } = clientAnsweredBy(respond);

          await assert.rejects(send[method](client), isTheError);
          assert.strictEqual(attempts(), 1);
        });
      }

      it(`still retries a ${method} that was answered 429`, { timeout: 2000 }, async (t) => {
        t.mock.method(Math, 'random', () => 0);
        const { client, attempts } = clientAnsweredBy(failsOnceWith(429));

        assert.deepStrictEqual(await send[method](client), { done: true });
        assert.strictEqual(attempts(), 2);
      });
    }

    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      it(`still retries a ${method} on a 503`, { timeout: 2000 }, async (t) => {
        t.mock.method(Math, 'random', () => 0);
        const { client, attempts } = clientAnsweredBy(failsOnceWith(503));

        assert.deepStrictEqual(await send[method](client), { done: true });
        assert.strictEqual(attempts(), 2);
      });
    }

    // fetchUrl passes the method on as the caller wrote it.
    it('knows a POST whatever case its method is written in', { timeout: 2000 }, async (t) => {
      t.mock.method(Math, 'random', () => 0);
      const { client, attempts } = clientAnsweredBy(failsOnceWith(503));

      await assert.rejects(
        client.fetchUrl('post', 'https://sandboxapi.deere.com/platform/test', { name: 'x' }),
        (e: unknown) => e instanceof DeereError && e.status === 503
      );
      assert.strictEqual(attempts(), 1);
    });

    // The rule lists the methods that are safe to send twice, not the ones
    // that are not, so a method it has never heard of is not sent twice.
    for (const [method, expected] of [
      ['LOCK', 1],
      ['HEAD', 2],
    ] as const) {
      it(`sends a ${method} ${expected === 1 ? 'once' : 'again'} on a 503`, {
        timeout: 2000,
      }, async (t) => {
        t.mock.method(Math, 'random', () => 0);
        const { client, attempts } = clientAnsweredBy(failsOnceWith(503));

        await client
          .fetchUrl(method, 'https://sandboxapi.deere.com/platform/test')
          .catch(() => undefined);
        assert.strictEqual(attempts(), expected);
      });
    }
  });

  // The option is on by default, and 4.0 turns the default off. This is the
  // reminder: it fails once package.json reaches major 4, and passes again
  // when the default has been changed.
  it('retries a POST by default until 4.0, and not from then on', { timeout: 2000 }, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    const major = Number(
      (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version.split(
        '.'
      )[0]
    );
    const { fetch, getAttempts } = mockFailThenSucceed(1, 503, { created: true });
    const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 3 });

    await client.post('organizations', '/test', { name: 'x' }).catch(() => undefined);

    assert.strictEqual(
      getAttempts(),
      major < 4 ? 2 : 1,
      `package.json is at major ${major}. From 4.0 a POST or PATCH is not retried unless the caller ` +
        `asks: make false the default of retryNonIdempotent in the DeereClient constructor, and ` +
        `update its JSDoc, the retry sections of README.md and CLAUDE.md, and the CHANGELOG.`
    );
  });
});
