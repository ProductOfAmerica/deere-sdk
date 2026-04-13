#!/usr/bin/env tsx
/**
 * Generates src/api-servers.generated.ts from the fixed OpenAPI specs.
 *
 * This file is the single source of truth for URL resolution in v2.0:
 *
 *   specs/fixed/*.yaml  →  src/api-servers.generated.ts  →  DeereClient
 *
 * Classifies each spec into one of four shapes:
 *
 *   1. templated   — servers[0].url contains `{environment}` + enum
 *                    (most specs, after fix-specs normalization)
 *   2. static      — multiple static URLs (equipment-measurement) or a
 *                    single static URL (equipment). Per-env partial map.
 *   3. unavailable — no servers block (notifications) or malformed URL (aemp).
 *                    Runtime throws NoServerConfigError.
 *
 * Applies a conservative env-to-tier classifier for static specs: envs we
 * can't confidently map are OMITTED from the partial map, not defaulted.
 * At runtime, calling an unmapped env throws UnsupportedEnvironmentError
 * before any HTTP call.
 *
 * Usage: pnpm generate-api-servers
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as yaml from 'yaml';

const SPECS_DIR = join(process.cwd(), 'specs', 'fixed');
const OUTPUT_FILE = join(process.cwd(), 'src', 'api-servers.generated.ts');

// ============================================================================
// Types
// ============================================================================

interface OpenAPISpec {
  openapi?: string;
  info?: { title?: string };
  servers?: OpenAPIServer[];
  'x-deere-proxy-info'?: DeereProxyInfo;
}

interface OpenAPIServer {
  url: string;
  description?: string;
  variables?: Record<string, { default?: string; enum?: string[] }>;
}

interface DeereProxyTier {
  enabled?: boolean;
  services?: Array<{ 'service-name'?: string; hostname?: string }>;
}

interface DeereProxyInfo {
  'api-name'?: string;
  qual?: DeereProxyTier;
  cert?: DeereProxyTier;
  prod?: DeereProxyTier;
}

type Tier = 'prod' | 'cert' | 'qual' | 'sandbox';

interface TemplatedConfig {
  kind: 'templated';
  urlTemplate: string;
  supportedEnvironments: string[];
}

interface StaticConfig {
  kind: 'static';
  urlByEnvironment: Record<string, string>;
}

interface UnavailableConfig {
  kind: 'unavailable';
  reason: string;
}

type SpecConfig = TemplatedConfig | StaticConfig | UnavailableConfig;

// ============================================================================
// Conservative env-to-tier classifier
// ============================================================================
//
// Maps each Environment value to a backend tier. Envs we can't confidently
// map are LEFT UNDEFINED — the generator then omits them from the spec's
// urlByEnvironment map, and the runtime resolver throws
// UnsupportedEnvironmentError when a user tries to use them.
//
// Why this is a hardcoded table and not derived: JD's tier model is their
// own convention (qual/cert/prod), not declared in any machine-readable
// form. The only way to map our Environment values to their tiers is to
// encode the mapping explicitly. If JD ever renames a tier or adds one,
// this table is the single place to update.
const ENV_TIER: Record<string, Tier | undefined> = {
  api: 'prod',
  partnerapi: 'prod',
  apicert: 'cert',
  partnerapicert: 'cert',
  'apiqa.tal': 'qual',
  partnerapiqa: 'qual',
  sandboxapiqa: 'qual',
  // sandboxapi is mapped to the 'sandbox' tier, which exists in specs like
  // aemp.yaml that have a `sandbox<name>.deere.com` host. For specs that
  // don't declare a sandbox host (e.g. equipment-measurement's qual/cert/prod
  // trio, or equipment.yaml's single prod host), the sandbox tier has no
  // matching server, so sandboxapi remains unmapped for those specs — same
  // as before, preserving the trust-boundary rule.
  sandboxapi: 'sandbox',
  // DELIBERATELY undefined: apidev.tal has no corresponding tier in any
  // current spec. Users on this env hit UnsupportedEnvironmentError.
  'apidev.tal': undefined,
};

// ============================================================================
// Hostname → tier classifier (for static server URLs)
// ============================================================================

function classifyHostname(hostname: string): Tier {
  const lower = hostname.toLowerCase();
  if (/-cert[.-]/.test(lower) || lower.includes('-cert.')) return 'cert';
  if (/-qual[.-]/.test(lower) || /-qa[.-]/.test(lower) || lower.includes('-qual.')) return 'qual';
  // `sandbox<name>.deere.com` is aemp-style sandbox tier (e.g.
  // `sandboxaemp.deere.com`). Distinct from the prod-class partneraemp.
  if (/^sandbox/.test(lower)) return 'sandbox';
  return 'prod';
}

// ============================================================================
// Spec classification
// ============================================================================

function classifySpec(spec: OpenAPISpec, specName: string): SpecConfig {
  const servers = spec.servers;

  if (!servers || servers.length === 0) {
    return { kind: 'unavailable', reason: `${specName}.yaml has no 'servers' block.` };
  }

  const first = servers[0];
  if (!first?.url || typeof first.url !== 'string') {
    return {
      kind: 'unavailable',
      reason: `${specName}.yaml has an empty or invalid servers[0].url.`,
    };
  }

  // Templated: URL contains `{environment}` and declares the variable enum.
  if (first.url.includes('{environment}')) {
    const envVar = first.variables?.environment;
    const enumValues = Array.isArray(envVar?.enum)
      ? envVar.enum.filter((v): v is string => typeof v === 'string')
      : [];
    if (enumValues.length === 0) {
      return {
        kind: 'unavailable',
        reason: `${specName}.yaml has a templated servers URL but declares no environment enum.`,
      };
    }
    return {
      kind: 'templated',
      urlTemplate: first.url,
      supportedEnvironments: enumValues,
    };
  }

  // Static (single or multi): validate every URL, classify by hostname, and
  // map each Environment to the server whose hostname matches its tier.
  const parsedServers: Array<{ url: string; tier: Tier }> = [];
  for (const server of servers) {
    if (typeof server.url !== 'string') continue;
    // Try to parse as a real URL first. Catches malformed cases like
    // aemp.yaml (two URLs jammed together with literal spaces).
    let hostname: string;
    try {
      hostname = new URL(server.url).hostname;
    } catch {
      return {
        kind: 'unavailable',
        reason: `${specName}.yaml has a malformed servers[].url: ${server.url.slice(0, 80)}...`,
      };
    }
    // Template placeholders after URL validation are unsupported — we expect
    // either `{environment}` (handled above) or a fully-resolved static URL.
    if (server.url.includes('{')) {
      return {
        kind: 'unavailable',
        reason: `${specName}.yaml has a server URL with an unsupported template variable (only {environment} is recognized).`,
      };
    }
    parsedServers.push({ url: server.url, tier: classifyHostname(hostname) });
  }

  if (parsedServers.length === 0) {
    return { kind: 'unavailable', reason: `${specName}.yaml has no parseable servers.` };
  }

  // Build the per-env partial map. For each env we know the tier of, find a
  // server whose hostname classifies into that tier. If none matches, the
  // env is LEFT OUT of the map. Runtime throws on those envs.
  const urlByEnvironment: Record<string, string> = {};
  for (const [envName, tier] of Object.entries(ENV_TIER)) {
    if (tier === undefined) continue; // sandboxapi, apidev.tal — always unmapped
    const match = parsedServers.find((s) => s.tier === tier);
    if (match) {
      urlByEnvironment[envName] = match.url;
    }
  }

  if (Object.keys(urlByEnvironment).length === 0) {
    return {
      kind: 'unavailable',
      reason:
        `${specName}.yaml has static servers but no Environment value matches ` +
        `any of their tiers. Server hostnames: ${parsedServers.map((s) => s.url).join(', ')}`,
    };
  }

  return { kind: 'static', urlByEnvironment };
}

// ============================================================================
// Load + classify all specs
// ============================================================================

interface ClassifiedSpec {
  specName: string;
  config: SpecConfig;
}

function loadAllSpecs(specsDir: string): ClassifiedSpec[] {
  const files = readdirSync(specsDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const results: ClassifiedSpec[] = [];

  for (const file of files) {
    const specName = basename(file, '.yaml');
    let spec: OpenAPISpec;
    try {
      spec = yaml.parse(readFileSync(join(specsDir, file), 'utf-8')) as OpenAPISpec;
    } catch (e) {
      results.push({
        specName,
        config: { kind: 'unavailable', reason: `${specName}.yaml failed to parse: ${e}` },
      });
      continue;
    }
    results.push({ specName, config: classifySpec(spec, specName) });
  }

  return results;
}

// ============================================================================
// Collect the Environment union from templated specs
// ============================================================================

function collectEnvironmentUnion(classified: ClassifiedSpec[]): string[] {
  const seen = new Set<string>();
  for (const { config } of classified) {
    if (config.kind === 'templated') {
      for (const env of config.supportedEnvironments) seen.add(env);
    }
    if (config.kind === 'static') {
      for (const env of Object.keys(config.urlByEnvironment)) seen.add(env);
    }
  }
  // Also include the unmapped-by-design envs so the Environment type still
  // covers them — the resolver then throws UnsupportedEnvironmentError when
  // a user picks one on an API whose spec omits them.
  for (const env of Object.keys(ENV_TIER)) seen.add(env);

  // Production-first ordering for cosmetics and stability.
  const canonical = [
    'api',
    'sandboxapi',
    'partnerapi',
    'apicert',
    'apiqa.tal',
    'partnerapicert',
    'partnerapiqa',
    'sandboxapiqa',
    'apidev.tal',
  ];
  const ordered: string[] = [];
  for (const env of canonical) {
    if (seen.has(env)) {
      ordered.push(env);
      seen.delete(env);
    }
  }
  // Any stragglers (future regions JD adds) go at the end in sorted order.
  ordered.push(...[...seen].sort());
  return ordered;
}

// ============================================================================
// Coverage matrix (for the generated-file header comment)
// ============================================================================

function buildCoverageMatrix(classified: ClassifiedSpec[], envs: string[]): string {
  const specNameWidth = Math.max(...classified.map((c) => c.specName.length), 20);
  const envWidths = envs.map((e) => Math.max(e.length, 3));

  const header =
    ' '.repeat(specNameWidth + 2) + envs.map((e, i) => e.padEnd(envWidths[i])).join('  ');

  const rows = classified.map((c) => {
    const name = c.specName.padEnd(specNameWidth);
    const cells = envs.map((e, i) => {
      let mark = '-';
      if (c.config.kind === 'templated') {
        mark = c.config.supportedEnvironments.includes(e) ? 'X' : '-';
      } else if (c.config.kind === 'static') {
        mark = c.config.urlByEnvironment[e] ? 'X' : '-';
      }
      return mark.padEnd(envWidths[i]);
    });
    return ` ${name}  ${cells.join('  ')}`;
  });

  return [
    ' * Env coverage matrix (X = supported, - = throws UnsupportedEnvironmentError):',
    ' *',
    ` *${header}`,
    ...rows.map((r) => ` *${r}`),
  ].join('\n');
}

// ============================================================================
// Emitter
// ============================================================================

function emitFile(classified: ClassifiedSpec[], envs: string[]): string {
  const specNames = classified.map((c) => c.specName);
  const timestamp = new Date().toISOString();

  const coverageMatrix = buildCoverageMatrix(classified, envs);

  const specNameUnion = specNames.map((n) => `  | '${n}'`).join('\n');
  const envUnion = envs.map((e) => `  | '${e}'`).join('\n');
  const envListArray = envs.map((e) => `  '${e}',`).join('\n');

  // Emit each spec's config. Quote keys that contain dots (e.g. 'apiqa.tal')
  // or hyphens (e.g. 'equipment-measurement').
  const apiServersEntries = classified.map((c) => emitSpecEntry(c)).join('\n');

  return `/**
 * API server configuration per spec — single source of truth for URL resolution.
 *
 * @generated by scripts/generate-api-servers.ts — do not edit manually
 * Last generated: ${timestamp}
 *
${coverageMatrix}
 *
 * A dash (-) means the env is NOT supported for that spec. Calling a method
 * on that API with that env throws UnsupportedEnvironmentError at request
 * time, before any HTTP call — no silent cross-tier routing.
 */

