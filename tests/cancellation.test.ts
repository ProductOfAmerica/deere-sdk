/**
 * Cancelling a request, and timing one out.
 *
 * Two things can end an attempt early: the caller's signal and the client's
 * own timeout. Both have to be in force at once, and they have to be told
 * apart afterwards. A timeout is retried and ends as a DeereError. A
 * cancellation is never retried and rejects with the reason the caller aborted
 * with, which is what fetch does.
 *
 * Every test carries a node:test timeout. Several of these cases used to hang
 * and not fail, which a runner with no limit would wait on forever.
 */

import assert from 'node:assert';
import { getEventListeners } from 'node:events';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  API_SERVERS,
  type Environment,
  KNOWN_ENVIRONMENTS,
  type SpecName,
} from '../src/api-servers.generated.js';
import { DeereClient, DeereError, HateoasError } from '../src/client.js';
import { HATEOAS_MAP } from '../src/hateoas-map.js';

const BASE = 'https://sandboxapi.deere.com/platform';

/**
 * A fetch that never answers. Like the real one it rejects with its signal's
 * reason when that aborts, at once if it already has.
 */
function hangingFetch(): { fetch: typeof fetch; callCount: () => number } {
  let calls = 0;
  const fetchFn: typeof fetch = (_input, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  return { fetch: fetchFn, callCount: () => calls };
}

/** A fetch that answers each call with the next status, and never looks at its signal. */
function statusesInTurn(statuses: number[]): { fetch: typeof fetch; callCount: () => number } {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    const status = statuses[calls++] ?? 200;
    return new Response(status === 200 ? JSON.stringify({ ok: true }) : null, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fetchFn, callCount: () => calls };
}

/**
 * A fetch that answers after `ms`, unless its signal aborts first. For a
 * response that is merely slow, where `hangingFetch` is one that never comes.
 */
function answersAfter(ms: number): typeof fetch {
  return async (_input, init) => {
    await delay(ms, undefined, { signal: init?.signal ?? undefined });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/**
 * A fetch whose response starts at once and whose body, `{"ok":true}`, is
 * complete only after `ms`: never, for Infinity. Like the real one, the body
 * fails with the signal's reason when that aborts. A body that ignored the
 * signal would prove nothing here, since no abort could reach it.
 */
function bodyCompleteAfter(ms: number, status = 200): typeof fetch {
  return async (_input, init) => {
    const signal = init?.signal;
    const text = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(text.encode('{"ok":'));
        const finish = Number.isFinite(ms)
          ? setTimeout(() => {
              controller.enqueue(text.encode('true}'));
              controller.close();
            }, ms)
          : undefined;
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(finish);
            controller.error(signal.reason);
          },
          { once: true }
        );
      },
    });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  };
}

/**
 * A path whose HATEOAS parent belongs to a spec with no server in some
 * environment, with that spec and environment. Looked up, not written down:
 * which specs those are is John Deere's to change.
 */
function parentWithNoServer(): { spec: SpecName; path: string; environment: Environment } | null {
  for (const [pattern, route] of Object.entries(HATEOAS_MAP)) {
    const server = API_SERVERS[route.parentSpec];
    if (server.kind !== 'static') continue;
    const environment = KNOWN_ENVIRONMENTS.find((name) => !(name in server.urlByEnvironment));
    if (environment) {
      return { spec: route.parentSpec, path: pattern.replace(/\{[^}]+\}/g, '1'), environment };
    }
  }
  return null;
}

function assertIsTimeout(error: unknown): asserts error is DeereError {
  assert(error instanceof DeereError, `expected the timeout DeereError, got ${String(error)}`);
  assert.strictEqual(error.status, 0);
  assert.strictEqual(error.statusText, 'Timeout');
}

/** The rejection is the caller's own abort reason: the same object, not a copy or a wrapper. */
function rejectsWithReasonOf(signal: AbortSignal) {
  return (error: unknown) => {
    assert.strictEqual(error, signal.reason);
    assert(!(error instanceof DeereError), 'a cancellation is not a DeereError');
    return true;
  };
}

