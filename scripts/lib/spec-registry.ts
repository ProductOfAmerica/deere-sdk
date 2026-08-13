/**
 * Loader + validation for scripts/spec-registry.yaml.
 *
 * The registry answers three questions the pipeline previously had no way to
 * ask: which specs exist, where the portal currently serves each one, and
 * which of them are knowingly not being refreshed.
 *
 * Before it, a fetch failure was not a state. `fetch-specs` returned null,
 * printed "Not found", and exited 0, so a spec could silently freeze while the
 * nightly sync reported success. `notifications` did exactly that for three
 * months. The registry makes an unrefreshed spec either a build failure or an
 * explicit, reasoned, committed decision, and nothing in between.
 *
 * Every failure here throws. A malformed registry is a config error, not a
 * data problem to route around, so there is no partial load and no default.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { isRecord } from './spec-utils.js';

// ============================================================================
// Types
// ============================================================================

/** Why a spec is deliberately not being refreshed, and since when. */
export interface FrozenState {
  reason: string;
  /** ISO calendar date, YYYY-MM-DD. */
  since: string;
}

export interface SpecRegistryEntry {
  /**
   * The internal spec name. Names specs/raw/<name>.yaml, the generated *Api
   * class, and the public `SpecName` literal. Never tracks an upstream rename.
   */
  name: string;
  /** Path segment the portal currently serves this spec under. */
  slug: string;
  /**
   * Recorded api_id. A GUARD, never an identity key: the portal reuses one
   * api_id across unrelated APIs (products and service-data-products both
   * report 5cedab22-e2f6-4d23-b5c5-9cc8b6b86122, measured 2026-08-13). A
   * mismatch proves a slug now serves something else; a match proves nothing.
   * See the warning block in scripts/spec-registry.yaml.
   */
  apiId: string;
  /** Null when the spec is active, i.e. it must fetch and validate. */
  frozen: FrozenState | null;
}

export interface SpecRegistry {
  version: 1;
  /** Sorted by name, so iteration order is stable across platforms. */
  entries: SpecRegistryEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REGISTRY_PATH = join(process.cwd(), 'scripts', 'spec-registry.yaml');

/**
 * Lowercase kebab. Applied to both the spec name and the slug because the name
 * becomes a filename (specs/raw/<name>.yaml) and the slug is interpolated into
 * a fetch URL, so neither may carry a path separator, a traversal sequence, or
 * anything needing escaping.
 */
const KEBAB_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(detail: string): never {
  throw new Error(`spec-registry: ${detail}`);
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
 * Load and validate scripts/spec-registry.yaml.
 *
 * Throws with a remediation-bearing message on: missing file, unreadable file,
 * unparseable YAML, `version !== 1`, non-mapping or empty `specs`, a spec name
 * or slug outside /^[a-z0-9]+(-[a-z0-9]+)*$/, a missing or malformed `apiId`,
 * a `status` other than "frozen", a frozen entry missing `reason` or `since`,
 * a `since` that is not a real YYYY-MM-DD date, a non-frozen entry carrying
 * `reason` or `since`, or two specs claiming the same slug.
 *
 * @param filePath Optional override for the registry path (used by tests).
 */
export function loadSpecRegistry(filePath: string = DEFAULT_REGISTRY_PATH): SpecRegistry {
  if (!existsSync(filePath)) {
    fail(
      `registry file missing at ${filePath}. scripts/spec-registry.yaml is committed and ` +
        `version-controlled; restore it from git history (for example, ` +
        `git restore --source <ref> scripts/spec-registry.yaml) rather than re-deriving it. ` +
        `Re-deriving would silently drop every freeze decision recorded in it, which is ` +
        `exactly the silent staleness the registry exists to prevent.`
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
  return validateRegistry(parsed, filePath);
}

export function validateRegistry(parsed: unknown, filePath: string): SpecRegistry {
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
      `"specs" in ${filePath} must be a mapping of specName to entry, got ${describeType(parsed.specs)}`
    );
  }

  const names = Object.keys(parsed.specs);
  if (names.length === 0) {
    fail(
      `"specs" in ${filePath} is empty. An empty registry would fetch nothing and report ` +
        `success, which is the failure mode this file exists to make impossible.`
    );
  }

  const entries: SpecRegistryEntry[] = [];
  const slugOwners = new Map<string, string>();

  for (const name of names) {
    const entry = validateEntry(name, parsed.specs[name]);
    const existingOwner = slugOwners.get(entry.slug);
    if (existingOwner !== undefined) {
      fail(
        `specs ${JSON.stringify(existingOwner)} and ${JSON.stringify(name)} both claim slug ` +
          `${JSON.stringify(entry.slug)}. Two internal spec names fetching one portal document ` +
          `would overwrite each other's raw file; give each spec its own slug.`
      );
    }
    slugOwners.set(entry.slug, name);
    entries.push(entry);
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: 1, entries };
}

function validateEntry(name: string, value: unknown): SpecRegistryEntry {
  const where = `spec ${JSON.stringify(name)}`;

  if (!KEBAB_PATTERN.test(name)) {
    fail(
      `${where}: spec name must match /^[a-z0-9]+(-[a-z0-9]+)*$/. It becomes the filename ` +
        `specs/raw/<name>.yaml, so it may not contain a path separator or any character ` +
        `needing escaping.`
    );
  }
  if (!isRecord(value)) {
    fail(`${where} must be a mapping with "slug" and "apiId", got ${describeType(value)}`);
  }

  const { slug, apiId, status, reason, since } = value;

  if (typeof slug !== 'string' || !KEBAB_PATTERN.test(slug)) {
    fail(
      `${where}: "slug" must be a string matching /^[a-z0-9]+(-[a-z0-9]+)*$/, got ` +
        `${JSON.stringify(slug)}. It is interpolated into the portal fetch URL.`
    );
  }
  if (typeof apiId !== 'string' || !UUID_PATTERN.test(apiId)) {
    fail(
      `${where}: "apiId" must be a lowercase UUID, got ${JSON.stringify(apiId)}. Record the ` +
        `api_id the portal returns for this slug; it is compared against future fetches to ` +
        `detect a slug that has started serving a different API.`
    );
  }

  if (status === undefined) {
    if (reason !== undefined || since !== undefined) {
      fail(
        `${where}: "reason"/"since" are only meaningful with "status: frozen". An active spec ` +
          `carrying a freeze reason reads as frozen but is not, so the run would fetch it and ` +
          `fail on the very condition the reason documents.`
      );
    }
    return { name, slug, apiId, frozen: null };
  }

  if (status !== 'frozen') {
    fail(
      `${where}: "status" must be "frozen" when present, got ${JSON.stringify(status)}. Omit ` +
        `it entirely for an active spec; there is no explicit "active" value.`
    );
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    fail(
      `${where}: a frozen spec must carry a non-empty "reason". A freeze with no stated cause ` +
        `cannot be evaluated for lifting, and becomes permanent by default.`
    );
  }
  if (typeof since !== 'string' || !isRealIsoDate(since)) {
    fail(
      `${where}: a frozen spec must carry "since" as a real YYYY-MM-DD date, got ` +
        `${JSON.stringify(since)}. Derive it from evidence (git history of ` +
        `specs/raw/summary.json, a portal change), not from when the freeze was written down.`
    );
  }

  return { name, slug, apiId, frozen: { reason, since } };
}

/** True for a YYYY-MM-DD string that names a date that actually exists. */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  // Round-trip through Date to reject 2026-02-30 and friends, which the
  // pattern alone accepts.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
