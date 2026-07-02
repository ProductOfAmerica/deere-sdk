/**
 * Pure library for the committed operation-identity manifest
 * (scripts/api-surface.yaml).
 *
 * The manifest maps operation identity (HTTP method + normalized path) to the
 * public method name the SDK generator emits. Keying names to identity rather
 * than to spec document order is what stops an upstream `paths` reorder from
 * silently rebinding a public method to a different endpoint.
 *
 * Everything here is side-effect free except loadApiSurface's single file read,
 * matching the repo convention that entrypoints run main() on import and are
 * therefore untestable (precedent: scripts/lib/sdk-gen-utils.ts,
 * scripts/embed-contracts.ts).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';

// ============================================================================
// Types
// ============================================================================

export interface SurfaceEntry {
  /** Display form "METHOD /path" with real param names. Matched via normalizePathPattern. */
  op: string;
  /** Public method name the generator emits for this operation. */
  name: string;
}

export interface ApiSurface {
  version: 1;
  specs: Record<string, SurfaceEntry[]>;
}

/** What naming needs to know about a single spec operation. */
export interface SurfaceOp {
  /** Synthesized upstream when the spec omits one; see extractOps. */
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  isCollection: boolean;
}

// ============================================================================
// Identity
// ============================================================================

/**
 * Normalize a path pattern by replacing every `{paramName}` with `{_}` so
 * path-param name differences (e.g. `{orgId}` vs `{organizationId}`) collapse
 * into the same key. Used for pathOwner index lookups; HATEOAS entries
 * should match regardless of which variable name a spec uses.
 */
export function normalizePathPattern(path: string): string {
  return path.replace(/\{[^}]+\}/g, '{_}');
}

/**
 * Operation identity. Param-name churn (`{orgId}` -> `{organizationId}`) does
 * not change it, so an upstream rename of a variable cannot rebind a name.
 */
export function opKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePathPattern(path)}`;
}

// ============================================================================
// Shared constants + guards
// ============================================================================

const DEFAULT_SURFACE_PATH = join(process.cwd(), 'scripts', 'api-surface.yaml');
const OP_PATTERN = /^(GET|POST|PUT|PATCH|DELETE) (\/\S*)$/;
const NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
/** Generated-class field names a method name must never shadow. */
const RESERVED_NAMES = new Set(['constructor', 'spec', 'client']);
const METHODS: readonly SurfaceOp['method'][] = ['get', 'post', 'put', 'patch', 'delete'];

function fail(detail: string): never {
  throw new Error(`api-surface: ${detail}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ============================================================================
// Loader (the only impure function: one file read)
// ============================================================================

/**
 * Load and validate scripts/api-surface.yaml.
 *
 * Throws with a remediation-bearing message on: missing file, unparseable
 * YAML, `version !== 1`, non-mapping `specs`, non-array spec entries, an entry
 * missing/mistyped `op` or `name`, an `op` not of the form "METHOD /path", a
 * duplicate normalized identity within a spec, a duplicate name within a spec,
 * a name outside /^[a-z][a-zA-Z0-9]*$/, a name colliding with a generated
 * class field (constructor/spec/client), or an explicit `listAll` (which the
 * generator always derives from a `list` collection GET).
 *
 * @param filePath Optional override for the manifest path (used by tests).
 */
