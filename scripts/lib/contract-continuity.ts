/**
 * Contract continuity between the committed raw spec and what the portal
 * serves for its slug today. Pure: no filesystem, no network, no logging.
 *
 * This replaces the apiId equality guard. That guard asked "is this the same
 * upstream record?", which Deere's api_id cannot answer: it is neither unique
 * per API (products and service-data-products shared
 * 5cedab22-e2f6-4d23-b5c5-9cc8b6b86122, measured 2026-08-13) nor stable over
 * time (products was reissued 8c97edbb-506b-4a2b-aef8-34f114ed0ea8 between the
 * 2026-08-17 and 2026-08-18 syncs over a byte-identical contract, which
 * false-positived the daily sync). See the tombstone in
 * scripts/spec-registry.yaml.
 *
 * The question the guard actually existed to answer is narrower and locally
 * measurable: does the slug still serve the contract we committed under this
 * name? A repointed slug answers no, loudly, because essentially none of the
 * committed operations survive.
 *
 * Identity is opKey from ./api-surface.js, the same (method, normalized path)
 * key the api-surface manifest is keyed on, so an upstream param rename
 * (`{orgId}` becomes `{organizationId}`) is absorbed rather than counted as a
 * lost operation. Sibling operations that differ only by param name therefore
 * collapse into one key here: the counts below are over distinct identities,
 * not raw path items, which is all a survival ratio needs, and a collapsed set
 * is reported under one of its siblings.
 *
 * Identities are what the comparison runs on; they are not what an operator
 * reads. `missing` therefore carries the committed document's own paths, so a
 * block message names endpoints that can be grepped in specs/raw/<name>.yaml
 * rather than the param-erased `{_}` form.
 */

import { opKey, type SurfaceOp } from './api-surface.js';
import { isRecord } from './spec-utils.js';

/**
 * The five methods the pipeline recognizes as operations (generate-sdk emits
 * nothing else). Everything else under a path item, `parameters` above all, is
 * not an operation and must not be counted as one.
 */
const OPERATION_METHODS = new Set<string>([
  'get',
  'post',
  'put',
  'patch',
  'delete',
] satisfies SurfaceOp['method'][]);

export interface ContractContinuity {
  /** Distinct operation identities in the committed document. */
  committedCount: number;
  /** How many of those still appear in the fetched document. */
  survivingCount: number;
  /**
   * The committed operations absent from the fetched document, sorted. One
   * `METHOD /raw/path` entry per missing identity, the method uppercased and
   * the path exactly as the committed document writes it, so entries are for
   * display, not for identity comparison. Committed siblings that collapse
   * into one identity contribute one entry, the first in document order.
   */
  missing: string[];
}

/**
 * Every operation identity in an OpenAPI document, mapped to a display string
 * carrying the document's own raw path. Anything that is not a mapping with a
 * `paths` mapping yields the empty map rather than throwing: this runs against
 * a committed file that a human may have truncated or hand-mangled, and a
 * malformed baseline must degrade to "no baseline", never to a crashed run.
 * Downstream stages are what validate parseability.
 */
function operationIndex(doc: unknown): Map<string, string> {
  const ops = new Map<string, string>();
  if (!isRecord(doc) || !isRecord(doc.paths)) return ops;
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const method of Object.keys(pathItem)) {
      if (!OPERATION_METHODS.has(method.toLowerCase())) continue;
      const key = opKey(method, path);
      // First in document order represents the identity; siblings that differ
      // only by param name share it, and one representative is enough.
      if (!ops.has(key)) ops.set(key, `${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

/**
 * Compare the committed document's operations against the fetched one's.
 * Counting and deciding are separate exports: this one only counts, and
 * isDiscontinuous below turns the counts into a verdict. The caller's only job
 * is I/O and reporting.
 */
export function assessContractContinuity(
  committedDoc: unknown,
  fetchedDoc: unknown
): ContractContinuity {
  const committed = operationIndex(committedDoc);
  const fetched = operationIndex(fetchedDoc);
  const missing = [...committed]
    .filter(([key]) => !fetched.has(key))
    .map(([, display]) => display)
    .sort();
  return {
    committedCount: committed.size,
    survivingCount: committed.size - missing.length,
    missing,
  };
}

/**
 * Fraction of the committed spec's operations that must still be served for a
 * refresh to proceed. A heuristic threshold, not a measured boundary. 0.5 is
 * chosen because the two cases it separates sit at the extremes: a same-API
 * evolution churns a handful of operations per sync (the 2026-08-18 products
 * reissue churned none of 38), while a slug repointed at a different API keeps
 * essentially none of them. Nothing observed sits near the middle, so the
 * exact value only matters if Deere ever starts rewriting an API by halves.
 */
export const MIN_SURVIVAL = 0.5;

/**
 * Whether the counts describe a slug that no longer serves the contract
 * committed under this name. Blocking requires at least two committed
 * identities:
 *
 *   - zero is no baseline at all (a committed file with no recognizable
 *     operations), and a ratio over it is NaN;
 *   - one cannot distinguish same-API evolution from a repointed slug. Either
 *     way exactly one identity is lost, so the ratio is always 0 and the guard
 *     would fire on any single legitimate path edit upstream. 7 of the 27
 *     active specs carry exactly one operation identity (measured 2026-08-18
 *     over specs/raw; confirm before citing), so without this floor a routine
 *     upstream edit to any of them turns the sync red. Nothing is left
 *     unprotected: the api-surface manifest classification downstream still
 *     accounts for the lost method as breaking.
 */
export function isDiscontinuous(result: ContractContinuity): boolean {
  if (result.committedCount < 2) return false;
  return result.survivingCount / result.committedCount < MIN_SURVIVAL;
}