describe('the timeout', () => {
  it('applies when the caller passes a signal of their own', { timeout: 2000 }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({ accessToken: 'test', fetch, timeout: 10_000, maxRetries: 0 });
    const caller = new AbortController();

    await assert.rejects(
      client.get('organizations', '/organizations', { signal: caller.signal, timeout: 50 }),
      (error: unknown) => {
        assertIsTimeout(error);
        return true;
      }
    );
    assert.strictEqual(callCount(), 1);
    assert.strictEqual(caller.signal.aborted, false, "the caller's signal is theirs to abort");
  });

  it('is still retried, and reported as a timeout', { timeout: 2000 }, async (t) => {
    t.mock.method(Math, 'random', () => 0); // no wait between attempts
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({ accessToken: 'test', fetch, timeout: 50, maxRetries: 1 });
    const caller = new AbortController();

    await assert.rejects(
      client.get('organizations', '/organizations', { signal: caller.signal }),
      (error: unknown) => {
        assertIsTimeout(error);
        assert.strictEqual(error.message, 'Request timeout');
        return true;
      }
    );
    assert.strictEqual(callCount(), 2);
  });

  // The client goes by what it did itself, not by the error's name. An
  // AbortError it did not cause (a fetch wrapper with a limit of its own, say)
  // used to be retried and then reported as this client's timeout.
  it('is not what an abort the client did not cause is reported as', {
    timeout: 2000,
  }, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    const foreign = new DOMException('aborted by a wrapper of its own accord', 'AbortError');
    let calls = 0;
    const client = new DeereClient({
      accessToken: 'test',
      fetch: async () => {
        calls++;
        throw foreign;
      },
      maxRetries: 2,
    });

    await assert.rejects(
      client.get('organizations', '/organizations'),
      (error: unknown) => error === foreign
    );
    assert.strictEqual(calls, 1);
  });

  // Node sets a timer it cannot hold for 1 ms, so without a check of its own
  // the client would time every attempt out at once.
  for (const signal of [undefined, new AbortController().signal]) {
    it(`is turned off by Infinity, ${signal ? 'with' : 'without'} a signal`, {
      timeout: 2000,
    }, async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: answersAfter(40),
        timeout: Number.POSITIVE_INFINITY,
        maxRetries: 0,
      });

      assert.deepStrictEqual(await client.get('organizations', '/organizations', { signal }), {
        ok: true,
      });
    });
  }

  it('covers the wait for a response, not the reading of its body', {
    timeout: 2000,
  }, async () => {
    const client = new DeereClient({
      accessToken: 'test',
      fetch: bodyCompleteAfter(120),
      timeout: 30,
      maxRetries: 0,
    });

    assert.deepStrictEqual(await client.get('organizations', '/organizations'), { ok: true });
  });
});

