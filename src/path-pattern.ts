/**
 * Both directions between an OpenAPI path pattern and a concrete request path.
 *
 * Filling a pattern in: `encodePathParam` turns a parameter's value into the
 * one segment it stands for. Recognising one afterwards: by the time a path
 * reaches the client it is interpolated (`/notifications/b22956b7-...`, not
 * `/notifications/{sourceEvent}`), and two features need to know which pattern
 * it came from, HATEOAS route lookup and per-path server overrides.
 *
 * The two depend on each other. Matching counts segments, so it is only right
 * when every parameter was written as exactly one.
 *
 * Pure and allocation-light: no regex compilation, no caching, no state.
 */

import { CLIENT_ERROR_STATUS, DeereError } from './errors.js';

function refuseParam(name: string, why: string): never {
  throw new DeereError(
    `Invalid value for path parameter '${name}': ${why}.`,
    CLIENT_ERROR_STATUS,
    'InvalidPathParameter'
  );
}

/**
 * A path parameter's value as one URL path segment.
 *
 * Every generated method calls this for each `{param}` it fills in. Before it
 * existed the value was written into the path as it came, so one containing
 * `/`, `?`, `#` or `..` changed which resource the request addressed: the id
 * `abc/../../organizations/999` turned a request about one notification into
 * a request about an organization.
 *
 * Whatever is not safe in a segment is percent-encoded. `@` and `:` are legal
 * there and are left alone, so a value such as `@currentUser` reaches the
 * server as it always did. A value that is already percent-encoded is encoded
 * again: the argument is the id, not a piece of URL.
 *
 * Refused, with an error naming the parameter and not the value:
 *   - anything but a string, finite number, bigint or boolean (`undefined`
 *     used to be sent as the text "undefined");
 *   - the empty string, which would drop the segment and address the parent;
 *   - `.` and `..`, which a URL parser resolves even when percent-encoded;
 *   - text that is not well-formed UTF-16, which cannot be encoded.
 */
export function encodePathParam(name: string, value: unknown): string {
  const isPrimitive =
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'bigint' ||
    typeof value === 'boolean';
  if (!isPrimitive) {
    const got = value === null ? 'null' : typeof value === 'number' ? String(value) : typeof value;
    refuseParam(name, `expected a string, a finite number, a bigint or a boolean, got ${got}`);
  }

  const text = String(value);
  if (text === '') refuseParam(name, 'it is empty');
  if (text === '.' || text === '..') {
    refuseParam(name, 'a URL reads "." and ".." as navigation, not as a name');
  }

  let encoded: string;
  try {
    encoded = encodeURIComponent(text);
  } catch {
    refuseParam(name, 'it contains an unpaired surrogate and cannot be encoded');
  }
  return encoded.replace(/%40/g, '@').replace(/%3A/g, ':');
}

/** Split a path into its non-empty segments. `/a//b/` becomes `['a', 'b']`. */
export function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * True when `concretePath` is an instance of `pattern`.
 *
 * A `{param}` segment matches any single segment; every other segment must
 * match exactly. Segment counts must be equal, so `/a/b` never matches
 * `/a/{x}/c`.
 *
 * Neither side may carry a query string: strip it first (the callers do,
 * because they need the stripped path for other reasons anyway).
 */
export function matchesPathPattern(concretePath: string, pattern: string): boolean {
  return segmentsMatchPattern(pathSegments(concretePath), pattern);
}

/**
 * As `matchesPathPattern`, for a caller that has already split the concrete
 * path and is testing it against many patterns in a loop.
 */
export function segmentsMatchPattern(
  concreteSegments: readonly string[],
  pattern: string
): boolean {
  const patternSegments = pathSegments(pattern);
  if (concreteSegments.length !== patternSegments.length) return false;

  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i].startsWith('{')) continue; // wildcard
    if (patternSegments[i] !== concreteSegments[i]) return false;
  }
  return true;
}