// ============================================================================
// SpecName — literal union of every OpenAPI spec in specs/fixed/
// ============================================================================

export type SpecName =
${specNameUnion};

// ============================================================================
// Environment — union of every subdomain seen across templated specs, plus
// the conservatively-unmapped envs so the type covers them (the resolver
// throws UnsupportedEnvironmentError on unmapped envs per spec).
// ============================================================================

export type Environment =
${envUnion};

export const KNOWN_ENVIRONMENTS: readonly Environment[] = [
${envListArray}
] as const;

/**
 * Default environment for new DeereClient instances when config.environment
 * is not specified. 'sandboxapi' is safe-by-default — never silently hits
 * production data.
 */
export const DEFAULT_ENVIRONMENT: Environment = 'sandboxapi';

// ============================================================================
// SpecServerConfig — per-spec URL resolution config
// ============================================================================

export type SpecServerConfig =
  | {
      kind: 'templated';
      /** URL template with \`{environment}\` placeholder. */
      urlTemplate: string;
      /** Envs declared in the spec's servers.variables.environment.enum. */
      supportedEnvironments: readonly Environment[];
    }
  | {
      kind: 'static';
      /**
       * PARTIAL map — envs we can't confidently serve are OMITTED. Runtime
       * throws UnsupportedEnvironmentError on missing keys. See
       * scripts/generate-api-servers.ts for the env-to-tier classifier.
       */
      urlByEnvironment: Readonly<Partial<Record<Environment, string>>>;
    }
  | {
      kind: 'unavailable';
      /** Human-readable explanation for diagnostics. */
      reason: string;
    };