describe('a request the caller aborts', () => {
  it('rejects with the abort reason and is not retried', { timeout: 2000 }, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({ accessToken: 'test', fetch, timeout: 10_000, maxRetries: 2 });
    const caller = new AbortController();

    const pending = client.get('organizations', '/organizations', { signal: caller.signal });
    setTimeout(() => caller.abort(), 20);

    await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    assert.strictEqual((caller.signal.reason as Error).name, 'AbortError');
    assert.strictEqual(callCount(), 1);
  });

  it('rejects with a reason the caller chose, unchanged', { timeout: 2000 }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({ accessToken: 'test', fetch, timeout: 10_000, maxRetries: 2 });
    const caller = new AbortController();
    const reason = new Error('the report was closed');

    const pending = client.get('organizations', '/organizations', { signal: caller.signal });
    setTimeout(() => caller.abort(reason), 20);

    await assert.rejects(pending, (error: unknown) => error === reason);
    assert.strictEqual(callCount(), 1);
  });

  it('does not sit out the wait before a retry', { timeout: 2000 }, async () => {
    // Retry-After: 30 makes the wait a known 30 seconds, far past this test's limit.
    let calls = 0;
    const client = new DeereClient({
      accessToken: 'test',
      fetch: async () => {
        calls++;
        return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
      },
      maxRetries: 2,
    });
    const caller = new AbortController();

    const pending = client.get('organizations', '/organizations', { signal: caller.signal });
    setTimeout(() => caller.abort(), 20);

    await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    assert.strictEqual(calls, 1);
  });

  // A custom fetch that ignores its signal cannot be interrupted, so the
  // attempt in flight runs to its end. What the client still owes the caller
  // is that nothing further is sent, and no wait either: the answer asks for
  // 30 seconds, and by then the signal aborted long ago, which no listener
  // set from here on will ever be told.
  it('is not retried even when the fetch in use ignores its signal', {
    timeout: 2000,
  }, async () => {
    let calls = 0;
    const client = new DeereClient({
      accessToken: 'test',
      fetch: async () => {
        calls++;
        await delay(40);
        return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
      },
      maxRetries: 2,
    });
    const caller = new AbortController();

    const pending = client.get('organizations', '/organizations', { signal: caller.signal });
    setTimeout(() => caller.abort(), 10);

    await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    assert.strictEqual(calls, 1);
  });

  // The timeout is over once a response starts, but the caller's signal has
  // to stay in force until the body is read, an error body included.
  for (const [status, what] of [
    [200, 'a response'],
    [500, 'an error response'],
  ] as const) {
    it(`is cancelled while the body of ${what} is being read`, { timeout: 2000 }, async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: bodyCompleteAfter(Number.POSITIVE_INFINITY, status),
        timeout: 10_000,
        maxRetries: 0,
      });
      const caller = new AbortController();

      const pending = client.get('organizations', '/organizations', { signal: caller.signal });
      setTimeout(() => caller.abort(), 20);

      await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    });
  }

  it('stops a paginated read before the next page is requested', { timeout: 2000 }, async () => {
    const caller = new AbortController();
    const lastPage = 3;
    let calls = 0;
    const client = new DeereClient({
      accessToken: 'test',
      fetch: async () => {
        calls++;
        const next = { rel: 'nextPage', uri: `${BASE}/organizations?page=${calls + 1}` };
        return new Response(
          JSON.stringify({ values: [{ id: calls }], links: calls < lastPage ? [next] : [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
      maxRetries: 0,
    });

    const seen: unknown[] = [];
    const reading = (async () => {
      const pages = client.paginate('organizations', '/organizations', { signal: caller.signal });
      for await (const page of pages) {
        seen.push(...page);
        caller.abort();
      }
    })();

    await assert.rejects(reading, rejectsWithReasonOf(caller.signal));
    assert.deepStrictEqual(seen, [{ id: 1 }]);
    assert.strictEqual(calls, 1);
  });

  it('leaves no listener behind on a signal used for many requests', {
    timeout: 2000,
  }, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    // A retry (so a wait is part of it), a success, an error response, a success.
    const { fetch, callCount } = statusesInTurn([503, 200, 200, 404, 200]);
    const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 2 });
    const caller = new AbortController();
    const get = () => client.get('organizations', '/organizations', { signal: caller.signal });

    await get();
    await get();
    await assert.rejects(get(), DeereError);
    await get();

    assert.strictEqual(callCount(), 5);
    assert.deepStrictEqual(getEventListeners(caller.signal, 'abort'), []);
  });
});

