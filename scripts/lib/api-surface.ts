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
import { isRecord } from './spec-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface SurfaceEntry {
  /** Display form "METHOD /path" with real param names. Identity is the
   *  normalized path (param names collapse), except sibling ops sharing a
   *  normalized key are matched by exact path. */
  op: string;
  /** Public method name the generator emits for this operation. */
  name: string;
  /**
   * The method's parameters and return type as one line of text (see
   * methodSignature in sdk-gen-utils.ts). Pinned so that a change to them
   * upstream stops the run for a person, where it used to be published as a
   * patch. Written for a new operation and by `pnpm accept-signatures`, never
   * by hand. Absent only on an entry a person has just added, which the next
   * run reports like a changed one.
   */
  signature?: string;
}

export interface ApiSurface {
  version: 1;
  specs: Record<string, SurfaceEntry[]>;
}

/** What naming needs to know about a single spec operation. */
export interface SurfaceOp {
  /** Synthesized when the spec omits one; see parseSpec in generate-sdk.ts. */
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  isCollection: boolean;
  /**
   * The signature the generator would emit for this operation now. It is
   * compared with the pinned one and plays no part in naming. A caller that
   * only wants names leaves it out, and then nothing is compared.
   */
  signature?: string;
}

/** A manifest entry whose pinned signature is not its operation's current one. */
export interface ChangedSignature {
  /** The entry's own `op`, which is how the entry is found again. */
  op: string;
  name: string;
  /** What the manifest pins. Absent when the entry has no signature yet. */
  pinned?: string;
  current: string;
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
 * Sibling operations that share a normalized key (crop-types declares both
 * GET /cropTypes/{name} and GET /cropTypes/{id}) are disambiguated by exact
 * raw path at match time; see resolveMethodNames.
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

function fail(detail: string): never {
  throw new Error(`api-surface: ${detail}`);
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
 * duplicate raw operation (identical method + exact path) within a spec, a
 * duplicate name within a spec,
 * a name outside /^[a-z][a-zA-Z0-9]*$/, a name colliding with a generated
 * class field (constructor/spec/client), an explicit `listAll` (which the
 * generator always derives from a `list` collection GET), or a `signature`
 * that is present but not a non-empty string on one line.
 *
 * @param filePath Optional override for the manifest path (used by tests).
 */
export function loadApiSurface(filePath: string = DEFAULT_SURFACE_PATH): ApiSurface {
  if (!existsSync(filePath)) {
    fail(
      `manifest file missing at ${filePath}. scripts/api-surface.yaml is committed and ` +
        `version-controlled; restore it from git history (for example, ` +
        `git restore --source <ref> scripts/api-surface.yaml) rather than re-deriving it from ` +
        `the current specs. The generator never auto-seeds: re-deriving names from freshly ` +
        `fetched specs could pin names an upstream reorder has already rebound, which is the ` +
        `incident this pipeline prevents.`
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
  if (!isRecord(parsed)) {
    fail(
      `top-level value in ${filePath} must be a mapping with "version" and "specs", got ${describeType(parsed)}`
    );
  }
  if (parsed.version !== 1) {
    fail(
      `unsupported version ${JSON.stringify(parsed.version)} in ${filePath}; expected version: 1`
    );
  }
  if (!isRecord(parsed.specs)) {
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
  const seenOps = new Set<string>();
  const seenNames = new Set<string>();
  const result: SurfaceEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry: unknown = entries[i];
    const where = `spec "${specName}" entry[${i}]`;
    if (!isRecord(entry)) {
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

    // Identity is the normalized path, but two entries may legally share a
    // normalized key when their raw paths differ (sibling ops that differ only
    // by param name, e.g. crop-types GET /cropTypes/{name} vs /cropTypes/{id}).
    // Only the identical raw op string (method + exact path) is a duplicate.
    const rawOp = `${parsedOp[1]} ${parsedOp[2]}`;
    if (seenOps.has(rawOp)) {
      fail(
        `spec "${specName}": duplicate operation ${JSON.stringify(rawOp)}; ` +
          `the identical method and exact path is declared more than once. Sibling ops that ` +
          `differ only by param name are allowed, but each raw op string must appear at most once.`
      );
    }
    seenOps.add(rawOp);

    if (seenNames.has(name)) {
      fail(
        `spec "${specName}": duplicate method name ${JSON.stringify(name)}; each public method name must be unique within a spec`
      );
    }
    seenNames.add(name);

    // One line, because the text is printed to the console and the job
    // summary when it stops a run. The key is left out when there is none.
    const signature = entry.signature;
    if (signature === undefined) {
      result.push({ op, name });
    } else if (typeof signature === 'string' && signature.length > 0 && !/[\r\n]/.test(signature)) {
      result.push({ op, name, signature });
    } else {
      fail(
        `${where}: "signature" must be a non-empty string on one line. It is written by ` +
          `"pnpm accept-signatures", not by hand; delete the key and run that to pin it again.`
      );
    }
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
# Path-param names normally do not affect identity (GET /orgs/{orgId} and
# GET /orgs/{organizationId} are the same operation), so an upstream param
# rename is absorbed and the public method is preserved. The exception is
# sibling operations that differ ONLY by param name: crop-types declares both
# GET /cropTypes/{name} and GET /cropTypes/{id} as distinct operations. Those
# are matched by exact path, so a param rename within such a sibling set is not
# absorbed; the old entry goes missing and the rename surfaces as a breaking
# diagnostic for a human to reconcile.
#
# Each entry also pins its method's "signature:": the parameters and return
# type as one line. Path parameters appear as a bare "string", so a rename
# upstream still changes nothing, and query members and enum values are
# sorted, so a reorder does not either. A change inside a schema type is not
# pinned.
#
# This file is REGENERATED by generate-sdk whenever new upstream operations
# appear, so it is rewritten wholesale. Per-entry hand comments are not
# preserved. Only "op:" and "name:" are meant to be hand-edited; a
# "signature:" is written by "pnpm accept-signatures".
#
# Breaking-change runbook. Each of these stops the run before anything is
# generated, committed or released:
#   Upstream renamed a path: update that entry's "op:" to the new path. The
#     name stays, so the public method is preserved.
#   Upstream removed an endpoint: delete the entry. That drops the public
#     method, which is a major-version consideration.
#   A signature no longer matches (or an entry has none): the method's
#     parameters or return type changed. If John Deere's spec is wrong,
#     repair it in scripts/fix-specs.ts and the signature matches again. If
#     the change is real, run "pnpm accept-signatures", review the diff of
#     this file, and release by hand at the level the change calls for. The
#     same script re-pins signatures after a change to the generator itself.
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
    // Key order is fixed here, and `signature` is left out when there is none.
    specs[specName] = entries.map((e) =>
      e.signature === undefined
        ? { op: e.op, name: e.name }
        : { op: e.op, name: e.name, signature: e.signature }
    );
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
 * `list`), then capHump of the last non-param segment; never a bare verb (a
 * segment that is all punctuation strips to empty under capHump and falls back
 * to the `Item` noun, so the result is never just the verb).
 * Tiebreak chain, first free wins: prepend preceding non-param segments
 * nearest-first up to the whole path, then append `By<LastParam>` to the
 * full-path candidate. `listAll` is passed over wherever it comes up. If every
 * candidate is taken, throw (a human picks a name; there is deliberately no
 * numeric-counter fallback, which was the legacy bug).
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
      // capHump strips a segment with no alphanumerics to '', which would leave
      // a bare verb like "get". Fall back to the same "Item" noun the
      // no-segment branch uses so a proposed name is never just a verb.
      const suffix = nonParam.slice(i).map(capHump).join('');
      candidates.push(suffix.length > 0 ? `${verb}${suffix}` : `${verb}Item`);
    }
  }
  if (params.length > 0) {
    const fullPathCandidate = candidates[candidates.length - 1];
    candidates.push(`${fullPathCandidate}By${capHump(params[params.length - 1])}`);
  }

  for (const candidate of candidates) {
    // Never proposed, taken or not. It is the twin the generator derives from
    // `list`, and validateName refuses it, so a manifest written with one would
    // stop every later run at load. A collection GET ending in `/all` reaches
    // it; no other candidate can be a reserved name, since each starts with a
    // verb.
    if (candidate === 'listAll') continue;
    if (!takenNames.has(candidate)) return candidate;
  }
  fail(
    `no available name for ${opKey(op.method, op.path)}; tried ${candidates.join(', ')}` +
      `${candidates.includes('listAll') ? ' ("listAll" is reserved for the twin derived from "list")' : ''}. ` +
      `A human must name it. The operation is in John Deere's current specs, not the committed ` +
      `ones, so work on a branch: run "pnpm fetch-specs" and the offline stages, add an entry for ` +
      `it to scripts/api-surface.yaml with a chosen name, and run "pnpm accept-signatures" to pin ` +
      `the entry's signature. CLAUDE.md, "When a signature stops the sync", has the rest.`
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

/**
 * The raw display string for an operation: "METHOD /path" with real param
 * names (e.g. "GET /organizations/{orgId}/fields") and an uppercased method.
 * This is the exact key `resolveMethodNames` stores its returned `names` map
 * under, so generate-sdk must build the identical string to look a name up.
 * Sharing this one function keeps the resolver and the generator in lockstep
 * instead of reconstructing the format inline in two places. Distinct from
 * `opKey`, which normalizes param names to `{_}` for identity.
 */
export function displayOp(op: SurfaceOp): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/**
 * Resolve public method names for a spec's operations against the manifest.
 *
 * Manifest entries and spec ops are each grouped by normalized identity key.
 * Per group:
 *
 * - Unambiguous (<= 1 entry AND <= 1 op): the single op absorbs the single
 *   entry's name regardless of raw path, so an upstream param rename is
 *   absorbed silently. An op with no entry is new; an entry with no op is
 *   missing (the breaking signal).
 * - Ambiguous (either side has > 1): the group holds sibling operations that
 *   differ only by param name (crop-types GET /cropTypes/{name} vs
 *   /cropTypes/{id}). Matching is by EXACT raw op string only. Unmatched
 *   entries are missing; unmatched ops are new. A param rename inside such a
 *   group therefore surfaces as breaking, which is correct: it is genuinely
 *   ambiguous and a human must reconcile it in the manifest.
 *
 * `names` is keyed by each op's raw display string ("METHOD /path" with real
 * param names), so sibling ops that share a normalized key stay distinct. New
 * ops are proposed in (normalized key, raw path) order for a deterministic
 * accrual against pinned names, accrued proposals, and implied `listAll`
 * twins. The result is identical regardless of the input order of `ops`.
 *
 * Signatures ride along and never affect a name. A matched entry whose pinned
 * signature is not its op's current one, or that has none, goes into
 * `changedSignatures`. A new entry takes its op's signature, so it is pinned
 * from its first run. An op handed in without a signature is not compared.
 */
export function resolveMethodNames(
  specName: string,
  ops: SurfaceOp[],
  surface: ApiSurface
): {
  names: Map<string, string>;
  newEntries: SurfaceEntry[];
  missing: SurfaceEntry[];
  changedSignatures: ChangedSignature[];
} {
  const surfaceEntries = surface.specs[specName] ?? [];

  // Group manifest entries and spec ops by normalized identity key.
  const entriesByKey = new Map<string, SurfaceEntry[]>();
  for (const entry of surfaceEntries) {
    const parsed = OP_PATTERN.exec(entry.op);
    if (!parsed) continue;
    const key = opKey(parsed[1], parsed[2]);
    const group = entriesByKey.get(key);
    if (group) group.push(entry);
    else entriesByKey.set(key, [entry]);
  }
  const opsByKey = new Map<string, SurfaceOp[]>();
  for (const op of ops) {
    const key = opKey(op.method, op.path);
    const group = opsByKey.get(key);
    if (group) group.push(op);
    else opsByKey.set(key, [op]);
  }

  const pinned: Array<{ op: SurfaceOp; entry: SurfaceEntry }> = [];
  const fresh: SurfaceOp[] = [];
  const matchedEntries = new Set<SurfaceEntry>();

  // Process groups in sorted key order; within a group, ops sorted by raw path.
  const allKeys = [...new Set([...entriesByKey.keys(), ...opsByKey.keys()])].sort(compareStrings);
  for (const key of allKeys) {
    const groupEntries = entriesByKey.get(key) ?? [];
    const groupOps = [...(opsByKey.get(key) ?? [])].sort((a, b) => compareStrings(a.path, b.path));

    if (groupEntries.length <= 1 && groupOps.length <= 1) {
      // Unambiguous: the op absorbs the entry regardless of raw path.
      const op = groupOps[0];
      const entry = groupEntries[0];
      if (op && entry) {
        pinned.push({ op, entry });
        matchedEntries.add(entry);
      } else if (op) {
        fresh.push(op);
      }
      // entry && !op is handled by the missing sweep below.
    } else {
      // Ambiguous sibling group: match only by exact raw op string.
      const entryByRaw = new Map<string, SurfaceEntry>();
      for (const entry of groupEntries) entryByRaw.set(entry.op, entry);
      for (const op of groupOps) {
        const entry = entryByRaw.get(displayOp(op));
        if (entry) {
          pinned.push({ op, entry });
          matchedEntries.add(entry);
        } else {
          fresh.push(op);
        }
      }
    }
  }

  const names = new Map<string, string>();
  const takenNames = new Set<string>();

  // Pinned names are keyed by identity, so their assignment is order-free.
  // `pinned` was filled in sorted key order, which makes `changedSignatures`
  // order-free as well.
  const changedSignatures: ChangedSignature[] = [];
  for (const { op, entry } of pinned) {
    names.set(displayOp(op), entry.name);
    takenNames.add(entry.name);
    addImpliedTwin(takenNames, op, entry.name);

    if (op.signature !== undefined && op.signature !== entry.signature) {
      changedSignatures.push({
        op: entry.op,
        name: entry.name,
        ...(entry.signature === undefined ? {} : { pinned: entry.signature }),
        current: op.signature,
      });
    }
  }

  // New ops resolve in (normalized key, raw path) order for deterministic accrual.
  fresh.sort((a, b) => {
    const ka = opKey(a.method, a.path);
    const kb = opKey(b.method, b.path);
    return ka !== kb ? compareStrings(ka, kb) : compareStrings(a.path, b.path);
  });
  const newEntries: SurfaceEntry[] = [];
  for (const op of fresh) {
    const name = proposeName(op, takenNames);
    names.set(displayOp(op), name);
    takenNames.add(name);
    addImpliedTwin(takenNames, op, name);
    newEntries.push({
      op: displayOp(op),
      name,
      ...(op.signature === undefined ? {} : { signature: op.signature }),
    });
  }

  // Any manifest entry never matched to an op is missing (the breaking signal).
  // Iterate surfaceEntries in declared order for a stable, order-free result.
  const missing: SurfaceEntry[] = [];
  for (const entry of surfaceEntries) {
    if (matchedEntries.has(entry)) continue;
    if (!OP_PATTERN.test(entry.op)) continue; // malformed ops are rejected by the loader
    missing.push(entry);
  }

  return { names, newEntries, missing, changedSignatures };
}

/** One spec's outcome of resolveSurface, as buildSyncReport takes it. */
export interface SpecResolution {
  specName: string;
  newEntries: SurfaceEntry[];
  missing: SurfaceEntry[];
  changedSignatures: ChangedSignature[];
  /** The manifest has entries for this spec and no spec file was parsed for it. */
  absent: boolean;
}

/**
 * Resolve every parsed spec against the manifest, and account for the manifest
 * keys no parsed spec answers.
 *
 * Resolving only the specs that were parsed used to leave a manifest key with
 * no file under specs/fixed unchecked: its entries were never reported
 * missing, the run was not breaking, and the generator dropped the whole API
 * class from the SDK. Such a key now gets a result whose `missing` is every
 * one of its entries, marked `absent` so the run can say why. A key with no
 * entries has nothing to lose and is passed over.
 *
 * `namesBySpec` holds the parsed specs only, since only they get a class.
 * `perSpec` is sorted by spec name, so neither depends on the order of `specs`.
 */
export function resolveSurface(
  surface: ApiSurface,
  specs: ReadonlyArray<{ specName: string; operations: SurfaceOp[] }>
): { namesBySpec: Map<string, Map<string, string>>; perSpec: SpecResolution[] } {
  const namesBySpec = new Map<string, Map<string, string>>();
  const perSpec: SpecResolution[] = [];
  for (const { specName, operations } of specs) {
    const { names, newEntries, missing, changedSignatures } = resolveMethodNames(
      specName,
      operations,
      surface
    );
    namesBySpec.set(specName, names);
    perSpec.push({ specName, newEntries, missing, changedSignatures, absent: false });
  }
  for (const [specName, entries] of Object.entries(surface.specs)) {
    if (entries.length === 0 || namesBySpec.has(specName)) continue;
    const { newEntries, missing, changedSignatures } = resolveMethodNames(specName, [], surface);
    perSpec.push({ specName, newEntries, missing, changedSignatures, absent: true });
  }
  perSpec.sort((a, b) => compareStrings(a.specName, b.specName));
  return { namesBySpec, perSpec };
}

/**
 * The surface with each changed signature replaced by the current one, and
 * nothing else touched: not a name, not an op, not an entry the changes do not
 * name. This is all `pnpm accept-signatures` does to the manifest. Returns a
 * new surface; the argument is left as it was.
 */
export function acceptSignatures(
  surface: ApiSurface,
  changes: ReadonlyArray<{ specName: string; changedSignatures: readonly ChangedSignature[] }>
): ApiSurface {
  const specs: Record<string, SurfaceEntry[]> = { ...surface.specs };
  for (const { specName, changedSignatures } of changes) {
    if (changedSignatures.length === 0) continue;
    const currentByOp = new Map(changedSignatures.map((c) => [c.op, c.current]));
    specs[specName] = (specs[specName] ?? []).map((entry) => {
      const current = currentByOp.get(entry.op);
      currentByOp.delete(entry.op);
      return current === undefined ? entry : { ...entry, signature: current };
    });
    if (currentByOp.size > 0) {
      fail(
        `cannot accept a signature for ${[...currentByOp.keys()].join(', ')}: ` +
          `spec "${specName}" has no such entry`
      );
    }
  }
  return { version: 1, specs };
}

// ============================================================================
// Run classification (consumed by the workflow via sync-report.json)
// ============================================================================

/**
 * breaking if an operation is missing or a signature changed, else additive if
 * anything is new, else benign. A changed signature shares `breaking` with a
 * missing operation because the consequence is the same: the run stops and a
 * person decides. Whether the change breaks callers is their call to make.
 */
export function classifyRun(input: {
  newEntries: unknown[];
  missing: unknown[];
  changedSignatures?: unknown[];
}): 'benign' | 'additive' | 'breaking' {
  if (input.missing.length > 0) return 'breaking';
  if ((input.changedSignatures ?? []).length > 0) return 'breaking';
  if (input.newEntries.length > 0) return 'additive';
  return 'benign';
}

/**
 * Why a run stops before it writes a class or the manifest, if it does. It
 * lives here, apart from generate-sdk's main(), so that it can be tested:
 * these two answers are what stands between a breaking upstream change and an
 * unattended release.
 *
 * A missing operation stops every run, and so does a spec with no file, whose
 * whole class would disappear. Accepting signatures does not reach that far:
 * a method would disappear, which nothing here approves.
 */
export function stopReasons(
  report: Pick<SyncReport, 'missingOperations' | 'changedSignatures' | 'absentSpecs'>,
  options: { acceptSignatures: boolean }
): { missing: boolean; signatures: boolean } {
  return {
    missing: report.missingOperations.length > 0 || report.absentSpecs.length > 0,
    signatures: report.changedSignatures.length > 0 && !options.acceptSignatures,
  };
}

// ============================================================================
// Sync report (aggregated across specs; serialized to sync-report.json)
// ============================================================================

export interface SyncReportOperation {
  spec: string;
  method: string;
  path: string;
  name: string;
}

export interface SyncReportSignature extends SyncReportOperation {
  /** null when the entry had no signature pinned. */
  pinned: string | null;
  current: string;
}

export interface SyncReport {
  classification: 'benign' | 'additive' | 'breaking';
  newOperations: SyncReportOperation[];
  missingOperations: SyncReportOperation[];
  changedSignatures: SyncReportSignature[];
  /**
   * Specs the manifest has entries for and no file under specs/fixed, sorted.
   * Their entries are in `missingOperations` too; this says why.
   */
  absentSpecs: string[];
}

/**
 * Split an "METHOD /path" display string on its first space. Every op reaching
 * here is either a validated manifest entry or displayOp(op) output, so it is
 * always METHOD, a single space, then a param-bearing path (which never
 * contains a space).
 */
function splitOpDisplay(op: string): { method: string; path: string } {
  const space = op.indexOf(' ');
  return { method: op.slice(0, space), path: op.slice(space + 1) };
}

function compareSyncOps(a: SyncReportOperation, b: SyncReportOperation): number {
  if (a.spec !== b.spec) return compareStrings(a.spec, b.spec);
  if (a.method !== b.method) return compareStrings(a.method, b.method);
  return compareStrings(a.path, b.path);
}

/**
 * Aggregate per-spec resolveMethodNames output into one run-level report.
 * New and missing operations and changed signatures are flattened across
 * specs, each op display string split into method + path, the arrays sorted by
 * (spec, method, path) for deterministic output, and the run classified via
 * classifyRun over the aggregated totals. The workflow consumes this as
 * sync-report.json.
 */
export function buildSyncReport(
  perSpec: Array<{
    specName: string;
    newEntries: SurfaceEntry[];
    missing: SurfaceEntry[];
    changedSignatures?: ChangedSignature[];
    absent?: boolean;
  }>
): SyncReport {
  const newOperations: SyncReportOperation[] = [];
  const missingOperations: SyncReportOperation[] = [];
  const changedSignatures: SyncReportSignature[] = [];
  const absentSpecs: string[] = [];
  for (const {
    specName,
    newEntries,
    missing,
    changedSignatures: changed = [],
    absent = false,
  } of perSpec) {
    if (absent) absentSpecs.push(specName);
    for (const entry of newEntries) {
      const { method, path } = splitOpDisplay(entry.op);
      newOperations.push({ spec: specName, method, path, name: entry.name });
    }
    for (const entry of missing) {
      const { method, path } = splitOpDisplay(entry.op);
      missingOperations.push({ spec: specName, method, path, name: entry.name });
    }
    for (const change of changed) {
      const { method, path } = splitOpDisplay(change.op);
      changedSignatures.push({
        spec: specName,
        method,
        path,
        name: change.name,
        pinned: change.pinned ?? null,
        current: change.current,
      });
    }
  }
  newOperations.sort(compareSyncOps);
  missingOperations.sort(compareSyncOps);
  changedSignatures.sort(compareSyncOps);
  absentSpecs.sort(compareStrings);
  return {
    classification: classifyRun({
      newEntries: newOperations,
      missing: missingOperations,
      changedSignatures,
    }),
    newOperations,
    missingOperations,
    changedSignatures,
    absentSpecs,
  };
}