export function loadApiSurface(filePath: string = DEFAULT_SURFACE_PATH): ApiSurface {
  if (!existsSync(filePath)) {
    fail(
      `manifest file missing at ${filePath}. Seed it with scripts/seed-api-surface.ts ` +
        `(pnpm tsx scripts/seed-api-surface.ts) and commit scripts/api-surface.yaml. ` +
        `The generator never auto-seeds: seeding from freshly fetched specs is the incident this pipeline prevents.`
    );
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (e) {
    fail(`failed to read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch (e) {
    fail(`unparseable YAML in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateSurface(parsed, filePath);
}

function validateSurface(parsed: unknown, filePath: string): ApiSurface {
  if (!isObject(parsed)) {
    fail(
      `top-level value in ${filePath} must be a mapping with "version" and "specs", got ${describeType(parsed)}`
    );
  }
  if (parsed.version !== 1) {
    fail(
      `unsupported version ${JSON.stringify(parsed.version)} in ${filePath}; expected version: 1`
    );
  }
  if (!isObject(parsed.specs)) {
    fail(
      `"specs" in ${filePath} must be a mapping of specName to entries, got ${describeType(parsed.specs)}`
    );
  }
  const specs: Record<string, SurfaceEntry[]> = {};
  for (const [specName, entries] of Object.entries(parsed.specs)) {
    specs[specName] = validateSpecEntries(specName, entries);
  }
  return { version: 1, specs };
}

function validateSpecEntries(specName: string, entries: unknown): SurfaceEntry[] {
  if (!Array.isArray(entries)) {
    fail(`spec "${specName}" must map to an array of entries, got ${describeType(entries)}`);
  }
  const seenKeys = new Map<string, string>();
  const seenNames = new Set<string>();
  const result: SurfaceEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry: unknown = entries[i];
    const where = `spec "${specName}" entry[${i}]`;
    if (!isObject(entry)) {
      fail(`${where} must be a mapping with "op" and "name", got ${describeType(entry)}`);
    }
    if (typeof entry.op !== 'string' || entry.op.length === 0) {
      fail(`${where}: "op" must be a non-empty string`);
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      fail(`${where}: "name" must be a non-empty string`);
    }
    const op = entry.op;
    const name = entry.name;

    const parsedOp = OP_PATTERN.exec(op);
    if (!parsedOp) {
      fail(
        `${where}: "op" ${JSON.stringify(op)} must be "METHOD /path" with METHOD in GET, POST, PUT, PATCH, DELETE`
      );
    }

    validateName(where, name);

    const key = opKey(parsedOp[1], parsedOp[2]);
    const priorOp = seenKeys.get(key);
    if (priorOp !== undefined) {
      fail(
        `spec "${specName}": duplicate operation identity ${JSON.stringify(key)} from op ${JSON.stringify(op)} ` +
          `(already declared by ${JSON.stringify(priorOp)}); path-param names collapse to the same identity`
      );
    }
    seenKeys.set(key, op);

    if (seenNames.has(name)) {
      fail(
        `spec "${specName}": duplicate method name ${JSON.stringify(name)}; each public method name must be unique within a spec`
      );
    }
    seenNames.add(name);

    result.push({ op, name });
  }
  return result;
}

function validateName(where: string, name: string): void {
  if (name === 'listAll') {
    fail(
      `${where}: name "listAll" is not allowed. The auto-paginated listAll twin is always derived from an entry ` +
        `named "list", so an explicit listAll entry would collide with it.`
    );
  }
  if (RESERVED_NAMES.has(name)) {
    fail(
      `${where}: name ${JSON.stringify(name)} collides with a generated class field ` +
        `(${[...RESERVED_NAMES].join(', ')}); pick another name`
    );
  }
  if (!NAME_PATTERN.test(name)) {
    fail(
      `${where}: name ${JSON.stringify(name)} must match /^[a-z][a-zA-Z0-9]*$/ (a camelCase identifier)`
    );
  }
}

// ============================================================================
// Serializer (deterministic; full regeneration, never append)
// ============================================================================

const HEADER = `# api-surface.yaml
#
# Operation identity to public method name registry. Each entry maps one API
# operation, keyed by (HTTP method, normalized path), to the public method name
# the SDK generator emits. The generator never invents or rebinds a name: a
# name lives in this file or the operation has no name yet.
#
# This file is REGENERATED by generate-sdk whenever new upstream operations
# appear, so it is rewritten wholesale. Per-entry hand comments are not
# preserved; only the "name:" values are meant to be hand-edited.
#
# Breaking-change runbook:
#   Upstream renamed a path: update that entry's "op:" to the new path. The
#     name stays, so the public method is preserved.
#   Upstream removed an endpoint: delete the entry. That drops the public
#     method, which is a major-version consideration.
#
# Proposed names for NEW operations preserve interior camel humps (for example
# "listMeasurementTypes", not "listMeasurementtypes"), unlike the historical
# names seeded from the legacy generator.
#
# "listAll" never appears here: it is a derived twin of any collection GET
# named "list", emitted automatically by the generator.
#
`;

/**
 * Serialize a surface deterministically: specs sorted alphabetically, entries
 * sorted by opKey, behind a fixed header comment. Round-trip law:
 * loadApiSurface of a written serializeApiSurface(x) equals x, modulo entry
 * ordering (which this function canonicalizes).
 */
export function serializeApiSurface(surface: ApiSurface): string {
  const specs: Record<string, SurfaceEntry[]> = {};
  for (const specName of Object.keys(surface.specs).sort(compareStrings)) {
    const entries = [...surface.specs[specName]].sort(compareEntries);
    specs[specName] = entries.map((e) => ({ op: e.op, name: e.name }));
  }
  const body = yaml.stringify({ version: 1, specs }, { lineWidth: 0 });
  return `${HEADER}${body}`;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function opSortKey(op: string): string {
  const m = OP_PATTERN.exec(op);
  return m ? opKey(m[1], m[2]) : op;
}

function compareEntries(a: SurfaceEntry, b: SurfaceEntry): number {
  const ka = opSortKey(a.op);
  const kb = opSortKey(b.op);
  if (ka !== kb) return compareStrings(ka, kb);
  if (a.op !== b.op) return compareStrings(a.op, b.op);
  return compareStrings(a.name, b.name);
}

// ============================================================================
// Op extraction (shared by the seed script and the generator)
// ============================================================================

/**
 * Walk a parsed spec's `paths` and return one SurfaceOp per operation. The
 * operationId synthesis and isCollection rule replicate parseSpec in
 * generate-sdk.ts exactly, so the seed script and the generator see identical
 * operations. Missing / empty / malformed `paths` yield [].
 */
export function extractOps(spec: unknown): SurfaceOp[] {
  const ops: SurfaceOp[] = [];
  if (!isObject(spec) || !isObject(spec.paths)) return ops;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!isObject(pathItem)) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const rawId = isObject(operation) ? operation.operationId : undefined;
      const operationId =
        typeof rawId === 'string' && rawId.length > 0
          ? rawId
          : `${method}${path.replace(/[^a-zA-Z]/g, '')}`;
      ops.push({ operationId, method, path, isCollection: isCollectionEndpoint(path, method) });
    }
  }
  return ops;
}