describe('in HATEOAS mode, the request for the parent resource', () => {
  const parent = `${BASE}/organizations/123`;
  const child = `${BASE}/organizations/123/fields`;

  it('is cancelled by the signal given for the call, and the reason is not wrapped', {
    timeout: 2000,
  }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({
      accessToken: 'test',
      fetch,
      hateoas: true,
      timeout: 10_000,
      maxRetries: 0,
    });
    const caller = new AbortController();

    const pending = client.get('fields', '/organizations/123/fields', { signal: caller.signal });
    setTimeout(() => caller.abort(), 20);

    await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    assert.strictEqual(callCount(), 1);
  });

  it('is cancelled the same way on the first page of getAll', { timeout: 2000 }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({
      accessToken: 'test',
      fetch,
      hateoas: true,
      timeout: 10_000,
      maxRetries: 0,
    });
    const caller = new AbortController();

    const pending = client.getAll('fields', '/organizations/123/fields', { signal: caller.signal });
    setTimeout(() => caller.abort(), 20);

    await assert.rejects(pending, rejectsWithReasonOf(caller.signal));
    assert.strictEqual(callCount(), 1);
  });

  // The parent's URL is looked up before it is fetched, and that lookup can
  // fail by itself. A caller who had already cancelled gets their reason then
  // too, not the lookup's error.
  it('gives the abort reason when the parent has no URL in this environment', {
    timeout: 2000,
  }, async (t) => {
    const found = parentWithNoServer();
    if (!found) {
      t.skip('every HATEOAS parent has a server in every environment');
      return;
    }
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({
      accessToken: 'test',
      fetch,
      hateoas: true,
      environment: found.environment,
      maxRetries: 0,
    });
    const caller = new AbortController();
    caller.abort();

    await assert.rejects(
      client.get(found.spec, found.path, { signal: caller.signal }),
      rejectsWithReasonOf(caller.signal)
    );
    assert.strictEqual(callCount(), 0);
  });

  it('uses the timeout given for the call', { timeout: 2000 }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({
      accessToken: 'test',
      fetch,
      hateoas: true,
      timeout: 10_000,
      maxRetries: 0,
    });

    await assert.rejects(
      client.get('fields', '/organizations/123/fields', { timeout: 50 }),
      (error: unknown) => {
        // A timeout is still a failure to resolve the link, so it stays wrapped.
        assert(error instanceof HateoasError);
        assertIsTimeout(error.cause);
        return true;
      }
    );
    assert.strictEqual(callCount(), 1);
  });

  // The headers were given for the request the caller asked for. An
  // Authorization among them would otherwise replace the client's token on a
  // request the caller never saw.
  it('is not sent the headers given for the call', { timeout: 2000 }, async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const client = new DeereClient({
      accessToken: 'test',
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, headers: init?.headers as Record<string, string> });
        const body =
          url === parent ? { links: [{ rel: 'fields', uri: child }] } : { values: [{ id: 'f1' }] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      hateoas: true,
      maxRetries: 0,
    });

    await client.get('fields', '/organizations/123/fields', {
      headers: { 'X-Trace': 'abc', Authorization: 'Bearer the-callers-own' },
    });

    assert.deepStrictEqual(
      calls.map((call) => call.url),
      [parent, child]
    );
    assert.strictEqual(calls[0].headers['X-Trace'], undefined);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer test');
    assert.strictEqual(calls[1].headers['X-Trace'], 'abc');
    assert.strictEqual(calls[1].headers.Authorization, 'Bearer the-callers-own');
  });
});

/**
 * A fetch that answers every request with a page carrying a HATEOAS link for
 * `/organizations/123/fields` and counts the requests.
 */
function countingFetch(): { fetch: typeof fetch; callCount: () => number } {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls++;
    const body = {
      values: [{ id: calls }],
      links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fetchFn, callCount: () => calls };
}

