/**
 * Cross-document operation relocations, applied by scripts/fix-specs.ts.
 *
 * John Deere occasionally moves an operation from one spec document to another
 * without changing the operation itself. The manifest (scripts/api-surface.yaml)
 * binds every published method to an operation inside ONE spec, so a move reads
 * as "operation missing" and the sync classifies the run breaking, even though
 * the route, the contract, and every caller's code are unchanged. Dropping the
 * method would break consumers over a documentation reshuffle; freezing the
 * source spec has no lift trigger, because Deere will not move it back.
 *
 * A relocation keeps the published method alive by copying the operation, as
 * Deere now publishes it in the destination document, back into the spec that
 * owns the method, marked deprecated in favour of the destination's own method.
 * It is the cross-document counterpart of repointing a manifest entry's `op:`
 * after an in-spec path rename.
 *
 * Every entry is a claim about Deere's documents, and the transform throws the
 * moment the claim stops being true, rather than silently injecting an
 * operation nobody is watching (the failure #46 removed):
 *
 *   - the destination stops declaring the operation  -> throw (Deere dropped it,
 *     or moved it elsewhere; removing the method is a major-version decision)
 *   - the owning spec declares it again itself        -> throw (stale entry)
 *   - a component it references differs between the two documents -> throw
 *     (copying would change the types of operations already in the owning spec)
 *
 * Each entry also names the major version in which it must be deleted together
 * with its manifest entry; tests/spec-relocations.test.ts fails once
 * package.json reaches that major.
 */

import { isDeepStrictEqual } from 'node:util';
import { isRecord } from './spec-utils.js';

export interface Relocation {
  /** Lowercase HTTP method of the relocated operation. */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** The operation's path, exactly as both documents declare it. */
  path: string;
  /** The spec that owns the published method (the manifest entry's spec). */
  into: string;
  /** The spec whose document now declares the operation. */
  from: string;
  /** Plain-text pointer to the method that replaces the deprecated one. */
  replacement: string;
  /** Date the move was first observed in a fetch. */
  observed: string;
  /** Evidence for the move, in enough detail to re-verify it. */
  evidence: string;
  /** The package major in which this entry and its manifest entry are deleted. */
  removeInMajor: number;
}

export const RELOCATIONS: readonly Relocation[] = [
  {
    method: 'get',
    path: '/users/{userName}/organizations',
    into: 'organizations',
    from: 'users',
    replacement: 'deere.users.listOrganizations()',
    observed: '2026-10-01',
    evidence:
      'Declared by the organizations document through the 2026-09-26 sync (commit e0febbc). ' +
      'The 2026-10-01 fetch has it only in the users document, with a deep-equal operation ' +
      'object (examples included) and byte-equal definitions of every component it references ' +
      '(parameters UserName2 and X-deere-signature2, schemas OrganizationLink2 and ' +
      'OrganizationViewGet), all of which the organizations document still carries.',
    removeInMajor: 4,
  },
];

/** Extension stamped on a relocated operation, naming the document it came from. */
export const RELOCATED_FROM_KEY = 'x-relocated-from';
/** Extension carrying the deprecation note generate-sdk emits as `@deprecated`. */
export const DEPRECATED_REPLACEMENT_KEY = 'x-deprecated-replacement';

const COMPONENT_REF = /^#\/components\/([^/]+)\/([^/]+)$/;

function collectLocalRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLocalRefs(item, out);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      if (COMPONENT_REF.test(value)) out.add(value);
    } else {
      collectLocalRefs(value, out);
    }
  }
}

function lookupComponent(spec: Record<string, unknown>, ref: string): unknown {
  const match = COMPONENT_REF.exec(ref);
  if (!match) return undefined;
  const components = spec.components;
  if (!isRecord(components)) return undefined;
  const category = components[match[1]];
  return isRecord(category) ? category[match[2]] : undefined;
}

/**
 * The local `#/components/...` refs an operation needs, transitively, resolved
 * against `spec`. Refs that `spec` does not define are returned too; the caller
 * decides what a dangling ref means.
 */
function componentClosure(spec: Record<string, unknown>, operation: unknown): string[] {
  const seen = new Set<string>();
  const queue = new Set<string>();
  collectLocalRefs(operation, queue);
  while (queue.size > 0) {
    const [ref] = queue;
    queue.delete(ref);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const next = new Set<string>();
    collectLocalRefs(lookupComponent(spec, ref), next);
    for (const r of next) if (!seen.has(r)) queue.add(r);
  }
  return [...seen].sort();
}

function getOperation(
  spec: Record<string, unknown>,
  path: string,
  method: string
): Record<string, unknown> | undefined {
  const paths = spec.paths;
  if (!isRecord(paths)) return undefined;
  const item = paths[path];
  if (!isRecord(item)) return undefined;
  const op = item[method];
  return isRecord(op) ? op : undefined;
}

