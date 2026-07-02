/**
 * Canonical key order for spec documents so upstream reorders produce
 * byte-identical files at the fetch boundary. The June 2026 field-operations
 * incident began with John Deere silently reordering the `paths` map inside
 * a spec document: a semantically null change that nonetheless surfaced as a
 * large, misleading diff once fetched. Sorting is limited to the top-level
 * `paths` map and every category map under `components`, because those are
 * the surfaces where upstream reorder churn actually happens.
 * Member order elsewhere (method order inside a path item, property order
 * inside a schema, parameter arrays, servers arrays, info fields) can be
 * semantically meaningful to readers, so it is left exactly as declared.
 */

import * as yaml from 'yaml';
import { isRecord } from './spec-utils.js';

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rebuild a plain object with its own keys sorted lexicographically. Values
 * are shared by reference with the input, never cloned.
 */
function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort(compareStrings)) {
    result[key] = obj[key];
  }
  return result;
}

/**
 * Sort the category names directly under `components` (schemas, parameters,
 * responses, requestBodies, headers, securitySchemes, and any future
 * category), then sort each category map's own keys. A category value that
 * is not a plain object is tolerated and passed through unchanged.
 */
function canonicalizeComponents(components: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const category of Object.keys(components).sort(compareStrings)) {
    const value = components[category];
    result[category] = isRecord(value) ? sortKeys(value) : value;
  }
  return result;
}

/**
 * Return a structurally-equal spec document where exactly two kinds of maps
 * are key-sorted lexicographically: the top-level `paths` map, and every
 * category map under `components`, with the category names themselves
 * sorted too. Everything else, method order inside a path item, property
 * order inside a schema, parameter arrays, servers arrays, info fields,
 * keeps its original document order.
 *
 * A `paths` or `components` value that is missing or not a plain object is
 * tolerated: it passes through untouched rather than throwing. A non-object
 * `doc` (including `null`/`undefined`) passes through untouched too.
 *
 * Never mutates its input. The top-level document, `paths`, `components`,
 * and each components category are rebuilt as new objects; every other
 * subtree (path items, schemas, arrays, `info`, `servers`, ...) is shared by
 * reference with the input, unchanged.
 */
export function canonicalizeSpec(doc: unknown): unknown {
  if (!isRecord(doc)) return doc;

  const result: Record<string, unknown> = { ...doc };

  if (isRecord(doc.paths)) {
    result.paths = sortKeys(doc.paths);
  }

  if (isRecord(doc.components)) {
    result.components = canonicalizeComponents(doc.components);
  }

  return result;
}

/**
 * Serialize a spec document with the same emission options fix-specs.ts
 * uses (no line wrapping, plain keys, double-quoted strings), plus
 * `aliasDuplicateObjects: false`. Without that addition, two components that
 * happen to share a JS object reference, as they will once the upcoming
 * multi-doc merge deduplicates them, would stringify as a YAML `&anchor` /
 * `*alias` pair instead of two independent blocks: a shape downstream
 * tooling (openapi-typescript, the redactor's line-anchored regexes) has
 * never seen. Returns whatever `yaml.stringify` produces, trailing newline
 * included, with no further post-processing.
 */
export function stringifySpec(doc: unknown): string {
  return yaml.stringify(doc, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
    aliasDuplicateObjects: false,
  });
}
