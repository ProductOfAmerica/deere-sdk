/**
 * Reads John Deere's published API catalog off the developer portal landing
 * page, and uses it to explain a failed fetch.
 *
 * https://developer.deere.com/dev-doc-landing embeds the whole catalog in its
 * Next.js `__NEXT_DATA__` island as `devDocRoutes`, an apiId to
 * `/dev-docs/{slug}` mapping covering every API the portal publishes. Free to
 * fetch, no browser needed.
 *
 * ---------------------------------------------------------------------------
 * This is a DIAGNOSTIC, not a resolver. Two independent reasons.
 * ---------------------------------------------------------------------------
 *
 * 1. apiId is not unique. `products` and `service-data-products` both report
 *    api_id 5cedab22-e2f6-4d23-b5c5-9cc8b6b86122, and the catalog maps that id
 *    to service-data-products. Auto-resolving `products` by api_id would
 *    overwrite specs/raw/products.yaml with a different API's contract under
 *    the same filename: right name, wrong content, no error.
 *
 * 2. The catalog is not a complete list of fetchable slugs. `products` has no
 *    /dev-docs/products route at all, yet /devDoc/apiDetails/products serves 8
 *    valid documents today. So absence from the catalog does NOT prove a slug
 *    is dead (measured 2026-08-13: 27 of our 28 slugs appear; products is the
 *    exception).
 *
 * Both are survivable because this only ever runs on a fetch that has ALREADY
 * failed. At that point "your slug is not in the catalog, but these similar
 * ones are" is a useful lead for a human, and a live-but-unlisted slug like
 * products never reaches it. Nothing here changes what gets fetched or
 * written; the worst case is a misleading hint next to a real error.
 *
 * Being an undocumented Next.js internal, this will break eventually. Every
 * failure path returns null and the caller carries on without the hint.
 */

const LANDING_URL = 'https://developer.deere.com/dev-doc-landing';
const NEXT_DATA_PATTERN = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const DEV_DOCS_PREFIX = '/dev-docs/';

/** How many rename candidates to offer. More than a few is noise, not a lead. */
const MAX_SUGGESTIONS = 5;

export interface PortalCatalog {
  /** Every slug the portal publishes a doc route for. */
  slugs: Set<string>;
  /** apiId to slug. Lossy by construction: see the header, apiId is not unique. */
  byApiId: Map<string, string>;
}

/**
 * Extract the catalog from landing-page HTML. Pure, so the parsing is testable
 * without the network.
 *
 * Returns null rather than throwing on anything unexpected: a portal redesign
 * must degrade to "no hint available", never to a failed build. The caller is
 * already reporting a real error when it asks for this.
 */
export function parsePortalCatalog(html: string): PortalCatalog | null {
  const match = NEXT_DATA_PATTERN.exec(html);
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  // devDocRoutes sits at an unstable depth inside the page props, so walk for
  // it rather than pinning a path that a Next.js upgrade would move. No cycle
  // guard: the input is always JSON.parse output, which is a tree.
  const routeMaps: Record<string, unknown>[] = [];
  (function walk(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    if (!Array.isArray(node)) {
      const routes = (node as Record<string, unknown>).devDocRoutes;
      if (routes !== null && typeof routes === 'object' && !Array.isArray(routes)) {
        routeMaps.push(routes as Record<string, unknown>);
      }
    }
    for (const value of Object.values(node)) walk(value);
  })(data);

  if (routeMaps.length === 0) return null;

  const slugs = new Set<string>();
  const byApiId = new Map<string, string>();
  for (const routes of routeMaps) {
    for (const [apiId, route] of Object.entries(routes)) {
      if (typeof route !== 'string' || !route.startsWith(DEV_DOCS_PREFIX)) continue;
      const slug = route.slice(DEV_DOCS_PREFIX.length);
      if (slug.length === 0) continue;
      slugs.add(slug);
      byApiId.set(apiId, slug);
    }
  }

  return slugs.size === 0 ? null : { slugs, byApiId };
}

/** Fetch and parse the catalog. Null on any failure; never throws. */
export async function fetchPortalCatalog(): Promise<PortalCatalog | null> {
  try {
    const response = await fetch(LANDING_URL);
    if (!response.ok) return null;
    return parsePortalCatalog(await response.text());
  } catch {
    return null;
  }
}

/**
 * Explain a failed slug against the catalog, as plain lines for the operator.
 * Empty when the catalog has nothing useful to add.
 */
export function explainSlug(catalog: PortalCatalog, slug: string, apiId: string): string[] {
  if (catalog.slugs.has(slug)) {
    return [
      `the portal still publishes "${slug}", so this is not a rename; the slug is listed ` +
        `in the catalog but did not yield usable documents`,
    ];
  }

  const lines = [
    `"${slug}" is not in the portal catalog (${catalog.slugs.size} published APIs), which ` +
      `is consistent with an upstream rename. Not proof: some live slugs are unlisted.`,
  ];

  const byId = catalog.byApiId.get(apiId);
  if (byId !== undefined && byId !== slug) {
    lines.push(
      `the recorded apiId now maps to "${byId}" in the catalog. Treat as a lead, not an ` +
        `answer: the portal reuses one apiId across unrelated APIs, so confirm the API is ` +
        `the same one before repointing the slug.`
    );
  }

  const candidates = similarSlugs(catalog.slugs, slug);
  if (candidates.length > 0) {
    lines.push(`similarly named published slugs: ${candidates.join(', ')}`);
  }
  return lines;
}

/**
 * Published slugs that look like a rename of `slug`. Containment first, since
 * that is the shape the observed rename took (field-operations-api became
 * field-operations); a shared-prefix pass only runs when containment finds
 * nothing, because on its own it matches most of a naming family.
 */
function similarSlugs(published: Set<string>, slug: string): string[] {
  const contained = [...published]
    .filter((candidate) => candidate.includes(slug) || slug.includes(candidate))
    .sort();
  if (contained.length > 0) return contained.slice(0, MAX_SUGGESTIONS);

  const head = slug.split('-')[0];
  if (head.length < 4) return [];
  return [...published]
    .filter((candidate) => candidate.split('-')[0] === head)
    .sort()
    .slice(0, MAX_SUGGESTIONS);
}
