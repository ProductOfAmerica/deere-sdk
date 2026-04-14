#!/usr/bin/env tsx
/**
 * Loader + types for scripts/embed-contracts.yaml.
 *
 * The registry encodes places where John Deere's published OpenAPI spec omits
 * response fields that their real API actually returns when specific query
 * params are set. Each entry is consumed by scripts/fix-specs.ts's
 * applyEmbedContracts() transform and patched into the fixed spec BEFORE
 * openapi-typescript runs, so generated types match reality.
 *
 * This file is the SINGLE source of truth for the set of patch operations the
 * registry can describe. Adding a new operation type requires a matching
 * TypeScript variant here AND a matching handler in applyEmbedContracts().
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';

/** Sentinel stamped on every schema this registry touches. Used for idempotence
 *  across `pnpm generate` re-runs and for drift detection (if JD ever documents
 *  the field themselves, the patcher aborts instead of silently re-applying). */
export const EMBED_CONTRACT_SENTINEL = 'x-embed-contract-applied';

/** A raw OpenAPI schema fragment. Stored as `unknown` because the shape varies
 *  per entry; applyEmbedContracts() merges it in verbatim. */
export type OpenApiSchemaFragment = Record<string, unknown>;

export interface AddPropertyPatch {
  op: 'addProperty';
  /** Schema name in `components.schemas` to inject the property onto. */
  target: string;
  /** Property name to add. */
  property: string;
  /** The OpenAPI schema fragment for the property's value. */
  schema: OpenApiSchemaFragment;
}

export interface AddSchemaPatch {
  op: 'addSchema';
  /** Schema name for `components.schemas[name]`. */
  name: string;
  /** The OpenAPI schema fragment for the new schema's definition. */
  schema: OpenApiSchemaFragment;
}

export type Patch = AddPropertyPatch | AddSchemaPatch;

export interface EmbedVariant {
  patches: Patch[];
}

export interface EmbedContract {
  /** Spec name matching specs/fixed/{spec}.yaml (minus the .yaml). */
  spec: string;
  /** Operation path template (for documentation; not used by the patcher). */
  path: string;
  /** HTTP method (for documentation; not used by the patcher). */
  method: string;
  /** Query parameter name that triggers the variant (for documentation). */
  embedParam: string;
  /** Response item schema name (for documentation — the target schema is
   *  specified per-patch). */
  responseItemSchema: string;
  /** Map of embed value → patches to apply. */
  variants: Record<string, EmbedVariant>;
}

const REGISTRY_PATH = join(process.cwd(), 'scripts', 'embed-contracts.yaml');

