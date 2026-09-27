/**
 * Loader + validation for scripts/routing-overrides.yaml.
 *
 * Records the places where John Deere's published spec states the wrong base
 * URL for an operation, or states none at all. Every entry must carry dated
 * evidence, because the whole reason this file exists is that the pipeline
 * used to manufacture routing data and present it downstream as spec-derived
 * truth:
 *
 *   - fix-specs invented a `/platform` servers block for any spec declaring
 *     none, and `API_SERVERS` then reported `kind: 'templated'` with full
 *     confidence. For notifications that guess is wrong for one of four paths.
 *   - An endpoint injected in 2026-01 on a real but unrecorded observation
 *     (OrganizationsApi.listUsers) 404'd for months before anyone noticed,
 *     because nothing wrote down why it was there and nothing watched it.
 *
 * A value in this file is not more true than a guess because it is committed.
 * It is more true because `evidence:` says how it was measured and when, so
 * the next person can re-check it instead of inheriting it.
 *
 * Every failure throws. A malformed registry is a config error, not a data
 * problem to route around, so there is no partial load and no default.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { isRecord } from './spec-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface PathRoutingOverride {
  /** OpenAPI path pattern, exactly as it appears in the spec's `paths`. */
  pattern: string;
  /** Templated server URL this path is really served from. */
  urlTemplate: string;
  evidence: string;
}

export interface SpecRoutingOverride {
  spec: string;
  /**
   * Spec-level server URL, for a spec that declares none upstream. Null when
   * the spec declares its own and only individual paths are overridden.
   */
  urlTemplate: string | null;
  /** Required when `urlTemplate` is set or divergence is acknowledged. */
  evidence: string | null;
  /**
   * Lets mergeSpecDocs proceed when this slug's documents declare genuinely
   * different server families. Without it the merge refuses and demands a
   * human, which is the correct default: silently collapsing divergent
   * servers is how `products` shipped a 404 for GET /activeIngredients.
   */
  acknowledgedDivergentServers: boolean;
  paths: PathRoutingOverride[];
}