// ============================================================================
// API_SERVERS — the resolver's lookup table, keyed by spec name
// ============================================================================

export const API_SERVERS: Record<SpecName, SpecServerConfig> = {
${apiServersEntries}
};
`;
}

function emitSpecEntry({ specName, config }: ClassifiedSpec): string {
  const key = needsQuotes(specName) ? `'${specName}'` : specName;

  if (config.kind === 'unavailable') {
    return `  ${key}: {
    kind: 'unavailable',
    reason: ${JSON.stringify(config.reason)},
  },`;
  }

  if (config.kind === 'templated') {
    const envs = config.supportedEnvironments.map((e) => `'${e}'`).join(', ');
    return `  ${key}: {
    kind: 'templated',
    urlTemplate: '${config.urlTemplate}',
    supportedEnvironments: [${envs}],
  },`;
  }

  // static
  const urlEntries = Object.entries(config.urlByEnvironment)
    .map(([env, url]) => {
      const envKey = needsQuotes(env) ? `'${env}'` : env;
      return `      ${envKey}: '${url}',`;
    })
    .join('\n');
  return `  ${key}: {
    kind: 'static',
    urlByEnvironment: {
${urlEntries}
    },
  },`;
}

function needsQuotes(identifier: string): boolean {
  return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(identifier);
}

// ============================================================================
// Coverage summary printer
// ============================================================================

function printCoverageSummary(classified: ClassifiedSpec[], envs: string[]): void {
  let templated = 0;
  let staticFull = 0;
  const staticPartial: Array<{ specName: string; missing: string[] }> = [];
  const unavailable: Array<{ specName: string; reason: string }> = [];

  for (const { specName, config } of classified) {
    if (config.kind === 'templated') {
      templated++;
    } else if (config.kind === 'static') {
      const missing = envs.filter((e) => !config.urlByEnvironment[e]);
      if (missing.length === 0) {
        staticFull++;
      } else {
        staticPartial.push({ specName, missing });
      }
    } else {
      unavailable.push({ specName, reason: config.reason });
    }
  }

  console.log(`\nGenerated API_SERVERS: ${classified.length} specs, ${envs.length} environments.`);
  console.log(`  Templated: ${templated} specs`);
  console.log(`  Static (full coverage): ${staticFull} specs`);
  if (staticPartial.length > 0) {
    console.log(
      `  Static (partial coverage): ${staticPartial.length} spec${staticPartial.length > 1 ? 's' : ''}`
    );
    for (const { specName, missing } of staticPartial) {
      console.log(`    ${specName} omits: ${missing.join(', ')}`);
      console.log(`      (these envs throw UnsupportedEnvironmentError at request time)`);
    }
  }
  if (unavailable.length > 0) {
    console.log(`  Unavailable: ${unavailable.length} spec${unavailable.length > 1 ? 's' : ''}`);
    for (const { specName, reason } of unavailable) {
      console.log(`    ${specName}: ${reason}`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log('Generating api-servers.generated.ts from OpenAPI specs...');

  const classified = loadAllSpecs(SPECS_DIR);
  if (classified.length === 0) {
    console.error(`No specs found in ${SPECS_DIR}`);
    process.exit(1);
  }

  const envs = collectEnvironmentUnion(classified);
  const output = emitFile(classified, envs);

  writeFileSync(OUTPUT_FILE, output);
  console.log(`Wrote ${OUTPUT_FILE}`);

  printCoverageSummary(classified, envs);
}

main();
