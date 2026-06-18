/**
 * Utility functions for fixing broken OpenAPI specs.
 * Extracted for testability.
 */

/**
 * Checks if a property key is entirely an HTML documentation marker.
 * e.g., "<b>Location</b>" or "<span>Section</span>"
 */
export function isDocumentationKey(key: string): boolean {
  return /^<.*>$/.test(key);
}

interface StripDocumentationMarkupOptions {
  dropTagContent?: readonly string[];
  replaceTags?: Readonly<Record<string, string>>;
}

function readTagName(rawTag: string): { closing: boolean; name: string } | null {
  let index = 0;
  while (index < rawTag.length && /\s/.test(rawTag[index])) {
    index += 1;
  }

  const closing = rawTag[index] === '/';
  if (closing) {
    index += 1;
  }

  while (index < rawTag.length && /\s/.test(rawTag[index])) {
    index += 1;
  }

  const start = index;
  while (index < rawTag.length && /[a-zA-Z0-9:-]/.test(rawTag[index])) {
    index += 1;
  }

  if (index === start) {
    return null;
  }

  return { closing, name: rawTag.slice(start, index).toLowerCase() };
}

function findClosingTag(input: string, tagName: string, fromIndex: number): number {
  let index = fromIndex;
  while (index < input.length) {
    const tagStart = input.indexOf('<', index);
    if (tagStart === -1) {
      return input.length;
    }

    const tagEnd = input.indexOf('>', tagStart + 1);
    if (tagEnd === -1) {
      return input.length;
    }

    const parsed = readTagName(input.slice(tagStart + 1, tagEnd));
    if (parsed?.closing && parsed.name === tagName) {
      return tagEnd + 1;
    }

    index = tagEnd + 1;
  }

  return input.length;
}

export function stripDocumentationMarkup(
  input: string,
  options: StripDocumentationMarkupOptions = {}
): string {
  const dropTagContent = new Set(options.dropTagContent?.map((tag) => tag.toLowerCase()) ?? []);
  const replaceTags = options.replaceTags ?? {};
  let output = '';

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '<') {
      output += char;
      continue;
    }

    const tagEnd = input.indexOf('>', index + 1);
    if (tagEnd === -1) {
      continue;
    }

    const parsed = readTagName(input.slice(index + 1, tagEnd));
    if (!parsed) {
      index = tagEnd;
      continue;
    }

    const replacement = replaceTags[parsed.name];
    if (replacement !== undefined) {
      output += replacement;
    }

    if (!parsed.closing && dropTagContent.has(parsed.name)) {
      index = findClosingTag(input, parsed.name, tagEnd + 1) - 1;
      continue;
    }

    index = tagEnd;
  }

  return output;
}

/**
 * Strips HTML elements from property keys.
 * e.g., "createdTime<sup><a href='#foo'>2</a></sup>" -> "createdTime"
 * e.g., "referenceId<sup>DEPRECATED</sup>" -> "referenceId"
 */
export function sanitizePropertyKey(key: string): string {
  return stripDocumentationMarkup(key, { dropTagContent: ['sup'] });
}

/**
 * Remove `discriminator: { propertyName: '@type' }` from every schema in
 * `components.schemas` that declares it. Returns the number removed.
 *
 * John Deere base schemas (`resource`, `resource-embed`, `resourcewithoutLinks`,
 * `organization-embed`) carry a `@type` discriminator. openapi-typescript turns
 * that into a literal `"@type": "<childSchemaName>"` injected into every child
 * that `allOf`-extends the base — which then conflicts with the child's own
 * `@type` enum (`"Equipment" | "Machine" | ...`). The intersection
 * `"equipment" & ("Equipment" | ...)` reduces to `never`, collapsing the whole
 * generated schema. The faithful type is the enum, so we drop the discriminator
 * (the enum property stays). Keyed on `propertyName === '@type'` so a future
 * legitimately-discriminated union on some other property is untouched.
 */
export function stripTypeDiscriminators(spec: Record<string, unknown>): number {
  const components = spec.components as Record<string, unknown> | undefined;
  const schemas = components?.schemas as Record<string, unknown> | undefined;
  if (!schemas || typeof schemas !== 'object') return 0;

  let removed = 0;
  for (const value of Object.values(schemas)) {
    if (!value || typeof value !== 'object') continue;
    const schema = value as Record<string, unknown>;
    const discriminator = schema.discriminator as { propertyName?: unknown } | undefined;
    if (
      discriminator &&
      typeof discriminator === 'object' &&
      discriminator.propertyName === '@type'
    ) {
      delete schema.discriminator;
      removed += 1;
    }
  }
  return removed;
}
