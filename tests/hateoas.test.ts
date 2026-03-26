import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeereClient, type HateoasError } from '../src/client.js';

function mockFetchWithSpy() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = new Map<string, unknown>();

  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const data = responses.get(url);
    if (!data) {
      return new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/vnd.deere.axiom.v3+json' },
    });
  };

  return { fetch: fetchFn as unknown as typeof fetch, calls, responses };
}

const BASE = 'https://sandboxapi.deere.com/platform';

describe('HATEOAS mode', () => {
  describe('hateoas: false (default)', () => {
    it('makes no extra requests — direct paths only', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      responses.set(`${BASE}/organizations/123/fields`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        maxRetries: 0,
      });

      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${BASE}/organizations/123/fields`);
    });
  });

  describe('hateoas: true', () => {
    it('uses direct URL for root collections (no map entry)', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      responses.set(`${BASE}/organizations`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${BASE}/organizations`);
    });

    it('uses direct URL for item paths (no map entry)', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      responses.set(`${BASE}/organizations/123`, { id: '123' });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations/123');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${BASE}/organizations/123`);
    });

    it('fetches parent and follows link for nested collections (cold cache)', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      const discoveredFieldsUrl = `${BASE}/organizations/123/fields`;

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [
          { rel: 'self', uri: `${BASE}/organizations/123` },
          { rel: 'fields', uri: discoveredFieldsUrl },
          { rel: 'farms', uri: `${BASE}/organizations/123/farms` },
        ],
      });
      responses.set(discoveredFieldsUrl, { values: [{ id: 'f1' }] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      const result = await client.get('/organizations/123/fields');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, `${BASE}/organizations/123`); // parent fetch
      assert.equal(calls[1].url, discoveredFieldsUrl); // discovered URL
      assert.deepEqual(result, { values: [{ id: 'f1' }] });
    });

    it('skips parent fetch on warm cache', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 2); // parent + actual

      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 3); // only the actual request (cache hit)
    });

    it('resolves deep nesting by fetching immediate parent', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123/fields/456`, {
        id: '456',
        links: [{ rel: 'boundaries', uri: `${BASE}/organizations/123/fields/456/boundaries` }],
      });
      responses.set(`${BASE}/organizations/123/fields/456/boundaries`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations/123/fields/456/boundaries');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, `${BASE}/organizations/123/fields/456`);
      assert.equal(calls[1].url, `${BASE}/organizations/123/fields/456/boundaries`);
    });

    it('throws HateoasError when parent has no matching rel', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'self', uri: `${BASE}/organizations/123` }],
      });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/organizations/123/fields'),
        (err: HateoasError) => {
          assert.equal(err.name, 'HateoasError');
          assert.ok(err.message.includes('no link with rel "fields"'));
          assert.equal(err.path, '/organizations/123/fields');
          return true;
        }
      );
    });

    it('preserves query params through resolution', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      const discoveredUrl = `${BASE}/organizations/123/fields`;

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: discoveredUrl }],
      });
      responses.set(`${discoveredUrl}?embed=boundaries&recordFilter=AVAILABLE`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations/123/fields?embed=boundaries&recordFilter=AVAILABLE');
      assert.equal(calls[1].url, `${discoveredUrl}?embed=boundaries&recordFilter=AVAILABLE`);
    });

    it('resolves POST requests the same way as GET', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, {});

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.post('/organizations/123/fields', { name: 'Test' });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, `${BASE}/organizations/123`);
      assert.equal(calls[1].url, `${BASE}/organizations/123/fields`);
      assert.equal(calls[1].init?.method, 'POST');
    });

    it('resolves first page of getAll() via HATEOAS, follows nextPage links natively', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, {
        values: [{ id: '1' }],
        links: [{ rel: 'nextPage', uri: `${BASE}/organizations/123/fields?page=2` }],
      });
      responses.set(`${BASE}/organizations/123/fields?page=2`, {
        values: [{ id: '2' }],
      });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      const all = await client.getAll('/organizations/123/fields');
      assert.deepEqual(all, [{ id: '1' }, { id: '2' }]);
      assert.equal(calls[0].url, `${BASE}/organizations/123`); // parent fetch
      assert.equal(calls[1].url, `${BASE}/organizations/123/fields`); // first page
      assert.equal(calls[2].url, `${BASE}/organizations/123/fields?page=2`); // nextPage
    });

    it('clearLinkCache() forces re-fetch of parent', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 2);

      client.clearLinkCache();

      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 4); // parent re-fetched
    });

    it('throws HateoasError when parent fetch fails', async () => {
      const fetchFn = async () => {
        return new Response(JSON.stringify({ message: 'Server Error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      };

      const client = new DeereClient({
        accessToken: 'test',
        fetch: fetchFn as unknown as typeof fetch,
        hateoas: true,
        maxRetries: 0,
      });

      await assert.rejects(
        () => client.get('/organizations/123/fields'),
        (err: HateoasError) => {
          assert.equal(err.name, 'HateoasError');
          assert.ok(err.message.includes('could not fetch parent'));
          return true;
        }
      );
    });

    it('logs resolution details when hateoasDebug is true', async () => {
      const { fetch: mockFetch, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, { values: [] });

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        const client = new DeereClient({
          accessToken: 'test',
          fetch: mockFetch,
          hateoas: true,
          hateoasDebug: true,
          maxRetries: 0,
        });

        await client.get('/organizations/123/fields');
        assert.ok(logs.some((l) => l.includes('[HATEOAS]')));
        assert.ok(logs.some((l) => l.includes('fields')));
      } finally {
        console.log = originalLog;
      }
    });

    it('warmLinkCache() pre-fetches parent resources', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();

      responses.set(`${BASE}/organizations/123`, {
        id: '123',
        links: [{ rel: 'fields', uri: `${BASE}/organizations/123/fields` }],
      });
      responses.set(`${BASE}/organizations/123/fields`, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.warmLinkCache(['/organizations/123']);
      assert.equal(calls.length, 1);

      // Now the actual request should NOT fetch the parent again
      await client.get('/organizations/123/fields');
      assert.equal(calls.length, 2); // only the actual request
    });

    it('bypasses HATEOAS for full URLs (e.g. from followLink)', async () => {
      const { fetch: mockFetch, calls, responses } = mockFetchWithSpy();
      const fullUrl = `${BASE}/organizations/123/fields`;
      responses.set(fullUrl, { values: [] });

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockFetch,
        hateoas: true,
        maxRetries: 0,
      });

      await client.get(fullUrl);
      assert.equal(calls.length, 1); // no parent fetch
      assert.equal(calls[0].url, fullUrl);
    });
  });
});
