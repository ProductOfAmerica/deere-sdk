/**
 * Tests for scripts/lib/portal-catalog.ts.
 *
 * The catalog is a diagnostic that runs only on an already-failed fetch, so
 * the property that matters most is that it degrades to silence instead of
 * throwing. Every malformed-input case below asserts null, not an exception:
 * a portal redesign must cost a hint, never a build.
 *
 * The parser is pure, so none of this needs the network.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { explainSlug, parsePortalCatalog } from '../scripts/lib/portal-catalog.js';

/** Wraps route data in the shape the landing page actually ships. */
function page(routes: Record<string, string>, depth = 3): string {
  let node: unknown = { devDocRoutes: routes };
  for (let i = 0; i < depth; i++) node = { props: node };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    node
  )}</script></body></html>`;
}

const ROUTES = {
  '7adff934-dcf4-46b9-9d20-609532ea612a': '/dev-docs/field-operations',
  '51ba3f52-593e-42a2-bdb3-4d7c44bd0bf9': '/dev-docs/fields',
  '5cedab22-e2f6-4d23-b5c5-9cc8b6b86122': '/dev-docs/service-data-products',
  'ae4a1f69-1730-4303-b0f6-de8a63d31ae5': '/dev-docs/machine-alerts',
  '0dbd2e22-e517-4a12-96b8-721b0a319b83': '/dev-docs/machine-locations',
};

describe('parsePortalCatalog', () => {
  it('extracts the published slugs from a landing page', () => {
    const catalog = parsePortalCatalog(page(ROUTES));
    assert.ok(catalog);
    assert.strictEqual(catalog.slugs.size, 5);
    assert.ok(catalog.slugs.has('field-operations'));
  });

  it('finds devDocRoutes at any depth, so a Next.js reshuffle does not break it', () => {
    const shallow = parsePortalCatalog(page(ROUTES, 0));
    const deep = parsePortalCatalog(page(ROUTES, 12));
    assert.strictEqual(shallow?.slugs.size, 5);
    assert.strictEqual(deep?.slugs.size, 5);
  });

  it('ignores routes outside /dev-docs/', () => {
    const catalog = parsePortalCatalog(
      page({ ...ROUTES, 'a-b-c': '/some-other-place/thing', 'd-e-f': '/dev-docs/' })
    );
    assert.strictEqual(catalog?.slugs.size, 5);
  });

  it('returns null when the data island is absent', () => {
    assert.strictEqual(parsePortalCatalog('<html><body>no island here</body></html>'), null);
  });

  it('returns null when the island is not JSON', () => {
    assert.strictEqual(parsePortalCatalog('<script id="__NEXT_DATA__">{not json</script>'), null);
  });

  it('returns null when the page carries no devDocRoutes', () => {
    assert.strictEqual(
      parsePortalCatalog('<script id="__NEXT_DATA__">{"props":{"other":1}}</script>'),
      null
    );
  });

  it('returns null rather than an empty catalog when every route is unusable', () => {
    assert.strictEqual(parsePortalCatalog(page({ 'a-b': '/elsewhere/x' })), null);
  });
});

describe('explainSlug', () => {
  const catalog = parsePortalCatalog(page(ROUTES));

  it('names the rename candidate when a slug gained or lost a suffix', () => {
    assert.ok(catalog);
    const lines = explainSlug(catalog, 'field-operations-api');
    assert.match(lines[0], /not in the portal catalog/);
    assert.ok(
      lines.some((l) => /similarly named published slugs: field-operations/.test(l)),
      `expected a field-operations suggestion, got: ${JSON.stringify(lines)}`
    );
  });

  it('does not claim a rename when the slug is still published', () => {
    assert.ok(catalog);
    const lines = explainSlug(catalog, 'fields');
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /still publishes/);
    assert.match(lines[0], /not a rename/);
    assert.doesNotMatch(
      lines[0],
      /similarly named/,
      'a published slug needs no rename candidates; offering them would send the reader hunting'
    );
  });

  it('falls back to the naming family when nothing contains the slug', () => {
    assert.ok(catalog);
    const lines = explainSlug(catalog, 'machine-engine-hours');
    assert.ok(
      lines.some((l) => /machine-alerts/.test(l) && /machine-locations/.test(l)),
      `expected the machine-* family, got: ${JSON.stringify(lines)}`
    );
  });

  it('offers no candidates when the slug resembles nothing published', () => {
    assert.ok(catalog);
    const lines = explainSlug(catalog, 'zzz');
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /not in the portal catalog/);
  });
});
