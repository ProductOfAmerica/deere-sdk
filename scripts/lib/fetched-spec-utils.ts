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

/**
 * The declared OpenAPI version, from whichever key carries it.
 *
 * John Deere ships at least one document (notifications) whose version key is
 * misnamed `swagger` while the body is plain OpenAPI 3: `components` rather
 * than `definitions`, parameters carrying `schema`, no `host`/`basePath`.
 * scripts/fix-specs.ts has rewritten that key to `openapi` since long before
 * this validator existed, with a comment naming that very file.
 *
 * Reading only `openapi` here therefore rejected a document the pipeline was
 * already built to accept, and silently undid an accommodation still sitting
 * one stage downstream. notifications stopped being refreshed the day after
 * this check landed (#21, 2026-05-22) and nobody noticed for three months.
 *
 * The version VALUE is still authoritative. `swagger: "2.0"` is a real Swagger
 * 2.0 document and stays rejected: the downstream pipeline assumes v3 shape,
 * and fix-specs' rewrite does not inspect the value, so this is the only place
 * that can refuse one.
 */
function declaredVersion(parsed: Record<string, unknown>): string | null {
  if (typeof parsed.openapi === 'string') return parsed.openapi;
  if (typeof parsed.swagger === 'string') return parsed.swagger;
  return null;
}

function isOpenApiDocument(content: string): boolean {
  try {
    const document = yaml.parseDocument(content);
    if (document.errors.length > 0) {
      return false;
    }

    const parsed = document.toJSON();
    if (!isRecord(parsed)) {
      return false;
    }
    const version = declaredVersion(parsed);
    if (version === null || !version.startsWith('3.')) {
      return false;
    }
    return isRecord(parsed.info) && isRecord(parsed.paths);
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