// Node arms a timer for 1 ms when handed 0, a negative number, NaN or anything
// that is not a number, so such a timeout used to time out every request that
// did not answer within the same turn of the event loop.
describe('a timeout that is not a duration', () => {
  const refused: Array<[string, unknown]> = [
    ['0', 0],
    ['-1', -1],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ["''", ''],
    ["'abc'", 'abc'],
    ["'0'", '0'],
    ['true', true],
    ['{}', {}],
    ['[]', []],
  ];
  const accepted: Array<[string, unknown]> = [
    ['1', 1],
    ['30000', 30_000],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['2 ** 40, above what a timer can hold', 2 ** 40],
    ["'30000'", '30000'],
    ['null', null],
    ['undefined', undefined],
  ];

  function isInvalidTimeout(error: unknown): boolean {
    assert(error instanceof DeereError, `expected a DeereError, got ${String(error)}`);
    assert(!(error instanceof HateoasError), 'the check comes before HATEOAS resolution');
    assert.strictEqual(error.status, -1);
    assert.strictEqual(error.statusText, 'InvalidTimeout');
    assert.match(error.message, /Infinity/);
    return true;
  }

  for (const [label, value] of refused) {
    it(`is refused by the constructor: ${label}`, () => {
      assert.throws(
        () => new DeereClient({ accessToken: 'test', timeout: value as number }),
        (error: unknown) => {
          assert(error instanceof Error);
          assert(!(error instanceof DeereError), 'a configuration error, as for the environment');
          assert.match(error.message, /timeout/);
          assert.match(error.message, /Infinity/);
          return true;
        }
      );
    });

    it(`is refused for a call, before any request: ${label}`, { timeout: 2000 }, async () => {
      const { fetch, callCount } = countingFetch();
      const client = new DeereClient({ accessToken: 'test', fetch, maxRetries: 2 });

      await assert.rejects(
        client.get('organizations', '/organizations', { timeout: value as number }),
        isInvalidTimeout
      );
      assert.strictEqual(callCount(), 0);
    });
  }

  for (const [label, value] of accepted) {
    it(`is accepted by the constructor and for a call: ${label}`, { timeout: 2000 }, async () => {
      const { fetch, callCount } = countingFetch();
      const client = new DeereClient({ accessToken: 'test', fetch, timeout: value as number });

      await client.get('organizations', '/organizations');
      await client.get('organizations', '/organizations', { timeout: value as number });
      assert.strictEqual(callCount(), 2);
    });
  }

  // Neither message may turn the value into a string: an object's toString
  // can throw, or say nothing useful.
  it('is described by its type when it is neither a number nor a string', async () => {
    const hostile = {
      toString() {
        throw new Error('toString was called');
      },
    };
    assert.throws(
      () => new DeereClient({ accessToken: 'test', timeout: hostile as unknown as number }),
      /object/
    );
    const client = new DeereClient({ accessToken: 'test', fetch: countingFetch().fetch });
    await assert.rejects(
      client.get('organizations', '/organizations', { timeout: hostile as unknown as number }),
      /object/
    );
  });

  const methods: Array<
    [string, boolean, (client: DeereClient, timeout: number) => Promise<unknown>]
  > = [
    ['get', false, (c, timeout) => c.get('organizations', '/organizations', { timeout })],
    ['post', false, (c, timeout) => c.post('organizations', '/organizations', {}, { timeout })],
    [
      'the first next() of paginate',
      false,
      (c, timeout) => c.paginate('organizations', '/organizations', { timeout }).next(),
    ],
    ['getAll', false, (c, timeout) => c.getAll('organizations', '/organizations', { timeout })],
    [
      'fetchUrl',
      false,
      (c, timeout) => c.fetchUrl('GET', `${BASE}/organizations`, undefined, { timeout }),
    ],
    ['followLink', false, (c, timeout) => c.followLink(`${BASE}/organizations`, { timeout })],
    [
      'get in HATEOAS mode',
      true,
      (c, timeout) => c.get('fields', '/organizations/123/fields', { timeout }),
    ],
    [
      'getAll in HATEOAS mode',
      true,
      (c, timeout) => c.getAll('fields', '/organizations/123/fields', { timeout }),
    ],
  ];

  for (const [name, hateoas, call] of methods) {
    it(`rejects ${name} with no request sent and no retry`, { timeout: 2000 }, async () => {
      const { fetch, callCount } = countingFetch();
      const client = new DeereClient({ accessToken: 'test', fetch, hateoas, maxRetries: 2 });

      await assert.rejects(call(client, 0), isInvalidTimeout);
      assert.strictEqual(callCount(), 0);
    });
  }

  it('given as null for a call, leaves the client its own', { timeout: 2000 }, async () => {
    const { fetch, callCount } = hangingFetch();
    const client = new DeereClient({ accessToken: 'test', fetch, timeout: 50, maxRetries: 0 });

    await assert.rejects(
      client.get('organizations', '/organizations', { timeout: null as unknown as number }),
      (error: unknown) => {
        assertIsTimeout(error);
        return true;
      }
    );
    assert.strictEqual(callCount(), 1);
  });
});
