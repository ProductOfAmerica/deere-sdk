/**
 * A path parameter's value is data. Whatever it contains, it has to arrive as
 * one segment of the path the method was generated for.
 *
 * These go through the generated methods on purpose, with a fetch that only
 * records: the defect was in how generated code built its path, so that is
 * the code under test. tests/path-pattern.test.ts covers the encoder alone.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereError } from '../src/client.js';
import { Deere } from '../src/deere.js';
import { mockWithSpy } from './helpers/mock-fetch.js';

function recordingSdk() {
  const { fetch, calls } = mockWithSpy({});
  const deere = new Deere({ accessToken: 't', fetch, environment: 'api', maxRetries: 0 });
  return { deere, calls };
}

/** The one request made, as a parsed URL: what a server would be asked for. */
function requested(calls: Array<{ url: string }>): URL {
  assert.strictEqual(calls.length, 1, `expected one request, saw ${calls.length}`);
  return new URL(calls[0].url);
}

function isRefusalNaming(parameter: string) {
  return (error: unknown): boolean => {
    assert(error instanceof DeereError, `expected a DeereError, got ${String(error)}`);
    // -1 marks an error raised before any request, as the resolver's are.
    assert.strictEqual(error.status, -1);
    assert.strictEqual(error.statusText, 'InvalidPathParameter');
    const quoted = error.message.match(/'([^']+)'/);
    assert.ok(quoted, `message should quote the parameter name: ${error.message}`);
    assert.strictEqual(quoted[1], parameter);
    return true;
  };
}

describe('path parameters in generated methods', () => {
  it('a value containing "/", "?" and "#" stays one segment', async () => {
    const { deere, calls } = recordingSdk();

    await deere.notifications.delete('a/b?c#d');

    const url = requested(calls);
    assert.strictEqual(url.pathname, '/platform/notificationEvents/a%2Fb%3Fc%23d');
    assert.strictEqual(url.search, '');
    assert.strictEqual(url.hash, '');
  });

  // The reported case: an id that walked out of its own resource. Before the
  // encoder this was sent as DELETE /platform/organizations/999.
  it('a value made of dot segments cannot address another resource', async () => {
    const { deere, calls } = recordingSdk();

    await deere.notifications.delete('abc/../../organizations/999');

    assert.strictEqual(
      requested(calls).pathname,
      '/platform/notificationEvents/abc%2F..%2F..%2Forganizations%2F999'
    );
  });

  it('".." on its own is refused before any request', async () => {
    const { deere, calls } = recordingSdk();

    await assert.rejects(() => deere.notifications.delete('..'), isRefusalNaming('sourceEvent'));
    assert.strictEqual(calls.length, 0);
  });

  it('the empty string is refused before any request', async () => {
    const { deere, calls } = recordingSdk();

    await assert.rejects(() => deere.fields.get('org-1', ''), isRefusalNaming('fieldId'));
    assert.strictEqual(calls.length, 0);
  });

  it('undefined from an untyped caller is refused, not sent as the word "undefined"', async () => {
    const { deere, calls } = recordingSdk();
    const untyped = deere.fields.get as (orgId: unknown, fieldId: unknown) => Promise<unknown>;

    await assert.rejects(
      () => untyped.call(deere.fields, 'org-1', undefined),
      isRefusalNaming('fieldId')
    );
    assert.strictEqual(calls.length, 0);
  });

  it('a number from an untyped caller is sent as its digits', async () => {
    const { deere, calls } = recordingSdk();
    const untyped = deere.fields.get as (orgId: unknown, fieldId: unknown) => Promise<unknown>;

    await untyped.call(deere.fields, 123, 456);

    assert.strictEqual(requested(calls).pathname, '/platform/organizations/123/fields/456');
  });

  it('"@" and ":" are sent as they are', async () => {
    const { deere, calls } = recordingSdk();

    await deere.users.get('@currentUser');

    assert.strictEqual(requested(calls).pathname, '/platform/users/@currentUser');
  });

  it('a value that is already percent-encoded is encoded again', async () => {
    const { deere, calls } = recordingSdk();

    await deere.notifications.delete('a%2Fb');

    assert.strictEqual(requested(calls).pathname, '/platform/notificationEvents/a%252Fb');
  });

  // Routing matches the request path against patterns segment by segment. A
  // raw "/" in a value added a segment, so the pattern stopped matching and
  // the request fell back to the spec's default base.
  it('a value containing "/" still gets the base its path is routed to', async () => {
    const { deere, calls } = recordingSdk();

    await deere.notifications.get('a/b');

    const url = requested(calls);
    assert.strictEqual(url.pathname, '/isg/notifications/a%2Fb');
  });

  it('a value containing "/" still finds its parent in HATEOAS mode', async () => {
    const parent = 'https://api.deere.com/platform/organizations/org%2F1';
    const discovered = 'https://api.deere.com/platform/organizations/org%2F1/fields';
    const calls: string[] = [];
    const deere = new Deere({
      accessToken: 't',
      environment: 'api',
      hateoas: true,
      maxRetries: 0,
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push(url);
        const body =
          url === parent ? { links: [{ rel: 'fields', uri: discovered }] } : { values: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await deere.fields.list('org/1');

    assert.deepStrictEqual(calls, [parent, discovered]);
  });
});
