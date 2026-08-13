import * as yaml from 'yaml';
import { redactSpecContent } from './spec-redactor.js';
import { isRecord } from './spec-utils.js';

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
