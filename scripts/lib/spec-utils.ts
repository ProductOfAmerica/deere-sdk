/**
 * Utility functions for fixing broken OpenAPI specs.
 * Extracted for testability.
 */

/**
 * True when `value` is a non-null, plain object (a JSON record), excluding
 * `null` (which is `typeof 'object'`) and arrays. Narrows to
 * `Record<string, unknown>` so callers can index keys safely. This is the one
 * structural guard shared across the spec pipeline's tree walks: the
 * multi-doc merge, the canonicalizer, fetch-time validation, and the
 * api-surface loader all classified objects identically, so they share this
 * definition rather than each keeping a private copy.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Last path segment of a JSON `$ref`.
 * e.g. "#/components/schemas/Foo" -> "Foo"
 */
export function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

export function toPascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

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
 * that `allOf`-extends the base, which then conflicts with the child's own
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

/**
 * The two equipment list responses whose `values.items.$ref` John Deere's
 * 2026-07 doc edit dropped, paired with the item schema each historically
 * referenced. `GetEquipment` feeds `EquipmentApi.get` on `GET /equipment`;
 * `GetEquipmentById` feeds `EquipmentApi.getEquipment` on `GET /equipment/{id}`.
 */
const EQUIPMENT_LIST_ITEM_REFS: ReadonlyArray<{ response: string; schema: string }> = [
  { response: 'GetEquipment', schema: 'equipmentForList' },
  { response: 'GetEquipmentById', schema: 'equipment' },
];

/**
 * Restore the `values.items.$ref` envelope on the two equipment list responses
 * that John Deere's 2026-07 equipment-doc edit dropped. Returns the count
 * restored.
 *
 * That edit rewrote `values: { items: { $ref: <schema> } }` down to a bare
 * `values: { type: "array" }` on the 200 responses `GetEquipment` (item schema
 * `equipmentForList`) and `GetEquipmentById` (item schema `equipment`), while
 * leaving both target schemas defined in `components.schemas`. Without the ref
 * the generator cannot recover the item type, so `EquipmentApi.get` collapses
 * to `PaginatedResponse<unknown>` and `EquipmentApi.getEquipment` to `unknown`.
 * The wire contract did not change; only JD's doc quality did (their equipment
 * spec has prior form here: see stripTypeDiscriminators above).
 *
 * Guarded and self-neutralizing. For each registered response the ref is
 * restored ONLY while (a) the envelope carries no `items.$ref` AND (b) the
 * historically-correct target schema still exists. When JD repairs the doc the
 * ref is already present and this no-ops; if JD ever removes the target schema
 * the transform does not resurrect a ref to a nonexistent schema (the types
 * then legitimately weaken and a human revisits). It is keyed on the two
 * response names, so no other envelope is touched. The response's media type is
 * resolved the same way generate-sdk's extractSchemaFromContent resolves it, so
 * the restored ref lands on exactly the schema the generator reads.
 */
export function restoreEquipmentItemRefs(spec: Record<string, unknown>): number {
  const components = spec.components as Record<string, unknown> | undefined;
  const responses = components?.responses as Record<string, unknown> | undefined;
  const schemas = components?.schemas as Record<string, unknown> | undefined;
  if (!responses || !schemas) return 0;

  let restored = 0;
  for (const { response, schema } of EQUIPMENT_LIST_ITEM_REFS) {
    // Guard (b): never resurrect a ref to a schema JD has removed.
    if (!(schema in schemas)) continue;

    const responseObj = responses[response] as { content?: Record<string, unknown> } | undefined;
    const content = responseObj?.content;
    if (!content) continue;

    // Mirror generate-sdk's media-type preference so the ref lands where the
    // generator looks for it.
    const media = (content['application/vnd.deere.axiom.v3+json'] ?? content['application/json']) as
      | { schema?: { properties?: Record<string, unknown> } }
      | undefined;
    const values = media?.schema?.properties?.values as { items?: { $ref?: unknown } } | undefined;
    if (!values) continue;

    // Guard (a): no-op when a ref is already present (JD repaired the doc).
    if (typeof values.items?.$ref === 'string' && values.items.$ref.length > 0) continue;

    values.items = { $ref: `#/components/schemas/${schema}` };
    restored += 1;
  }
  return restored;
}

/** One place where John Deere published documentation text as an enum value. */
export interface ProseEnumFix {
  /** Spec the entry applies to. The same location in another spec is never touched. */
  spec: string;
  /** Keys from the spec root to the schema object that owns the `enum`. */
  at: readonly string[];
  /** The exact string John Deere published in the enum. */
  prose: string;
  /** The value the prose stands for, or `null` when the enum constrains nothing. */
  replacement: string | null;
  /** What was observed, and where, so the claim can be re-checked. */
  evidence: string;
}

