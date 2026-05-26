import * as yaml from 'yaml';
import { redactSpecContent } from './spec-redactor.js';

export interface ValidatedFetchedSpec {
  slug: string;
  id: number;
  name: string;
  ymlContent: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function validateFetchedSpec(
  slug: string,
  responseBody: unknown,
  allowedSlugs: ReadonlySet<string>
): ValidatedFetchedSpec | null {
  if (!allowedSlugs.has(slug)) {
    throw new Error(`Unexpected API slug: ${slug}`);
  }

  if (!Array.isArray(responseBody) || !isRecord(responseBody[0])) {
    return null;
  }

  const rawSpec = responseBody[0];
  const { id, name, yml_content } = rawSpec;
  if (typeof id !== 'number' || typeof name !== 'string' || typeof yml_content !== 'string') {
    return null;
  }

  const ymlContent = normalizeSpecContent(yml_content);
  if (ymlContent.trim().length === 0 || !isOpenApiDocument(ymlContent)) {
    return null;
  }

  return {
    slug,
    id,
    name,
    ymlContent: redactSpecContent(ymlContent),
  };
}