export interface RoutingOverrides {
  version: 1;
  /** Sorted by spec name, so iteration order is stable across platforms. */
  specs: SpecRoutingOverride[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OVERRIDES_PATH = join(process.cwd(), 'scripts', 'routing-overrides.yaml');

const KEBAB_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Overrides must be templated, so one entry covers every environment and
 * cannot silently pin a caller to the wrong tier. Both known cases are
 * templated; add the static form when something actually needs it.
 */
const TEMPLATED_URL_PATTERN = /^https:\/\/\{environment\}\.deere\.com(\/[a-z0-9-]+)*$/;

/**
 * Enough evidence to re-check the claim later. The failure this prevents is a
 * bare assertion like "// undocumented but working", which is exactly what
 * left a 404 in the public API for months.
 */
const MIN_EVIDENCE_LENGTH = 40;

function fail(detail: string): never {
  throw new Error(`routing-overrides: ${detail}`);
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
 * Load and validate scripts/routing-overrides.yaml.
 *
 * Throws on: missing or unreadable file, unparseable YAML, `version !== 1`,
 * non-mapping `specs`, a spec name outside /^[a-z0-9]+(-[a-z0-9]+)*$/, a
 * server URL that is not a templated deere.com https URL, a path pattern not
 * starting with '/', a non-boolean acknowledgement, an entry that overrides
 * something without evidence, evidence shorter than 40 characters, and a spec
 * entry that overrides nothing at all.
 *
 * @param filePath Optional override for the registry path (used by tests).
 */
export function loadRoutingOverrides(filePath: string = DEFAULT_OVERRIDES_PATH): RoutingOverrides {
  if (!existsSync(filePath)) {
    fail(
      `overrides file missing at ${filePath}. scripts/routing-overrides.yaml is committed ` +
        `and version-controlled; restore it from git history rather than re-deriving it. ` +
        `Re-deriving would discard the measured evidence behind every entry, which is the ` +
        `only thing separating these values from the guesses they replaced.`
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
  return validateRoutingOverrides(parsed, filePath);
}

export function validateRoutingOverrides(parsed: unknown, filePath: string): RoutingOverrides {
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

  const specEntries = parsed.specs;
  const specs = Object.keys(specEntries).map((name) => validateSpec(name, specEntries[name]));
  specs.sort((a, b) => (a.spec < b.spec ? -1 : a.spec > b.spec ? 1 : 0));
  return { version: 1, specs };
}

function validateSpec(name: string, value: unknown): SpecRoutingOverride {
  const where = `spec ${JSON.stringify(name)}`;

  if (!KEBAB_PATTERN.test(name)) {
    fail(`${where}: spec name must match /^[a-z0-9]+(-[a-z0-9]+)*$/`);
  }
  if (!isRecord(value)) {
    fail(`${where} must be a mapping, got ${describeType(value)}`);
  }

  const { servers, evidence, acknowledgedDivergentServers, paths } = value;

  let urlTemplate: string | null = null;
  if (servers !== undefined) {
    if (typeof servers !== 'string' || !TEMPLATED_URL_PATTERN.test(servers)) {
      fail(
        `${where}: "servers" must be a templated deere.com https URL such as ` +
          `"https://{environment}.deere.com/platform", got ${JSON.stringify(servers)}. ` +
          `A non-templated URL would pin every environment to one tier.`
      );
    }
    urlTemplate = servers;
  }

  let acknowledged = false;
  if (acknowledgedDivergentServers !== undefined) {
    if (typeof acknowledgedDivergentServers !== 'boolean') {
      fail(
        `${where}: "acknowledgedDivergentServers" must be a boolean, got ${describeType(acknowledgedDivergentServers)}`
      );
    }
    acknowledged = acknowledgedDivergentServers;
  }

  const pathOverrides = validatePaths(where, paths);

  if (urlTemplate === null && !acknowledged && pathOverrides.length === 0) {
    fail(
      `${where} overrides nothing: it declares no "servers", no "paths", and no ` +
        `"acknowledgedDivergentServers". Delete the entry rather than leaving an empty one, ` +
        `which reads as a recorded decision but changes nothing.`
    );
  }

  // Spec-level evidence justifies the spec-level claims. A path-only entry
  // carries its evidence on each path instead.
  const needsSpecEvidence = urlTemplate !== null || acknowledged;
  const specEvidence = validateEvidence(where, evidence, needsSpecEvidence);

  return {
    spec: name,
    urlTemplate,
    evidence: specEvidence,
    acknowledgedDivergentServers: acknowledged,
    paths: pathOverrides,
  };
}

function validatePaths(where: string, paths: unknown): PathRoutingOverride[] {
  if (paths === undefined) return [];
  if (!isRecord(paths)) {
    fail(
      `${where}: "paths" must be a mapping of path pattern to override, got ${describeType(paths)}`
    );
  }

  const result: PathRoutingOverride[] = [];
  for (const pattern of Object.keys(paths)) {
    const at = `${where} path ${JSON.stringify(pattern)}`;
    if (!pattern.startsWith('/')) {
      fail(`${at}: path pattern must start with "/"`);
    }
    const entry = paths[pattern];
    if (!isRecord(entry)) {
      fail(`${at} must be a mapping with "servers" and "evidence", got ${describeType(entry)}`);
    }
    const { servers } = entry;
    if (typeof servers !== 'string' || !TEMPLATED_URL_PATTERN.test(servers)) {
      fail(
        `${at}: "servers" must be a templated deere.com https URL, got ${JSON.stringify(servers)}`
      );
    }
    const evidence = validateEvidence(at, entry.evidence, true);
    if (evidence === null) {
      fail(`${at}: internal error, required evidence resolved to null`);
    }
    result.push({ pattern, urlTemplate: servers, evidence });
  }
  result.sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
  return result;
}

function validateEvidence(where: string, evidence: unknown, required: boolean): string | null {
  if (evidence === undefined) {
    if (!required) return null;
    fail(
      `${where}: an override needs "evidence" describing how it was measured and when. ` +
        `An unattributed override is the guess it was meant to replace.`
    );
  }
  if (typeof evidence !== 'string' || evidence.trim().length < MIN_EVIDENCE_LENGTH) {
    fail(
      `${where}: "evidence" must be a string of at least ${MIN_EVIDENCE_LENGTH} characters ` +
        `naming what was observed and on what date, got ${JSON.stringify(evidence)}`
    );
  }
  return evidence;
}

// ============================================================================
// Accessors
// ============================================================================

export function findSpecOverride(
  overrides: RoutingOverrides,
  specName: string
): SpecRoutingOverride | undefined {
  return overrides.specs.find((entry) => entry.spec === specName);
}