function isCollectionEndpoint(path: string, method: string): boolean {
  if (method !== 'get') return false;
  const lastSegment = path.split('/').pop() || '';
  return !lastSegment.startsWith('{');
}

// ============================================================================
// Name proposal for NEW operations (deterministic, no positional counters)
// ============================================================================

function verbFor(op: SurfaceOp): string {
  switch (op.method) {
    case 'get':
      return op.isCollection ? 'list' : 'get';
    case 'post':
      return 'create';
    case 'put':
      return 'update';
    case 'patch':
      return 'patch';
    case 'delete':
      return 'delete';
  }
}

/**
 * Strip non-alphanumerics, uppercase the first character only, and preserve
 * interior capitalization: `measurementTypes` -> `MeasurementTypes`,
 * `equipmentISGTypes` -> `EquipmentISGTypes`. Deliberately diverges from the
 * legacy toPascalCase (which lowercases interiors) because a proposed name is
 * new public surface, so the readable form is chosen.
 */
function capHump(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length === 0) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function paramNames(path: string): string[] {
  const matches = path.match(/\{([^}]+)}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Deterministic name for a NEW operation. Verb by method (collection GETs use
 * `list`), then capHump of the last non-param segment; never a bare verb.
 * Tiebreak chain, first free wins: prepend preceding non-param segments
 * nearest-first up to the whole path, then append `By<LastParam>` to the
 * full-path candidate. If every candidate is taken, throw (a human picks a
 * name; there is deliberately no numeric-counter fallback, which was the
 * legacy bug).
 */
export function proposeName(op: SurfaceOp, takenNames: ReadonlySet<string>): string {
  const verb = verbFor(op);
  const segments = op.path.split('/').filter(Boolean);
  const nonParam = segments.filter((s) => !s.startsWith('{'));
  const params = paramNames(op.path);

  const candidates: string[] = [];
  if (nonParam.length === 0) {
    candidates.push(`${verb}Item`);
  } else {
    for (let i = nonParam.length - 1; i >= 0; i--) {
      candidates.push(`${verb}${nonParam.slice(i).map(capHump).join('')}`);
    }
  }
  if (params.length > 0) {
    const fullPathCandidate = candidates[candidates.length - 1];
    candidates.push(`${fullPathCandidate}By${capHump(params[params.length - 1])}`);
  }

  for (const candidate of candidates) {
    if (!takenNames.has(candidate)) return candidate;
  }
  fail(
    `no available name for ${opKey(op.method, op.path)}; tried ${candidates.join(', ')}. ` +
      `A human must add an entry for it to scripts/api-surface.yaml with a chosen name.`
  );
}

// ============================================================================
// Resolution (order-independent: the class-elimination law)
// ============================================================================

/** A pinned or proposed name of `list` on a collection GET reserves its listAll twin. */
function addImpliedTwin(taken: Set<string>, op: SurfaceOp, name: string): void {
  if (name === 'list' && op.method === 'get' && op.isCollection) {
    taken.add('listAll');
  }
}

function displayOp(op: SurfaceOp): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/**
 * Resolve public method names for a spec's operations against the manifest.
 *
 * - Pinned: an op whose identity matches a manifest entry gets that name.
 * - missing: manifest entries with no matching op (the breaking signal).
 * - New ops (no entry): proposed in opKey-sorted order, each against the set
 *   of pinned names, accrued proposals, and any implied `listAll` twins.
 *
 * The returned `names` map is identical regardless of the input order of
 * `ops`: no positional dependence anywhere.
 */
export function resolveMethodNames(
  specName: string,
  ops: SurfaceOp[],
  surface: ApiSurface
): { names: Map<string, string>; newEntries: SurfaceEntry[]; missing: SurfaceEntry[] } {
  const surfaceEntries = surface.specs[specName] ?? [];

  const entryByKey = new Map<string, SurfaceEntry>();
  for (const entry of surfaceEntries) {
    const parsed = OP_PATTERN.exec(entry.op);
    if (parsed) entryByKey.set(opKey(parsed[1], parsed[2]), entry);
  }

  const names = new Map<string, string>();
  const takenNames = new Set<string>();
  const matchedKeys = new Set<string>();

  const pinned: Array<{ op: SurfaceOp; key: string; name: string }> = [];
  const fresh: Array<{ op: SurfaceOp; key: string }> = [];
  for (const op of ops) {
    const key = opKey(op.method, op.path);
    const entry = entryByKey.get(key);
    if (entry) {
      pinned.push({ op, key, name: entry.name });
      matchedKeys.add(key);
    } else {
      fresh.push({ op, key });
    }
  }

  // Pinned names are keyed by identity, so their assignment is order-free.
  for (const p of pinned) {
    names.set(p.key, p.name);
    takenNames.add(p.name);
    addImpliedTwin(takenNames, p.op, p.name);
  }

  // New ops resolve in identity order for a deterministic accrual.
  fresh.sort((a, b) => compareStrings(a.key, b.key));
  const newEntries: SurfaceEntry[] = [];
  for (const { op, key } of fresh) {
    const name = proposeName(op, takenNames);
    names.set(key, name);
    takenNames.add(name);
    addImpliedTwin(takenNames, op, name);
    newEntries.push({ op: displayOp(op), name });
  }

  const missing: SurfaceEntry[] = [];
  for (const entry of surfaceEntries) {
    const parsed = OP_PATTERN.exec(entry.op);
    if (!parsed) continue;
    if (!matchedKeys.has(opKey(parsed[1], parsed[2]))) missing.push(entry);
  }

  return { names, newEntries, missing };
}

// ============================================================================
// Run classification (consumed by the workflow via sync-report.json)
// ============================================================================

/** breaking if anything is missing, else additive if anything is new, else benign. */
export function classifyRun(input: {
  newEntries: unknown[];
  missing: unknown[];
}): 'benign' | 'additive' | 'breaking' {
  if (input.missing.length > 0) return 'breaking';
  if (input.newEntries.length > 0) return 'additive';
  return 'benign';
}
