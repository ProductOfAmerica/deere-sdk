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
 * Whether any operation needs the `PaginatedResponse` import. True for every
 * collection GET, including the `PaginatedResponse<unknown>` fallback above,
 * which would otherwise reference an unimported type and fail to compile.
 */
export function usesPaginatedResponse(ops: ReturnTypeOp[]): boolean {
  return ops.some((op) => op.isCollection && op.method === 'get');
}
