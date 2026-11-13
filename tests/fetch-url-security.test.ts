/**
 * Where the Bearer token goes.
 *
 * The client attaches the access token only to an https URL on *.deere.com.
 * Every other URL must get no Authorization header unless the caller passed
 * one for that request.
 *
 * Most of these tests reach the rule through `fetchUrl`, the entry point that
 * takes an arbitrary URL, but the rule itself lives in `requestUrl` and covers
 * every request. tests/hateoas.test.ts covers links discovered in HATEOAS mode.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  API_SERVERS,
  type Environment,
  KNOWN_ENVIRONMENTS,
  type SpecName,
} from '../src/api-servers.generated.js';
import { DeereClient } from '../src/client.js';
import { resolveRequestUrl } from '../src/environment-resolver.js';
import { mockWithSpy } from './helpers/mock-fetch.js';

function getAuthHeader(calls: Array<{ init: RequestInit }>): string | undefined {
  return (calls[0]?.init.headers as Record<string, string> | undefined)?.Authorization;
}

/** Every Authorization entry on the first request, whatever its letter case. */
function authorizationHeaders(calls: Array<{ init: RequestInit }>): Array<[string, string]> {
  const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
  return Object.entries(headers).filter(([name]) => name.toLowerCase() === 'authorization');
}