function fail(prefix: string, detail: string): never {
  throw new Error(`embed-contracts: ${prefix}: ${detail}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePatch(patch: unknown, entryPrefix: string): Patch {
  if (!isObject(patch)) {
    fail(entryPrefix, `patch must be an object, got ${typeof patch}`);
  }
  const op = patch.op;
  if (op === 'addProperty') {
    if (typeof patch.target !== 'string' || !patch.target) {
      fail(entryPrefix, 'addProperty: `target` must be a non-empty string');
    }
    if (typeof patch.property !== 'string' || !patch.property) {
      fail(entryPrefix, 'addProperty: `property` must be a non-empty string');
    }
    if (!isObject(patch.schema)) {
      fail(entryPrefix, 'addProperty: `schema` must be an object');
    }
    return {
      op: 'addProperty',
      target: patch.target,
      property: patch.property,
      schema: patch.schema,
    };
  }
  if (op === 'addSchema') {
    if (typeof patch.name !== 'string' || !patch.name) {
      fail(entryPrefix, 'addSchema: `name` must be a non-empty string');
    }
    if (!isObject(patch.schema)) {
      fail(entryPrefix, 'addSchema: `schema` must be an object');
    }
    return { op: 'addSchema', name: patch.name, schema: patch.schema };
  }
  fail(
    entryPrefix,
    `unknown op "${String(op)}"; known ops are: addProperty, addSchema. Update scripts/embed-contracts.ts to add a new variant AND a handler in applyEmbedContracts().`
  );
}

function validateVariant(variant: unknown, entryPrefix: string): EmbedVariant {
  if (!isObject(variant)) {
    fail(entryPrefix, `variant must be an object, got ${typeof variant}`);
  }
  if (!Array.isArray(variant.patches)) {
    fail(entryPrefix, '`patches` must be an array');
  }
  const patches = variant.patches.map((p, i) => validatePatch(p, `${entryPrefix} patch[${i}]`));
  return { patches };
}

function validateEntry(entry: unknown, index: number): EmbedContract {
  const entryPrefix = `entry[${index}]`;
  if (!isObject(entry)) {
    fail(entryPrefix, `must be an object, got ${typeof entry}`);
  }
  const required = ['spec', 'path', 'method', 'embedParam', 'responseItemSchema'] as const;
  for (const key of required) {
    if (typeof entry[key] !== 'string' || !entry[key]) {
      fail(entryPrefix, `missing or invalid required field "${key}"`);
    }
  }
  if (!isObject(entry.variants)) {
    fail(entryPrefix, '`variants` must be an object');
  }
  const variants: Record<string, EmbedVariant> = {};
  for (const [variantName, variantValue] of Object.entries(entry.variants)) {
    variants[variantName] = validateVariant(
      variantValue,
      `${entryPrefix} variant "${variantName}"`
    );
  }
  return {
    spec: entry.spec as string,
    path: entry.path as string,
    method: entry.method as string,
    embedParam: entry.embedParam as string,
    responseItemSchema: entry.responseItemSchema as string,
    variants,
  };
}

/**
 * Load and validate scripts/embed-contracts.yaml.
 *
 * Throws with a clear message on:
 * - Registry file not found on disk
 * - Malformed YAML
 * - Missing or invalid required fields on any entry
 * - Unknown `op` value on any patch
 *
 * @param path Optional override for the registry file path (used by tests).
 */
export function loadEmbedContracts(path: string = REGISTRY_PATH): EmbedContract[] {
  if (!existsSync(path)) {
    fail(
      'load',
      `registry file missing at ${path}. Did pnpm install complete? If you moved the file, update REGISTRY_PATH in scripts/embed-contracts.ts.`
    );
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    fail('load', `failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch (e) {
    fail('load', `malformed YAML in ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) {
    fail('load', `top-level value in ${path} must be an array, got ${typeof parsed}`);
  }
  return parsed.map(validateEntry);
}

/**
 * Filter loaded contracts to those matching a given spec name. Called by
 * applyEmbedContracts() to pick the relevant entries for the current spec.
 */
export function contractsForSpec(contracts: EmbedContract[], specName: string): EmbedContract[] {
  return contracts.filter((c) => c.spec === specName);
}

// ---------------------------------------------------------------------------
// Patcher — consumed by scripts/fix-specs.ts inside fixSpec().
// Operates on the already-parsed, already-partially-fixed spec object in place.
// ---------------------------------------------------------------------------

function patchPrefix(specName: string, variantName: string, index: number): string {
  return `${specName} variant "${variantName}" patch[${index}]`;
}

function applyAddProperty(
  spec: Record<string, unknown>,
  patch: AddPropertyPatch,
  prefix: string
): void {
  const components = spec.components as Record<string, unknown> | undefined;
  const schemas = components?.schemas as Record<string, Record<string, unknown>> | undefined;
  if (!schemas) {
    throw new Error(`${prefix}: spec has no components.schemas block to patch`);
  }
  const target = schemas[patch.target];
  if (!target) {
    throw new Error(
      `${prefix}: target schema "${patch.target}" not found in components.schemas. ` +
        `This is either a typo in scripts/embed-contracts.yaml or JD removed/renamed the schema. ` +
        `Remediation: grep specs/fixed/ for "${patch.target}", fix the registry, re-run pnpm generate.`
    );
  }
  const props = (target.properties as Record<string, unknown> | undefined) ?? {};
  if (patch.property in props) {
    if (target[EMBED_CONTRACT_SENTINEL] === true) {
      // Already patched by an earlier contract in this run — idempotent skip.
      return;
    }
    throw new Error(
      `${prefix}: property "${patch.property}" already exists on ${patch.target} without the embed-contract sentinel. ` +
        `This means JD now declares the field themselves; the registry entry is stale. ` +
        `Remediation: remove this patch from scripts/embed-contracts.yaml and re-run pnpm generate.`
    );
  }
  props[patch.property] = patch.schema;
  target.properties = props;
  target[EMBED_CONTRACT_SENTINEL] = true;
}

function applyAddSchema(
  spec: Record<string, unknown>,
  patch: AddSchemaPatch,
  prefix: string
): void {
  const components = (spec.components as Record<string, unknown> | undefined) ?? {};
  spec.components = components;
  const schemas = (components.schemas as Record<string, Record<string, unknown>> | undefined) ?? {};
  components.schemas = schemas;
  const existing = schemas[patch.name];
  if (existing) {
    if (existing[EMBED_CONTRACT_SENTINEL] === true) {
      // Already injected by an earlier contract in this run — idempotent skip.
      return;
    }
    throw new Error(
      `${prefix}: schema "${patch.name}" already exists in components.schemas without the embed-contract sentinel. ` +
        `This means JD now declares it themselves; the registry entry is stale. ` +
        `Remediation: remove this addSchema patch from scripts/embed-contracts.yaml and re-run pnpm generate.`
    );
  }
  schemas[patch.name] = { ...patch.schema, [EMBED_CONTRACT_SENTINEL]: true };
}

/**
 * Apply every patch in every variant of every contract matching this spec.
 *
 * Idempotent within a single `pnpm generate` run (double-patches on the same
 * target within one run are no-ops). Aborts loudly on any collision with an
 * unmarked existing property or schema (drift detection — JD may have
 * documented the field themselves).
 *
 * @param spec The parsed spec object to mutate in place. After this call,
 *             `spec.components.schemas[target].properties[property]` will exist
 *             for every `addProperty` patch, and `spec.components.schemas[name]`
 *             will exist for every `addSchema` patch, each stamped with
 *             `x-embed-contract-applied: true`.
 * @param specName The spec name without extension (e.g. "field-operations-api").
 *                 Must match the `spec` field of the registry entry.
 * @param contracts The loaded registry. Usually from `loadEmbedContracts()`.
 *
 * @returns Number of patches applied (0 if the spec has no matching contracts).
 */
export function applyEmbedContracts(
  spec: Record<string, unknown>,
  specName: string,
  contracts: EmbedContract[]
): number {
  const matching = contractsForSpec(contracts, specName);
  if (matching.length === 0) return 0;

  let applied = 0;
  for (const contract of matching) {
    for (const [variantName, variant] of Object.entries(contract.variants)) {
      for (let i = 0; i < variant.patches.length; i++) {
        const patch = variant.patches[i];
        const prefix = patchPrefix(specName, variantName, i);
        switch (patch.op) {
          case 'addProperty':
            applyAddProperty(spec, patch, prefix);
            break;
          case 'addSchema':
            applyAddSchema(spec, patch, prefix);
            break;
          default: {
            // Exhaustiveness check — if a new Patch variant is added to the
            // type union without a handler here, TypeScript will flag this.
            const _exhaustive: never = patch;
            throw new Error(
              `${prefix}: unreachable — unhandled patch variant ${JSON.stringify(_exhaustive)}`
            );
          }
        }
        applied++;
      }
    }
  }
  return applied;
}