/**
 * Apply every registered relocation whose `into` is `specName`, mutating
 * `spec`. `sources` maps a spec name to its parsed (redacted, unfixed) raw
 * document. Returns a human-readable line per relocation applied; throws when
 * an entry no longer describes Deere's documents (see the module header).
 * Never mutates a source document.
 */
export function applyRelocations(
  spec: Record<string, unknown>,
  specName: string,
  sources: ReadonlyMap<string, Record<string, unknown>>,
  registry: readonly Relocation[] = RELOCATIONS
): string[] {
  const applied: string[] = [];

  for (const entry of registry) {
    if (entry.into !== specName) continue;
    const label = `${entry.method.toUpperCase()} ${entry.path}`;
    const where = `scripts/lib/spec-relocations.ts (${label}, ${entry.from} -> ${entry.into})`;

    const source = sources.get(entry.from);
    if (!source) {
      throw new Error(
        `fix-specs: relocation ${where} needs the raw "${entry.from}" document, which was not loaded.`
      );
    }

    const sourceOp = getOperation(source, entry.path, entry.method);
    const targetOp = getOperation(spec, entry.path, entry.method);

    if (targetOp && sourceOp) {
      throw new Error(
        `fix-specs: both ${entry.into} and ${entry.from} declare ${label}, so the relocation ` +
          `entry in ${where} is stale. Delete it; the manifest entry binds to ${entry.into}'s own copy again.`
      );
    }
    if (targetOp) {
      throw new Error(
        `fix-specs: ${entry.into} declares ${label} again and ${entry.from} no longer does: ` +
          `Deere moved it back. Delete the relocation entry in ${where}.`
      );
    }
    if (!sourceOp) {
      throw new Error(
        `fix-specs: neither ${entry.into} nor ${entry.from} declares ${label} any more. ` +
          `Deere dropped or moved it again, so ${where} no longer describes reality. Find where it went ` +
          `(or confirm it is gone with probe-routes) before deciding; removing the published method ` +
          `is a major-version decision.`
      );
    }

    const sourceItem = (source.paths as Record<string, unknown>)[entry.path] as Record<
      string,
      unknown
    >;
    for (const key of ['servers', 'parameters']) {
      if (key in sourceItem) {
        throw new Error(
          `fix-specs: ${entry.from}'s path item for ${entry.path} now carries path-level "${key}", ` +
            `which ${where} does not copy. Re-check the relocation by hand.`
        );
      }
    }

    // Verify or copy every component the operation needs, BEFORE touching the
    // target, so a throw leaves it unmodified.
    const toAdd: Array<{ category: string; name: string; value: unknown }> = [];
    for (const ref of componentClosure(source, sourceOp)) {
      const sourceValue = lookupComponent(source, ref);
      if (sourceValue === undefined) {
        throw new Error(
          `fix-specs: ${entry.from} references ${ref} from ${label} but does not define it; ` +
            `${where} cannot copy a dangling ref.`
        );
      }
      const targetValue = lookupComponent(spec, ref);
      if (targetValue === undefined) {
        const [, category, name] = COMPONENT_REF.exec(ref) as RegExpExecArray;
        toAdd.push({ category, name, value: structuredClone(sourceValue) });
      } else if (!isDeepStrictEqual(sourceValue, targetValue)) {
        throw new Error(
          `fix-specs: ${ref} differs between ${entry.from} and ${entry.into}. Copying ${label} ` +
            `would change the types of ${entry.into}'s own operations that share it; reconcile ${where} by hand.`
        );
      }
    }

    if (!isRecord(spec.components)) spec.components = {};
    const components = spec.components as Record<string, unknown>;
    for (const { category, name, value } of toAdd) {
      if (!isRecord(components[category])) components[category] = {};
      (components[category] as Record<string, unknown>)[name] = value;
    }

    const copied: Record<string, unknown> = {
      ...structuredClone(sourceOp),
      deprecated: true,
      [RELOCATED_FROM_KEY]: entry.from,
      [DEPRECATED_REPLACEMENT_KEY]: `Deere now documents this operation in the ${entry.from} API; use ${entry.replacement}.`,
    };
    if (!isRecord(spec.paths)) spec.paths = {};
    const paths = spec.paths as Record<string, unknown>;
    if (!isRecord(paths[entry.path])) paths[entry.path] = {};
    (paths[entry.path] as Record<string, unknown>)[entry.method] = copied;

    applied.push(
      `${label} from ${entry.from}` +
        (toAdd.length > 0 ? ` (+${toAdd.length} component(s))` : ' (components already present)')
    );
  }

  return applied;
}
