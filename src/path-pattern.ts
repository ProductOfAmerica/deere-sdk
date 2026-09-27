/**
 * Matching a concrete request path against an OpenAPI path pattern.
 *
 * By the time a path reaches the runtime it is interpolated:
 * `/notifications/b22956b7-...`, not `/notifications/{sourceEvent}`. Two
 * separate features need to recognise which pattern such a path came from,
 * HATEOAS route lookup and per-path server overrides, so the predicate lives
 * here rather than being written twice.
 *
 * Pure and allocation-light: no regex compilation, no caching, no state.
 */

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
