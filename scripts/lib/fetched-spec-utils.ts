import * as yaml from 'yaml';
import { redactSpecContent } from './spec-redactor.js';
import { isRecord } from './spec-utils.js';

/**
 * Portal path overrides for slugs John Deere has renamed upstream.
 *
 * A slug doubles as this repo's internal spec name: it names the raw file, the
 * fixed spec, the generated `*Api` class, and the public `SpecName` literal a
 * consumer passes to `client.get(...)`. Renaming it to track the portal would
 * be a breaking change to that public union, so the internal name is pinned
 * and only the fetch URL follows upstream.
 *
 * `field-operations-api` began returning 404 between the 2026-08-11 and
 * 2026-08-12 API health runs. `field-operations` serves the same API: same
 * document ids (27, 28), same `info.title`, same five operations.
 */
const PORTAL_SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  'field-operations-api': 'field-operations',
};

/**
 * Map an internal spec name to the path segment the developer portal serves it
 * under. Identity for every slug the portal has not renamed.
 */
export function resolvePortalSlug(slug: string): string {
  return PORTAL_SLUG_OVERRIDES[slug] ?? slug;
}

export interface ValidatedFetchedDoc {
  slug: string;
  id: number;
  name: string;
  endPointName: string;
  ymlContent: string;
}

function isOpenApiDocument(content: string): boolean {
  try {
    const document = yaml.parseDocument(content);
    if (document.errors.length > 0) {
      return false;
    }

    const parsed = document.toJSON();
    return (
      isRecord(parsed) &&
      typeof parsed.openapi === 'string' &&
      parsed.openapi.startsWith('3.') &&
      isRecord(parsed.info) &&
      isRecord(parsed.paths)
    );
  } catch {
    return false;
  }
}

export function normalizeSpecContent(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Validate EVERY document the portal returns for a slug (7 of 28 slugs return
 * more than one). Throws if `slug` is not in `allowedSlugs` (an unexpected
 * slug is a programmer/config error, not a data problem). Otherwise the
 * response body must be a non-empty array, and every element must yield an
 * `id: number`, `name: string`, non-empty `end_point_name: string`, and a
 * `yml_content: string` that parses as an OpenAPI document. Each element's
 * content is redacted before being returned. ANY invalid element fails the
 * whole slug (returns null, so the caller keeps the stale committed file).
 */
export function validateFetchedSpecDocs(
  slug: string,
  responseBody: unknown,
  allowedSlugs: ReadonlySet<string>
): ValidatedFetchedDoc[] | null {
  if (!allowedSlugs.has(slug)) {
    throw new Error(`Unexpected API slug: ${slug}`);
  }

  if (!Array.isArray(responseBody) || responseBody.length === 0) {
    return null;
  }

  const docs: ValidatedFetchedDoc[] = [];
  for (const element of responseBody) {
    if (!isRecord(element)) {
      return null;
    }

    const { id, name, end_point_name, yml_content } = element;
    if (
      typeof id !== 'number' ||
      typeof name !== 'string' ||
      typeof end_point_name !== 'string' ||
      end_point_name.length === 0 ||
      typeof yml_content !== 'string'
    ) {
      return null;
    }

    const ymlContent = normalizeSpecContent(yml_content);
    if (ymlContent.trim().length === 0 || !isOpenApiDocument(ymlContent)) {
      return null;
    }

    docs.push({
      slug,
      id,
      name,
      endPointName: end_point_name,
      ymlContent: redactSpecContent(ymlContent),
    });
  }

  return docs;
}
