/**
 * Pure helpers for scripts/generate-sdk.ts.
 *
 * Extracted into a side-effect-free module so they can be unit-tested without
 * importing the generator entrypoint, which runs `main()` (and writes files)
 * on import. See tests/generate-sdk.test.ts.
 */

import { refName } from './spec-utils.js';

/** Minimal structural shape of an OpenAPI schema, enough for wrapper detection. */
export interface SchemaLike {
  $ref?: string;
  items?: SchemaLike;
  properties?: Record<string, SchemaLike>;
  allOf?: SchemaLike[];
}

/** What a schema is, for collection-unwrap purposes. */
interface CollectionShape {
  /** True if a `values` array property was found (directly or through allOf). */
  isWrapper: boolean;
  /** The item schema name, if `values.items` carried a resolvable `$ref`. */
  itemRef?: string;
}

/**
 * Walk a schema (and any `allOf` members, including `$ref`'d bases like
 * `CollectionBase`) for a `values` property. Reports whether the schema is a
 * collection wrapper and, if so, the item schema name when `values.items`
 * carries a `$ref`. Cycle-guarded via `seen`.
 */
function findCollectionShape(
  schema: SchemaLike | undefined,
  schemas: Record<string, SchemaLike>,
  seen: Set<string>
): CollectionShape {
  if (!schema || typeof schema !== 'object') return { isWrapper: false };

  const values = schema.properties?.values;
  if (values) {
    const ref = values.items?.$ref;
    return { isWrapper: true, itemRef: ref?.includes('/schemas/') ? refName(ref) : undefined };
  }

  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      if (member?.$ref) {
        const name = refName(member.$ref);
        if (!seen.has(name)) {
          seen.add(name);
          const shape = findCollectionShape(schemas[name], schemas, seen);
          if (shape.isWrapper) return shape;
        }
      } else {
        const shape = findCollectionShape(member, schemas, seen);
        if (shape.isWrapper) return shape;
      }
    }
  }

  return { isWrapper: false };
}

/**
 * If `schemaName` names a collection wrapper (a schema with a `values` array
 * whose items have a `$ref`, directly or through `allOf` / a referenced base
 * like `CollectionBase`), return the item schema name. Otherwise undefined.
 *
 * John Deere models most list responses as a direct `$ref` to a named wrapper
 * (e.g. `VarietyCollection = { values: Variety[] }`). The generated SDK needs
 * the ITEM type (`Variety`) for `PaginatedResponse<T>` / `getAll<T>`, not the
 * wrapper. Callers gate this on collection context so single-resource endpoints
 * that happen to return a values-shaped wrapper (e.g. `GET /partnerships/{token}`)
 * are left alone.
 */
export function unwrapCollectionItemRef(
  schemaName: string,
  schemas: Record<string, SchemaLike> | undefined
): string | undefined {
  if (!schemas) return undefined;
  return findCollectionShape(schemas[schemaName], schemas, new Set([schemaName])).itemRef;
}

/**
 * Resolve the schema name a response/request content `schema` refers to, with
 * collection-wrapper unwrapping. Two branches, kept deliberately distinct:
 *
 * 1. Direct `$ref` to a named schema: that name, EXCEPT when `isCollection` and
 *    the named schema is a collection wrapper. A wrapper with a resolvable item
 *    `$ref` unwraps to the item; a values-shaped wrapper whose item `$ref` is
 *    NOT resolvable (inline items, or no items) returns undefined so the caller
 *    degrades to `PaginatedResponse<unknown>` instead of double-nesting the
 *    envelope. The collection gate keeps single-resource endpoints whose `$ref`
 *    is a values-shaped wrapper (e.g. `GET /partnerships/{token}`) untouched.
 * 2. Inline `values.items.$ref`: the item name, UNCONDITIONALLY (single-resource
 *    endpoints like `GET /equipment/{id}` rely on this; it must NOT be gated on
 *    `isCollection`).
 *
 * Returns undefined when the schema names nothing in `components/schemas`.
 */
export function resolveContentSchemaRef(
  schema: SchemaLike | undefined,
  schemas: Record<string, SchemaLike> | undefined,
  isCollection: boolean
): string | undefined {
  if (!schema) return undefined;

  if (schema.$ref?.includes('/schemas/')) {
    const name = refName(schema.$ref);
    if (isCollection && schemas) {
      const shape = findCollectionShape(schemas[name], schemas, new Set([name]));
      if (shape.itemRef) return shape.itemRef;
      if (shape.isWrapper) return undefined;
    }
    return name;
  }

  const inlineItem = schema.properties?.values?.items?.$ref;
  if (inlineItem?.includes('/schemas/')) return refName(inlineItem);

  return undefined;
}

