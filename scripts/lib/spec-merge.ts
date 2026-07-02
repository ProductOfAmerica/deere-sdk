/**
 * Structurally merge the multiple OpenAPI documents the John Deere portal
 * returns for a single API slug into one spec object. Pure: never mutates any
 * input document (the $ref rewrite always operates on a deep copy).
 *
 * The primary document owns the merged spec's `info`, wins every deep-equal
 * dedupe decision, and never has its components renamed. That protects the
 * committed public type surface: the `components['schemas'][...]` references
 * that src/safe and the embed-contracts patch targets are pinned to. The
 * PRIMARY_ENDPOINT_NAME values below were pinned from the portal state
 * recorded in the branch plan; each names the document whose content is the
 * committed `specs/raw/{slug}.yaml` today. The first live fetch (a later,
 * human-reviewed step) is the end-to-end verification, and a wrong entry
 * surfaces there as a huge unexplained diff plus breaking diagnostics, not
 * silently.
 */

import { toPascalCase } from './spec-utils.js';

const PRIMARY_ENDPOINT_NAME: Record<string, string> = {
  'field-operations-api': 'field-operation',
  files: 'files-api',
  flags: 'flags',
  'machine-locations': 'location-history',
  'map-layers': 'map-layer-summaries',
  products: 'varieties',
  webhook: 'event-subscription',
};

/** Top-level keys merged by dedicated logic (not the generic add-if-absent). */
const SPECIAL_TOP_LEVEL_KEYS = new Set([
  'paths',
  'components',
  'servers',
  'tags',
  'x-source-documents',
]);

export interface FetchedDoc {
  endPointName: string;
  id: number;
  doc: unknown;
}

interface OrderedDoc {
  endPointName: string;
  id: number;
  /** A deep copy that this module may freely mutate. */
  doc: unknown;
}

export interface MergeOptions {
  /**
   * Safety bound on the component-rename fixpoint. Defaults to the total
   * component count across documents, which a correct merge never reaches
   * (each component is renamed at most once). Overridable to exercise the
   * guard.
   */
  maxRenameIterations?: number;
}

// ---------------------------------------------------------------------------
// Small structural helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deep structural equality that is insensitive to object key order but
 * sensitive to array element order (an OpenAPI `enum` / `required` / `allOf`
 * array is order-significant, whereas two schemas differing only by key order
 * are the same schema).
 */