/**
 * Enum values that are documentation, not values. openapi-typescript turns an
 * enum into a union of string literals, so each of these made a parameter or
 * property accept only the documentation sentence.
 *
 * Every entry is a claim about John Deere's document, keyed by exact spec,
 * location and string. Real enum values that happen to contain spaces (the
 * equipment market segments, such as "Engines & Components") are not listed
 * and are never touched: there is deliberately no rule that guesses from the
 * shape of a value.
 */
export const PROSE_ENUM_FIXES: readonly ProseEnumFix[] = [
  {
    spec: 'equipment',
    at: ['components', 'parameters', 'EquipmentModelName', 'schema'],
    prose: 'string or partial string with * wildcard search',
    replacement: null,
    evidence:
      'specs/raw/equipment.yaml, 2026-11-12: the enum holds this one sentence, while the ' +
      'examples on the same parameter are "9RX420" and "9RX*".',
  },
  {
    spec: 'products',
    at: ['components', 'schemas', 'ReferenceProductOverrideStatus_Chemicals', 'properties', 'key'],
    prose: 'registration (chemicals and fertilizers only)',
    replacement: 'registration',
    evidence:
      'specs/raw/products.yaml, 2026-11-12: this response reports the status of each override ' +
      'key sent in the request. The request schema lists the key as "registration" and every ' +
      'request example sends "registration".',
  },
  {
    spec: 'products',
    at: [
      'components',
      'schemas',
      'ReferenceProductOverrideStatus_Fertilizers',
      'properties',
      'key',
    ],
    prose: 'registration (chemicals and fertilizers only)',
    replacement: 'registration',
    evidence: 'Same defect and evidence as the chemicals status schema above.',
  },
];

/**
 * Apply `fixes` to one spec. Returns the number of enums changed.
 *
 * Each entry is a claim about one enum, and what happens depends on whether
 * the claim still holds:
 *
 * - The prose is there as registered: the enum is dropped (the schema's `type`
 *   still constrains the value), or the member is replaced.
 * - The location or the enum is gone, or the real value now stands where the
 *   prose was: John Deere repaired or removed it. The entry is skipped, so a
 *   repair never stops the sync.
 * - The enum is there but holds something else in the prose's place:
 *   documentation would reach the generated types again, and skipping would
 *   hide that. This throws, so the entry is re-read before anything is
 *   committed. Two shapes are recognized, because nothing here guesses whether
 *   a string is prose. For a dropped enum: the sentence beside other values, or
 *   a different lone value. For a replaced member: a value that begins with the
 *   real one and carries more text, which a real value such as
 *   "registrationNumber" would also match. Any other rewording is skipped like
 *   a repair.
 */
export function fixProseEnums(
  spec: Record<string, unknown>,
  specName: string,
  fixes: readonly ProseEnumFix[] = PROSE_ENUM_FIXES
): number {
  let fixed = 0;
  for (const fix of fixes) {
    if (fix.spec !== specName) continue;

    let node: unknown = spec;
    for (const key of fix.at) {
      node = isRecord(node) ? node[key] : undefined;
    }
    if (!isRecord(node) || !Array.isArray(node.enum)) continue;

    const values: unknown[] = node.enum;
    const mismatch = (found: string) =>
      new Error(
        `fixProseEnums: ${specName} ${fix.at.join('/')} ${found}: ${JSON.stringify(values)}. ` +
          `Its PROSE_ENUM_FIXES entry registered "${fix.prose}". Re-read the document, then ` +
          `update the entry or delete it.`
      );

    if (fix.replacement === null) {
      // The claim: this enum is that one sentence and nothing else.
      if (values.length === 1 && values[0] === fix.prose) {
        delete node.enum;
        fixed += 1;
      } else if (values.includes(fix.prose)) {
        throw mismatch('still lists the sentence but now has other values too');
      } else if (values.length === 1) {
        throw mismatch('now holds a different lone value, which reads like the sentence reworded');
      }
      continue;
    }

    // The claim: one member is the real value with a note attached.
    const replacement = fix.replacement;
    if (values.includes(fix.prose)) {
      const replaced = values.map((value) => (value === fix.prose ? replacement : value));
      node.enum = replaced.filter((value, index) => replaced.indexOf(value) === index);
      fixed += 1;
    } else if (
      values.some(
        (value) =>
          typeof value === 'string' && value !== replacement && value.startsWith(replacement)
      )
    ) {
      throw mismatch(`no longer has the registered text but has "${replacement}" with other words`);
    }
  }
  return fixed;
}