describe('Bearer token guard', () => {
  describe('trusted *.deere.com hosts get the Bearer token', () => {
    const trustedUrls = [
      'https://api.deere.com/platform/organizations',
      'https://sandboxapi.deere.com/platform/fields',
      'https://partnerapi.deere.com/platform/boundaries',
      'https://apicert.deere.com/platform/equipment',
      'https://equipmentapi.deere.com/isg/equipment',
      'https://equipmentapi-qual.deere.com/isg/measurements',
      'https://equipmentapi-cert.deere.com/isg/measurements',
      // Apex deere.com (no subdomain) — still matches
      'https://deere.com/something',
      // Multi-level subdomain
      'https://foo.bar.deere.com/anything',
      // Port is stripped by URL parser before regex check
      'https://api.deere.com:8443/platform',
    ];

    for (const url of trustedUrls) {
      it(`attaches Bearer for ${url}`, async () => {
        const { fetch, calls } = mockWithSpy({});
        const client = new DeereClient({ accessToken: 'secret-abc', fetch });

        await client.fetchUrl('GET', url);

        assert.strictEqual(getAuthHeader(calls), 'Bearer secret-abc');
      });
    }
  });

  describe('untrusted hosts get NO Authorization header', () => {
    const untrustedUrls = [
      'https://untrusted.example/steal-token',
      // Subdomain attack — deere.com is NOT a suffix of the hostname
      'https://deere.com.untrusted.example/foo',
      // Case sensitivity — regex uses /i, but the attack host isn't deere.com
      'https://DEERE.COM.untrusted.example/foo',
      // Localhost for dev
      'http://localhost:3000/api',
      // Non-deere.com that happens to contain "deere"
      'https://not-really-deere-com.example.net/x',
    ];

    for (const url of untrustedUrls) {
      it(`suppresses Bearer for ${url}`, async () => {
        const { fetch, calls } = mockWithSpy({});
        const client = new DeereClient({ accessToken: 'secret-abc', fetch });

        await client.fetchUrl('GET', url);

        assert.strictEqual(getAuthHeader(calls), undefined);
      });
    }
  });

  describe('hateoasDebug mode warns on untrusted hosts', () => {
    it('emits a console.warn when suppressing Bearer (hateoasDebug=true)', async () => {
      const { fetch } = mockWithSpy({});
      const client = new DeereClient({
        accessToken: 'secret',
        fetch,
        hateoasDebug: true,
      });

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);
      try {
        await client.fetchUrl('GET', 'https://untrusted.example/foo');
      } finally {
        console.warn = origWarn;
      }

      assert(warnings.length >= 1, 'should have emitted a warning');
      // Regex-capture to avoid .includes() on hostname (CodeQL js/incomplete-url-substring-sanitization false positive).
      const quotedHost = warnings[0].match(/'([^']+)'/);
      assert.ok(quotedHost, 'warning should quote the offending hostname');
      assert.strictEqual(quotedHost[1], 'untrusted.example');
      assert(warnings[0].includes('not a trusted'));
      assert(warnings[0].includes('suppressed'));
    });

    it('does NOT warn when hateoasDebug is false (default silent)', async () => {
      const { fetch } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'secret', fetch });

      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);
      try {
        await client.fetchUrl('GET', 'https://untrusted.example/foo');
      } finally {
        console.warn = origWarn;
      }

      assert.strictEqual(warnings.length, 0);
    });
  });

  describe('users can still send custom Authorization via options.headers', () => {
    it('custom Authorization in options.headers overrides the guard on trusted hosts', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'client-token', fetch });

      await client.fetchUrl('GET', 'https://api.deere.com/foo', undefined, {
        headers: { Authorization: 'Bearer override-token' },
      });

      assert.strictEqual(getAuthHeader(calls), 'Bearer override-token');
    });

    it('user-set Authorization header works on untrusted hosts too (opt-in)', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'client-token', fetch });

      await client.fetchUrl('GET', 'https://custom.example.com/api', undefined, {
        headers: { Authorization: 'Bearer user-supplied' },
      });

      // User explicitly opted in — the guard defers to the user.
      assert.strictEqual(getAuthHeader(calls), 'Bearer user-supplied');
    });
  });

  describe('a URL that does not parse', () => {
    // The client retries a TypeError as a network failure, and a bad URL is a
    // TypeError too. Fetch is never reached either way, so only the backoff
    // wait tells a retry apart, and the time limit is the assertion. The
    // jitter is pinned to its maximum because the wait is otherwise random
    // and is, about once in 400 runs, short enough to pass.
    it('is rejected at once, not retried with backoff', { timeout: 500 }, async (t) => {
      t.mock.method(Math, 'random', () => 0.999);
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'secret-abc', fetch, maxRetries: 3 });

      await assert.rejects(() => client.fetchUrl('GET', 'not a url'), TypeError);
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('the guard requires https', () => {
    it('sends no Bearer over http, even to a deere.com host', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'secret-abc', fetch });

      await client.fetchUrl('GET', 'http://api.deere.com/platform/organizations');

      assert.deepStrictEqual(authorizationHeaders(calls), []);
    });
  });

  describe('Authorization is matched in any letter case', () => {
    it('a lowercase caller header replaces the Bearer instead of joining it', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'client-token', fetch });

      await client.fetchUrl('GET', 'https://api.deere.com/foo', undefined, {
        headers: { authorization: 'Bearer caller-token' },
      });

      // Two entries differing only in case reach the server as one header
      // carrying both tokens, so exactly one entry may be present.
      assert.deepStrictEqual(authorizationHeaders(calls), [
        ['authorization', 'Bearer caller-token'],
      ]);
    });
  });

  describe('defaultHeaders cannot set Authorization', () => {
    it('one configured there is not sent to an untrusted host', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({
        accessToken: 'client-token',
        fetch,
        defaultHeaders: { Authorization: 'Bearer from-defaults' },
      });

      await client.fetchUrl('GET', 'https://untrusted.example/foo');

      assert.deepStrictEqual(authorizationHeaders(calls), []);
    });

    it('one configured there in lowercase does not join the Bearer on a trusted host', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({
        accessToken: 'client-token',
        fetch,
        defaultHeaders: { authorization: 'Bearer from-defaults' },
      });

      await client.fetchUrl('GET', 'https://api.deere.com/foo');

      assert.deepStrictEqual(authorizationHeaders(calls), [
        ['Authorization', 'Bearer client-token'],
      ]);
    });
  });

  // The guard decides by URL, so a spec whose servers pointed off deere.com
  // would have its calls sent without a token and fail with a 401 that names no
  // cause. This turns that into a failure here. The pairs are read from the
  // generated table, so no spec name, host or count is written down.
  describe('every URL the resolver can build is one the guard trusts', () => {
    const PROBE_PATH = '/guard-probe';
    const pairs: Array<{ spec: SpecName; environment: Environment; path: string }> = [];
    const specsWithServers: SpecName[] = [];

    for (const [name, config] of Object.entries(API_SERVERS)) {
      const spec = name as SpecName;
      if (config.kind === 'unavailable') continue;
      specsWithServers.push(spec);

      const paths = [PROBE_PATH];
      if (config.kind === 'templated') {
        for (const override of config.pathOverrides ?? []) {
          paths.push(override.pattern.replace(/\{[^}]+\}/g, 'x'));
        }
      }
      for (const environment of KNOWN_ENVIRONMENTS) {
        for (const path of paths) {
          try {
            resolveRequestUrl(spec, path, environment);
          } catch {
            continue; // this spec has no server for this environment
          }
          pairs.push({ spec, environment, path });
        }
      }
    }

    it('checks at least one environment for every spec that has servers', () => {
      assert.ok(specsWithServers.length > 0, 'API_SERVERS lists no spec with servers');
      for (const spec of specsWithServers) {
        assert.ok(
          pairs.some((pair) => pair.spec === spec),
          `${spec} resolved in no known environment, so nothing checked its host`
        );
      }
    });

    it('attaches the Bearer to each of them', async () => {
      for (const { spec, environment, path } of pairs) {
        const { fetch, calls } = mockWithSpy({});
        const client = new DeereClient({ accessToken: 'secret-abc', fetch, environment });

        await client.get(spec, path);

        assert.deepStrictEqual(
          authorizationHeaders(calls),
          [['Authorization', 'Bearer secret-abc']],
          `${spec} on ${environment} resolved ${path} to ${calls[0]?.url}, which the guard does not trust`
        );
      }
    });
  });

  describe('followLink is covered by the guard', () => {
    it('followLink to a *.deere.com URL attaches Bearer', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'secret', fetch });

      await client.followLink('https://api.deere.com/foo');

      assert.strictEqual(getAuthHeader(calls), 'Bearer secret');
    });

    it('followLink to a third-party URL suppresses Bearer', async () => {
      const { fetch, calls } = mockWithSpy({});
      const client = new DeereClient({ accessToken: 'secret', fetch });

      await client.followLink('https://tracking.example.com/ping');

      assert.strictEqual(getAuthHeader(calls), undefined);
    });
  });
});