function deepEqualUnordered(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualUnordered(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(b, key)) return false;
      if (!deepEqualUnordered(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function compareByEndpointThenId(a: FetchedDoc, b: FetchedDoc): number {
  const byEndpoint = compareStrings(a.endPointName, b.endPointName);
  return byEndpoint !== 0 ? byEndpoint : a.id - b.id;
}

function totalComponentCount(docs: readonly OrderedDoc[]): number {
  let count = 0;
  for (const entry of docs) {
    const components = asObject(asObject(entry.doc)?.components);
    if (!components) continue;
    for (const category of Object.values(components)) {
      const categoryObj = asObject(category);
      if (categoryObj) count += Object.keys(categoryObj).length;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Primary selection
// ---------------------------------------------------------------------------

function selectPrimary(slug: string, sorted: readonly FetchedDoc[]): FetchedDoc {
  const endpointNames = sorted.map((entry) => entry.endPointName).join(', ');

  const tableEndpoint = PRIMARY_ENDPOINT_NAME[slug];
  if (tableEndpoint !== undefined) {
    const pinned = sorted.find((entry) => entry.endPointName === tableEndpoint);
    if (pinned) return pinned;
    throw new Error(
      `mergeSpecDocs: slug "${slug}" pins primary document "${tableEndpoint}" in ` +
        `PRIMARY_ENDPOINT_NAME, but no fetched document declares that end_point_name ` +
        `(got: ${endpointNames}). Fix the table or the fetch.`
    );
  }

  const slugMatch = sorted.find((entry) => entry.endPointName === slug);
  if (slugMatch) return slugMatch;

  throw new Error(
    `mergeSpecDocs: multi-document slug "${slug}" has no PRIMARY_ENDPOINT_NAME entry and ` +
      `no document whose end_point_name equals the slug. Add a table entry naming the ` +
      `primary document; a silent primary flip would rename the public type surface. ` +
      `Document end_point_names: ${endpointNames}.`
  );
}

// ---------------------------------------------------------------------------
// $ref rewriting and component renaming (operate on a doc's own deep copy)
// ---------------------------------------------------------------------------

/**
 * Rewrite every `$ref` string that exactly equals `oldRef` to `newRef`
 * anywhere in `node`'s subtree. Exact string match, so `#/components/schemas/Foo`
 * never touches `#/components/schemas/FooBar`. Mutates in place.
 */
function rewriteRefStrings(node: unknown, oldRef: string, newRef: string): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefStrings(item, oldRef, newRef);
    return;
  }
  if (!isPlainObject(node)) return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (key === '$ref' && value === oldRef) {
      node[key] = newRef;
    } else {
      rewriteRefStrings(value, oldRef, newRef);
    }
  }
}

/**
 * Rename `components[category][oldName]` to `newName` inside `doc` and rewrite
 * every `#/components/<category>/<oldName>` $ref throughout the whole document.
 * One doc-wide walk covers paths, responses, parameters, requestBodies, and
 * nested schemas. Mutates the (already-copied) `doc`.
 */
function renameComponentInDoc(
  doc: unknown,
  category: string,
  oldName: string,
  newName: string
): void {
  const components = asObject(asObject(doc)?.components);
  const categoryObj = asObject(components?.[category]);
  if (!categoryObj) return;
  const value = categoryObj[oldName];
  delete categoryObj[oldName];
  categoryObj[newName] = value;
  rewriteRefStrings(
    doc,
    `#/components/${category}/${oldName}`,
    `#/components/${category}/${newName}`
  );
}

// ---------------------------------------------------------------------------
// Component reconciliation (fixpoint) against the accumulated merged set
// ---------------------------------------------------------------------------

interface Conflict {
  category: string;
  name: string;
  newName: string;
}

/**
 * The first component (in sorted category, then sorted name order) whose name
 * is present in the merged set but whose current value differs. Deterministic
 * so the fixpoint converges the same way regardless of iteration nuances.
 */
function findFirstConflict(
  mergedComponents: Record<string, unknown> | undefined,
  docComponents: Record<string, unknown>,
  suffix: string
): Conflict | null {
  for (const category of Object.keys(docComponents).sort(compareStrings)) {
    const docCategory = asObject(docComponents[category]);
    if (!docCategory) continue;
    const mergedCategory = asObject(mergedComponents?.[category]);
    if (!mergedCategory) continue;
    for (const name of Object.keys(docCategory).sort(compareStrings)) {
      const mergedValue = mergedCategory[name];
      if (mergedValue === undefined) continue;
      if (deepEqualUnordered(mergedValue, docCategory[name])) continue;
      return { category, name, newName: `${name}_${suffix}` };
    }
  }
  return null;
}

/**
 * Reconcile a secondary document's components against the accumulated merged
 * components, renaming conflicting copies to `${Name}_${PascalCase(endpoint)}`
 * and rewriting their $refs across the document. Re-runs to a fixpoint because
 * a rename can invalidate an earlier deep-equal decision (a dependent that was
 * byte-equal now refs a renamed dependency). Returns the running rename count.
 */
function reconcileComponents(
  slug: string,
  merged: Record<string, unknown>,
  entry: OrderedDoc,
  cap: number,
  renameCountIn: number
): number {
  const docComponents = asObject(asObject(entry.doc)?.components);
  if (!docComponents) return renameCountIn;

  const suffix = toPascalCase(entry.endPointName);
  let renameCount = renameCountIn;

  for (;;) {
    const mergedComponents = asObject(merged.components);
    const conflict = findFirstConflict(mergedComponents, docComponents, suffix);
    if (!conflict) break;

    const { category, name, newName } = conflict;
    const docCategory = asObject(docComponents[category]);
    const renamedValue = docCategory?.[name];

    const mergedTarget = asObject(mergedComponents?.[category])?.[newName];
    if (mergedTarget !== undefined && !deepEqualUnordered(mergedTarget, renamedValue)) {
      throw new Error(
        `mergeSpecDocs: slug "${slug}": renaming component ${category}/${name} from ` +
          `document "${entry.endPointName}" to ${category}/${newName} collides with an ` +
          `existing, non-equal ${category}/${newName} already in the merged spec. ` +
          `A human must resolve this.`
      );
    }

    const docTarget = docCategory?.[newName];
    if (
      newName !== name &&
      docTarget !== undefined &&
      !deepEqualUnordered(docTarget, renamedValue)
    ) {
      throw new Error(
        `mergeSpecDocs: slug "${slug}": renaming component ${category}/${name} in ` +
          `document "${entry.endPointName}" to ${category}/${newName} collides with a ` +
          `different existing ${category}/${newName} in the same document. ` +
          `A human must resolve this.`
      );
    }

    renameComponentInDoc(entry.doc, category, name, newName);
    renameCount += 1;
    if (renameCount > cap) {
      throw new Error(
        `mergeSpecDocs: slug "${slug}": component rename fixpoint exceeded its cap of ` +
          `${cap} (the total component count across documents). This indicates a ` +
          `non-converging merge; a human must investigate.`
      );
    }
  }

  return renameCount;
}

// ---------------------------------------------------------------------------
// Section folds
// ---------------------------------------------------------------------------

function pathMethodKey(path: string, key: string): string {
  return `${path} ${key}`;
}

function recordPathProvenance(
  owner: Map<string, string>,
  path: string,
  pathItem: unknown,
  endPointName: string
): void {
  const item = asObject(pathItem);
  if (!item) {
    owner.set(pathMethodKey(path, ''), endPointName);
    return;
  }
  for (const key of Object.keys(item)) owner.set(pathMethodKey(path, key), endPointName);
}

function mergePaths(
  slug: string,
  merged: Record<string, unknown>,
  entry: OrderedDoc,
  owner: Map<string, string>
): void {
  const docPaths = asObject(asObject(entry.doc)?.paths);
  if (!docPaths) return;

  let mergedPaths = asObject(merged.paths);
  if (!mergedPaths) {
    mergedPaths = {};
    merged.paths = mergedPaths;
  }

  for (const path of Object.keys(docPaths)) {
    const incoming = docPaths[path];
    if (!(path in mergedPaths)) {
      mergedPaths[path] = incoming;
      recordPathProvenance(owner, path, incoming, entry.endPointName);
      continue;
    }

    const mergedItem = asObject(mergedPaths[path]);
    const incomingItem = asObject(incoming);
    if (!mergedItem || !incomingItem) {
      if (!deepEqualUnordered(mergedPaths[path], incoming)) {
        const firstOwner = owner.get(pathMethodKey(path, '')) ?? '(unknown)';
        throw new Error(
          `mergeSpecDocs: slug "${slug}": path "${path}" is defined incompatibly by ` +
            `documents "${firstOwner}" and "${entry.endPointName}". A human must reconcile them.`
        );
      }
      continue;
    }

    for (const key of Object.keys(incomingItem)) {
      const incomingValue = incomingItem[key];
      if (!(key in mergedItem)) {
        mergedItem[key] = incomingValue;
        owner.set(pathMethodKey(path, key), entry.endPointName);
        continue;
      }
      if (deepEqualUnordered(mergedItem[key], incomingValue)) continue;
      const firstOwner = owner.get(pathMethodKey(path, key)) ?? '(unknown)';
      throw new Error(
        `mergeSpecDocs: slug "${slug}": conflicting definitions for ${key.toUpperCase()} ` +
          `${path} between documents "${firstOwner}" and "${entry.endPointName}". The same ` +
          `path and method is defined differently in two documents; a human must reconcile them.`
      );
    }
  }
}

function foldComponents(merged: Record<string, unknown>, entry: OrderedDoc): void {
  const docComponents = asObject(asObject(entry.doc)?.components);
  if (!docComponents) return;

  let mergedComponents = asObject(merged.components);
  if (!mergedComponents) {
    mergedComponents = {};
    merged.components = mergedComponents;
  }

  for (const category of Object.keys(docComponents)) {
    const docCategory = asObject(docComponents[category]);
    if (!docCategory) {
      if (!(category in mergedComponents)) mergedComponents[category] = docComponents[category];
      continue;
    }
    let mergedCategory = asObject(mergedComponents[category]);
    if (!mergedCategory) {
      mergedCategory = {};
      mergedComponents[category] = mergedCategory;
    }
    for (const name of Object.keys(docCategory)) {
      // After reconcile, any name shared with the merged set is deep-equal, so
      // keeping the earlier (primary-first) copy is the dedupe rule.
      if (name in mergedCategory) continue;
      mergedCategory[name] = docCategory[name];
    }
  }
}

function foldTopLevelExtras(merged: Record<string, unknown>, entry: OrderedDoc): void {
  const doc = asObject(entry.doc);
  if (!doc) return;
  for (const [key, value] of Object.entries(doc)) {
    if (SPECIAL_TOP_LEVEL_KEYS.has(key)) continue;
    if (key in merged) continue;
    merged[key] = value;
  }
}

function applyServers(
  slug: string,
  merged: Record<string, unknown>,
  docs: readonly OrderedDoc[]
): void {
  const declared = docs
    .map((entry) => ({ endPointName: entry.endPointName, servers: asObject(entry.doc)?.servers }))
    .filter(
      (entry): entry is { endPointName: string; servers: unknown[] } =>
        Array.isArray(entry.servers) && entry.servers.length > 0
    );
  if (declared.length === 0) return;

  const reference = declared[0];
  for (const other of declared.slice(1)) {
    if (!deepEqualUnordered(other.servers, reference.servers)) {
      throw new Error(
        `mergeSpecDocs: slug "${slug}": documents "${reference.endPointName}" and ` +
          `"${other.endPointName}" declare different servers blocks. All declaring ` +
          `documents must agree; a human must reconcile them.`
      );
    }
  }
  merged.servers = reference.servers;
}

function applyTags(merged: Record<string, unknown>, docs: readonly OrderedDoc[]): void {
  const union: unknown[] = [];
  const seen = new Set<string>();
  let sawTags = false;

  for (const entry of docs) {
    const tags = asObject(entry.doc)?.tags;
    if (!Array.isArray(tags)) continue;
    sawTags = true;
    for (const tag of tags) {
      const name = isPlainObject(tag) && typeof tag.name === 'string' ? tag.name : undefined;
      if (name !== undefined) {
        if (seen.has(name)) continue;
        seen.add(name);
      }
      union.push(tag);
    }
  }

  if (sawTags) merged.tags = union;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Merge a slug's fetched OpenAPI documents into one spec object.
 *
 * Zero documents throw. A single document is returned unchanged and unstamped.
 * For two or more, the primary document (repo-owned table, else the slug-named
 * document, else a loud error) leads; the remaining documents follow in
 * `end_point_name` order, so the input array order never influences the output.
 */
export function mergeSpecDocs(
  slug: string,
  docs: readonly FetchedDoc[],
  options: MergeOptions = {}
): unknown {
  if (docs.length === 0) {
    throw new Error(`mergeSpecDocs: no documents provided for slug "${slug}".`);
  }
  if (docs.length === 1) {
    return docs[0].doc;
  }

  // Deterministic order independent of the input array order: sort the whole
  // set by (end_point_name, id), pick the primary, keep the rest in that order.
  const sorted = [...docs].sort(compareByEndpointThenId);
  const primary = selectPrimary(slug, sorted);
  const orderedInputs = [primary, ...sorted.filter((entry) => entry !== primary)];

  // Deep copy every document up front so no input is ever mutated.
  const ordered: OrderedDoc[] = orderedInputs.map((entry) => ({
    endPointName: entry.endPointName,
    id: entry.id,
    doc: structuredClone(entry.doc),
  }));

  const cap = options.maxRenameIterations ?? totalComponentCount(ordered);

  // The primary owns the base document: info, openapi, security, x-* and its
  // own paths/components (merged with the secondaries below).
  const merged: Record<string, unknown> = {};
  const primaryObj = asObject(ordered[0].doc);
  if (primaryObj) {
    for (const [key, value] of Object.entries(primaryObj)) merged[key] = value;
  }

  const pathOwner = new Map<string, string>();
  recordPathProvenanceFor(pathOwner, ordered[0]);

  let renameCount = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const entry = ordered[i];
    renameCount = reconcileComponents(slug, merged, entry, cap, renameCount);
    mergePaths(slug, merged, entry, pathOwner);
    foldComponents(merged, entry);
    foldTopLevelExtras(merged, entry);
  }

  applyServers(slug, merged, ordered);
  applyTags(merged, ordered);

  merged['x-source-documents'] = ordered.map((entry) => ({
    endPointName: entry.endPointName,
    id: entry.id,
  }));

  return merged;
}

function recordPathProvenanceFor(owner: Map<string, string>, entry: OrderedDoc): void {
  const paths = asObject(asObject(entry.doc)?.paths);
  if (!paths) return;
  for (const path of Object.keys(paths)) {
    recordPathProvenance(owner, path, paths[path], entry.endPointName);
  }
}
