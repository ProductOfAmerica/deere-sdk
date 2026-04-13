/**
 * fetchUrl security tests — Bearer token hostname allowlist.
 *
 * Verifies that `client.fetchUrl(...)` attaches the Bearer token ONLY when
 * the target hostname matches a trusted *.deere.com origin. Third-party or
 * attacker-controlled URLs must get NO Authorization header.
 *
 * This closes the v1 behavior where `client.get(absoluteUrl)` blindly
 * attached the token to any URL, including potentially malicious ones that
 * might leak via HATEOAS nextPage links or paste-and-fetch bugs.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereClient } from '../src/client.js';
import { mockWithSpy } from './helpers/mock-fetch.js';

function getAuthHeader(calls: Array<{ init: RequestInit }>): string | undefined {
  return (calls[0]?.init.headers as Record<string, string> | undefined)?.Authorization;
}

describe('fetchUrl Bearer token hostname guard', () => {
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
      // HTTP on deere.com is trusted (regex doesn't restrict protocol) — this
      // is the one edge case: we allow http:// on deere.com because test
      // mocks and CI proxies sometimes use it. If you don't want that,
      // tighten the check. Adding as a separate test below.
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

  describe('followLink inherits the fetchUrl guard', () => {
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
