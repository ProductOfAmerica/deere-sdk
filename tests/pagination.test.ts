import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereClient } from '../src/client.js';
import { mockPaginatedResponse } from './helpers/mock-fetch.js';

describe('pagination', () => {
  describe('paginate()', () => {
    it('yields pages from paginated response', async () => {
      const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]];

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockPaginatedResponse(pages),
      });

      const receivedPages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>('/items')) {
        receivedPages.push(page);
      }

      assert.strictEqual(receivedPages.length, 3);
      assert.deepStrictEqual(receivedPages[0], [{ id: 1 }, { id: 2 }]);
      assert.deepStrictEqual(receivedPages[1], [{ id: 3 }, { id: 4 }]);
      assert.deepStrictEqual(receivedPages[2], [{ id: 5 }]);
    });

    it('stops when no nextPage link', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(
            JSON.stringify({
              values: [{ id: 1 }],
              links: [{ rel: 'self', uri: '/items' }], // No nextPage
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>('/items')) {
        pages.push(page);
      }

      assert.strictEqual(pages.length, 1);
    });

    it('handles empty values array', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(
            JSON.stringify({
              values: [],
              links: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>('/items')) {
        pages.push(page);
      }

      assert.strictEqual(pages.length, 0);
    });

    it('follows nextPage links correctly', async () => {
      const fetchedUrls: string[] = [];
      let callCount = 0;

      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (input) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchedUrls.push(url);
          callCount++;

          if (callCount === 1) {
            return new Response(
              JSON.stringify({
                values: [{ id: 1 }],
                links: [{ rel: 'nextPage', uri: 'https://api.deere.com/page/2' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({
              values: [{ id: 2 }],
              links: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        },
      });

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>('/items')) {
        pages.push(page);
      }

      assert.strictEqual(fetchedUrls.length, 2);
      assert.strictEqual(fetchedUrls[0], 'https://sandboxapi.deere.com/platform/items');
      assert.strictEqual(fetchedUrls[1], 'https://api.deere.com/page/2');
    });

    it('handles response without links array', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(
            JSON.stringify({
              values: [{ id: 1 }],
              // No links property at all
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>('/items')) {
        pages.push(page);
      }

      assert.strictEqual(pages.length, 1);
      assert.deepStrictEqual(pages[0], [{ id: 1 }]);
    });
  });

  describe('getAll()', () => {
    it('collects all items from all pages', async () => {
      const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]];

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockPaginatedResponse(pages),
      });

      const allItems = await client.getAll<{ id: number }>('/items');

      assert.strictEqual(allItems.length, 5);
      assert.deepStrictEqual(allItems, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    });

    it('returns empty array for empty response', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(JSON.stringify({ values: [], links: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      });

      const allItems = await client.getAll<{ id: number }>('/items');

      assert.deepStrictEqual(allItems, []);
    });

    it('returns single page items when no pagination', async () => {
      const client = new DeereClient({
        accessToken: 'test',
        fetch: async () =>
          new Response(
            JSON.stringify({
              values: [{ id: 1 }, { id: 2 }, { id: 3 }],
              links: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      const allItems = await client.getAll<{ id: number }>('/items');

      assert.deepStrictEqual(allItems, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('handles large paginated responses', async () => {
      // Create 10 pages with 100 items each
      const pages = Array.from({ length: 10 }, (_, pageIndex) =>
        Array.from({ length: 100 }, (_, itemIndex) => ({
          id: pageIndex * 100 + itemIndex,
        }))
      );

      const client = new DeereClient({
        accessToken: 'test',
        fetch: mockPaginatedResponse(pages),
      });

      const allItems = await client.getAll<{ id: number }>('/items');

      assert.strictEqual(allItems.length, 1000);
      assert.strictEqual(allItems[0].id, 0);
      assert.strictEqual(allItems[999].id, 999);
    });
  });

  describe('pagination with retries', () => {
    it('retries failed page requests', async () => {
      let _callCount = 0;
      let page2Attempts = 0;

      const client = new DeereClient({
        accessToken: 'test',
        fetch: async (input) => {
          _callCount++;
          const url = typeof input === 'string' ? input : input.toString();

          // First page always succeeds
          if (url.includes('/items') && !url.includes('page/2')) {
            return new Response(
              JSON.stringify({
                values: [{ id: 1 }],
                links: [{ rel: 'nextPage', uri: 'https://api.deere.com/page/2' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Second page fails once then succeeds
          page2Attempts++;
          if (page2Attempts === 1) {
            return new Response(null, { status: 503 });
          }

          return new Response(
            JSON.stringify({
              values: [{ id: 2 }],
              links: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        },
        maxRetries: 3,
      });

      const allItems = await client.getAll<{ id: number }>('/items');

      assert.strictEqual(allItems.length, 2);
      assert.strictEqual(page2Attempts, 2); // Failed once, then succeeded
    });
  });
});