/** Operation fields needed to decide a generated method's return type. */
export interface ReturnTypeOp {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  isCollection: boolean;
  responseSchemaRef?: string;
}

/**
 * The element type for a collection GET: the resolved item schema, or `unknown`
 * when no item schema could be resolved. Shared by `computeReturnType` (for the
 * `PaginatedResponse<T>` of the single-page method) and the `listAll` generator
 * (`T[]` / `getAll<T>`), so the two cannot drift.
 */
export function collectionItemType(op: ReturnTypeOp): string {
  return op.responseSchemaRef ? `components['schemas']['${op.responseSchemaRef}']` : 'unknown';
}

/**
 * The inner type of a generated method's `Promise<...>` return.
 *
 * A collection GET with no resolvable item schema degrades to
 * `PaginatedResponse<unknown>` (the pagination envelope survives) rather than a
 * bare `unknown`, so an upstream-dropped item `$ref` cannot silently erase the
 * envelope type for consumers.
 */
export function computeReturnType(op: ReturnTypeOp): string {
  if (op.method === 'delete') return 'void';
  if (op.isCollection && op.method === 'get') return `PaginatedResponse<${collectionItemType(op)}>`;
  if (op.responseSchemaRef) return `components['schemas']['${op.responseSchemaRef}']`;
  if (op.method === 'post' || op.method === 'put' || op.method === 'patch') return 'void';
  return 'unknown';
}

/**
 * Whether a GET addresses a collection (paginated list) rather than one item.
 *
 * A last segment that is a `{param}` is item access. So is a literal last
 * segment that the operation itself declares as an `in: path` parameter: Deere
 * models aliases such as `GET /users/@currentUser` that way (a literal stand-in
 * for `{username}`), and treating them as collections would type a single
 * resource as `PaginatedResponse` and name its method `list...`.
 */
export function isCollectionEndpoint(
  path: string,
  method: string,
  declaredPathParamNames: readonly string[] = []
): boolean {
  if (method !== 'get') return false;
  const lastSegment = path.split('/').pop() || '';
  if (lastSegment.startsWith('{')) return false;
  return !declaredPathParamNames.includes(lastSegment);
}

/**
 * Word-wrap `text` into JSDoc lines. The first line starts with `prefix`;
 * continuation lines start with `   * `.
 */
export function wrapJsDocText(text: string, prefix: string, maxWidth = 80): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let currentLine = prefix;

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxWidth && currentLine !== prefix) {
      lines.push(currentLine);
      currentLine = `   * ${word}`;
    } else {
      currentLine += (currentLine === prefix ? '' : ' ') + word;
    }
  }

  if (currentLine !== prefix) {
    lines.push(currentLine);
  }

  return lines;
}

/** Operation fields a generated method's JSDoc is built from. */
export interface JsDocOp {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  /** OpenAPI `deprecated: true`. */
  deprecated?: boolean;
  /** Why, and what to use instead; falls back to a generic note. */
  deprecationNote?: string;
}

/** Note used when an operation is deprecated without saying why. */
export const DEFAULT_DEPRECATION_NOTE = 'John Deere marks this operation deprecated.';

/** The `@deprecated` lines for an operation, or none when it is not deprecated. */
export function deprecatedJsDocLines(op: JsDocOp): string[] {
  if (!op.deprecated) return [];
  return wrapJsDocText(op.deprecationNote || DEFAULT_DEPRECATION_NOTE, '   * @deprecated ');
}

/** The full JSDoc block (opening and closing lines included) for a generated method. */
export function buildMethodJsDoc(op: JsDocOp): string[] {
  const jsdoc: string[] = ['  /**'];
  if (op.summary) {
    jsdoc.push(`   * ${op.summary}`);
  }
  if (op.description && op.description !== op.summary) {
    jsdoc.push(...wrapJsDocText(op.description, '   * @description '));
  }
  jsdoc.push(...deprecatedJsDocLines(op));
  jsdoc.push(`   * @generated from ${op.method.toUpperCase()} ${op.path}`);
  jsdoc.push('   */');
  return jsdoc;
}

/**
 * Whether any operation needs the `PaginatedResponse` import. True for every
 * collection GET, including the `PaginatedResponse<unknown>` fallback above,
 * which would otherwise reference an unimported type and fail to compile.
 */
export function usesPaginatedResponse(ops: ReturnTypeOp[]): boolean {
  return ops.some((op) => op.isCollection && op.method === 'get');
}
