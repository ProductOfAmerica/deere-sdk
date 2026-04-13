#!/usr/bin/env tsx
/**
 * Fixes broken John Deere OpenAPI specs so they can be parsed by openapi-typescript.
 *
 * Common issues in John Deere specs:
 * 1. Missing $ref targets - schemas referenced but never defined
 * 2. Invalid types - "GUID", "datetime", "Asset array" instead of standard types
 * 3. Invalid fields - "contentType", "note", "headers" at wrong level
 * 4. `required` as boolean instead of array
 *
 * Usage: pnpm fix-specs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { isDocumentationKey, sanitizePropertyKey } from './lib/spec-utils.js';

const SPECS_DIR = join(process.cwd(), 'specs', 'raw');
const OUTPUT_DIR = join(process.cwd(), 'specs', 'fixed');

// Map invalid types to valid OpenAPI types
const TYPE_FIXES: Record<
  string,
  { type: string; format?: string; items?: Record<string, unknown> }
> = {
  GUID: { type: 'string', format: 'uuid' },
  guid: { type: 'string', format: 'uuid' },
  datetime: { type: 'string', format: 'date-time' },
  'date-time': { type: 'string', format: 'date-time' },
  'Asset array': { type: 'array', items: { type: 'object' } },
  'Location object': { type: 'object' },
  '<a href= "#measurement-data">Measurement Data</a> array': {
    type: 'array',
    items: { type: 'object' },
  },
};

// Invalid fields that should be removed from their contexts
const INVALID_PATH_FIELDS = ['contentType', 'note', 'headers'];
const INVALID_OPERATION_FIELDS = ['note'];

interface RefUsage {
  path: string;
  ref: string;
}

function collectRefs(obj: unknown, path = ''): RefUsage[] {
  const refs: RefUsage[] = [];

  if (obj && typeof obj === 'object') {
    if ('$ref' in obj && typeof (obj as Record<string, unknown>).$ref === 'string') {
      refs.push({ path, ref: (obj as Record<string, unknown>).$ref as string });
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      refs.push(...collectRefs(value, `${path}/${key}`));
    }
  }

  return refs;
}

function getDefinedSchemas(spec: Record<string, unknown>): Set<string> {
  const schemas = new Set<string>();
  const components = spec.components as Record<string, unknown> | undefined;

  if (components?.schemas && typeof components.schemas === 'object') {
    for (const key of Object.keys(components.schemas as Record<string, unknown>)) {
      schemas.add(`#/components/schemas/${key}`);
    }
  }

  if (components?.responses && typeof components.responses === 'object') {
    for (const key of Object.keys(components.responses as Record<string, unknown>)) {
      schemas.add(`#/components/responses/${key}`);
    }
  }

  if (components?.parameters && typeof components.parameters === 'object') {
    for (const key of Object.keys(components.parameters as Record<string, unknown>)) {
      schemas.add(`#/components/parameters/${key}`);
    }
  }

  if (components?.requestBodies && typeof components.requestBodies === 'object') {
    for (const key of Object.keys(components.requestBodies as Record<string, unknown>)) {
      schemas.add(`#/components/requestBodies/${key}`);
    }
  }

  return schemas;
}

function createStubSchema(refPath: string): Record<string, unknown> {
  const name = refPath.split('/').pop() || 'Unknown';

  if (name.endsWith('Collection') || name.endsWith('List')) {
    return {
      type: 'object',
      description: `Stub schema for ${name} (auto-generated)`,
      'x-generated': true,
      properties: {
        values: { type: 'array', items: { type: 'object' } },
        links: { type: 'array', items: { type: 'object' } },
        total: { type: 'integer' },
      },
    };
  }

  if (name.includes('Error') || name.match(/^\d{3}/)) {
    return {
      type: 'object',
      description: `Error response schema for ${name} (auto-generated)`,
      'x-generated': true,
      properties: {
        message: { type: 'string' },
        errors: { type: 'array', items: { type: 'object' } },
      },
    };
  }

  if (name.includes('Link')) {
    return {
      type: 'object',
      description: `Link schema for ${name} (auto-generated)`,
      'x-generated': true,
      properties: {
        '@type': { type: 'string' },
        rel: { type: 'string' },
        uri: { type: 'string', format: 'uri' },
      },
    };
  }

  return {
    type: 'object',
    description: `AUTO-GENERATED STUB SCHEMA for ${name}. Original definition missing from Deere spec.`,
    'x-generated': true,
    additionalProperties: true,
  };
}

function fixTypes(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(fixTypes);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (INVALID_OPERATION_FIELDS.includes(key) && typeof value === 'string') {
        continue;
      }

      if (key === 'type' && typeof value === 'string') {
        const fix = TYPE_FIXES[value];
        if (fix) {
          result.type = fix.type;
          if (fix.format) {
            result.format = fix.format;
          }
          continue;
        }
      }

      if (key === 'required' && typeof value === 'boolean') {
        result['x-required-boolean'] = value;
        continue;
      }

      if (key === 'properties' && value && typeof value === 'object') {
        const fixedProps: Record<string, unknown> = {};

        for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
          // Drop documentation-only grouping keys like "<b>Location</b>"
          if (isDocumentationKey(propKey)) {
            continue;
          }

          // Drop invalid string-only properties instead of inventing enums
          if (typeof propValue === 'string') {
            console.warn(`  Dropping invalid property "${propKey}" (string value)`);
            continue;
          }

          // Sanitize property keys containing HTML (e.g., "referenceId<sup>DEPRECATED</sup>")
          const sanitizedKey = sanitizePropertyKey(propKey);
          if (sanitizedKey !== propKey) {
            console.log(`  Sanitizing property key: "${propKey}" → "${sanitizedKey}"`);
          }

          fixedProps[sanitizedKey] = fixTypes(propValue);
        }

        result[key] = fixedProps;
        continue;
      }

      result[key] = fixTypes(value);
    }

    return result;
  }

  if (typeof obj === 'string') {
    // Strip HTML tags
    return obj
      .replace(/<br\s*\/?>|<\/?p>/gi, '\n') // Turn <br> into newlines for better readability
      .replace(/<sup>.*?<\/sup>|<a[^>]*>.*?<\/a>|<span[^>]*>.*?<\/span>/gi, '') // Drop superscripts/links/spans entirely
      .replace(/<[^>]*>/g, '') // Remove any remaining tags
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }

  return obj;
}

function removeInvalidFields(spec: Record<string, unknown>): void {
  const paths = spec.paths as Record<string, unknown> | undefined;

  if (paths) {
    for (const [, pathValue] of Object.entries(paths)) {
      if (pathValue && typeof pathValue === 'object') {
        const pathObj = pathValue as Record<string, unknown>;

        for (const field of INVALID_PATH_FIELDS) {
          delete pathObj[field];
        }

        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
          const operation = pathObj[method] as Record<string, unknown> | undefined;
          if (operation) {
            for (const field of [...INVALID_PATH_FIELDS, ...INVALID_OPERATION_FIELDS]) {
              delete operation[field];
            }

            if (operation.headers && !operation.responses) {
              operation.headers = undefined;
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// Platform-disguise normalization
// ============================================================================
//
// Five specs on main hardcode platform URLs without using the `{environment}`
// template (files.yaml, organizations.yaml, machine-alerts.yaml,
// machine-locations.yaml, partnerships.yaml). In v1 the client's scalar
// baseUrl ignored the spec's servers list entirely, so this worked by
// coincidence. In v2.0 with spec-driven URL resolution, leaving these
// hardcoded would break sandbox users: generate-api-servers would see
// `https://api.deere.com/platform` and map only the `api` env, throwing
// UnsupportedEnvironmentError for every other env.
//
// Fix: detect specs whose server list is entirely made of static JD platform
// URLs and rewrite them to the templated form with the global enum union.
// After this pass runs, generate-api-servers sees a uniform templated shape
// and every env routes correctly.

interface OpenAPIServer {
  url: string;
  description?: string;
  variables?: Record<string, { default?: string; enum?: string[] }>;
}

const PLATFORM_URL_PATTERN = /^https:\/\/([a-z0-9.-]+)\.deere\.com\/platform$/i;

/**
 * Read every raw spec, extract the `environment` variable enum from templated
 * servers blocks, and return the union of all values. This is the enum we
 * inject into normalized specs so they declare the same env coverage as the
 * rest of the SDK.
 */
function collectGlobalEnvEnum(specsDir: string): string[] {
  const union = new Set<string>();
  const files = readdirSync(specsDir).filter((f) => f.endsWith('.yaml'));
  for (const file of files) {
    let spec: Record<string, unknown>;
    try {
      spec = yaml.parse(readFileSync(join(specsDir, file), 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const servers = spec.servers as OpenAPIServer[] | undefined;
    const first = servers?.[0];
    if (!first?.url.includes('{environment}')) continue;
    const envVar = first.variables?.environment;
    if (Array.isArray(envVar?.enum)) {
      for (const value of envVar.enum) {
        if (typeof value === 'string') union.add(value);
      }
    }
  }
  // Production-first ordering — deterministic.
  const ordered = ['api', 'sandboxapi', 'partnerapi', 'apicert', 'apiqa.tal'];
  const result: string[] = [];
  for (const known of ordered) {
    if (union.has(known)) {
      result.push(known);
      union.delete(known);
    }
  }
  // Any remaining values (future regions) get appended in sorted order for stability.
  result.push(...[...union].sort());
  return result;
}

/**
 * A spec is "platform-disguised" when every entry in its servers list is a
 * static `https://<subdomain>.deere.com/platform` URL with no `{` template
 * and no `variables` block. These are the 5 specs we need to normalize.
 */
function isPlatformDisguised(servers: OpenAPIServer[] | undefined): boolean {
  if (!servers || servers.length === 0) return false;
  for (const server of servers) {
    if (typeof server.url !== 'string') return false;
    if (server.url.includes('{')) return false; // already templated
    if (server.variables) return false; // already has variables → not disguised
    if (!PLATFORM_URL_PATTERN.test(server.url)) return false;
  }
  return true;
}

/**
 * Rewrites a platform-disguised spec's servers block to the templated form
 * with the global env enum union. No-op for specs that aren't disguised.
 */
function normalizePlatformDisguise(
  spec: Record<string, unknown>,
  globalEnumUnion: string[]
): boolean {
  const servers = spec.servers as OpenAPIServer[] | undefined;
  if (!isPlatformDisguised(servers)) return false;

  spec.servers = buildTemplatedPlatformServers(globalEnumUnion);
  return true;
}

/**
 * Inject a default templated platform servers block into a spec that has
 * NO servers block at all (or has an empty/invalid one). Returns true if
 * the spec was modified, false if it already had a valid servers block.
 *
 * This handles notifications.yaml, which doesn't declare any servers block
 * upstream. Without this fix, generate-api-servers classifies it as
 * `kind: 'unavailable'` and every API call throws NoServerConfigError.
 *
 * We assume specs without a servers block are platform-style — their paths
 * look like `/notifications/*` or `/organizations/{orgId}/*`, which are
 * normal JD platform API patterns. If an upstream spec adds new non-platform
 * shapes, this pass may need a more conservative check.
 */
function injectDefaultServers(spec: Record<string, unknown>, globalEnumUnion: string[]): boolean {
  const existing = spec.servers as unknown;
  if (Array.isArray(existing) && existing.length > 0) return false;

  spec.servers = buildTemplatedPlatformServers(globalEnumUnion);
  return true;
}

function buildTemplatedPlatformServers(globalEnumUnion: string[]): OpenAPIServer[] {
  return [
    {
      url: 'https://{environment}.deere.com/platform',
      variables: {
        environment: {
          default: 'api',
          enum: globalEnumUnion,
        },
      },
    },
  ];
}

/**
 * Repair jammed-together URLs where a spec author pasted multiple URLs into
 * one `servers[0].url` string separated by literal text like `<br/>GET` or
 * `(sandbox) GET`. aemp.yaml is the canonical case:
 *
 *   'https://sandboxaemp.deere.com/Fleet/{pageNumber} (sandbox)<br/>GET
 *    https://partneraemp.deere.com/Fleet/{pageNumber} (live)'
 *
 * This extracts the actual URL substrings via regex, strips everything
 * after the hostname (the `/Fleet/{pageNumber}` suffix is documentation that
 * duplicates the spec's declared path), and rewrites to multiple clean
 * server entries.
 *
 * Returns true if the spec was modified.
 */
function repairJammedServers(spec: Record<string, unknown>): boolean {
  const servers = spec.servers as OpenAPIServer[] | undefined;
  if (!servers || servers.length === 0) return false;

  const first = servers[0];
  if (typeof first?.url !== 'string') return false;

  // Detect the jammed shape: whitespace + GET + whitespace + http(s), or
  // <br/>GET + whitespace + http(s). Both signatures indicate the URL
  // field contains multiple documentation-style URLs concatenated.
  const isJammed =
    /\s+GET\s+https?:\/\//i.test(first.url) || /<br\/?>GET\s+https?:\/\//i.test(first.url);
  if (!isJammed) return false;

  // Extract every http(s) URL substring. Regex stops at whitespace, `<`, or
  // `(` so documentation suffixes like "(sandbox)" are excluded. Braces
  // like `{pageNumber}` are allowed in the match.
  const urlMatches = first.url.match(/https?:\/\/[^\s<()]+/g);
  if (!urlMatches || urlMatches.length < 2) return false;

  // Reduce each URL to its base (protocol + host). The suffix after the
  // host is typically a documentation-style path that duplicates the
  // spec's declared `paths:` entries.
  const baseUrls: string[] = [];
  for (const u of urlMatches) {
    try {
      const parsed = new URL(u);
      baseUrls.push(`${parsed.protocol}//${parsed.host}`);
    } catch {
      // Skip unparseable fragments
    }
  }
  if (baseUrls.length < 2) return false;

  // Dedupe while preserving order
  const unique = [...new Set(baseUrls)];

  spec.servers = unique.map((url) => ({ url }));
  return true;
}

function addMissingSchemas(spec: Record<string, unknown>, missingRefs: Set<string>): void {
  if (!spec.components) {
    spec.components = {};
  }
  const components = spec.components as Record<string, unknown>;

  for (const ref of missingRefs) {
    const parts = ref.split('/');

    if (parts.length >= 4 && parts[1] === 'components') {
      const category = parts[2];
      const name = parts[3];

      if (!components[category]) {
        components[category] = {};
      }

      const categoryObj = components[category] as Record<string, unknown>;

      if (!categoryObj[name]) {
        if (category === 'schemas') {
          categoryObj[name] = createStubSchema(ref);
        } else if (category === 'responses') {
          categoryObj[name] = {
            description: `Stub response for ${name} (auto-generated)`,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          };
        } else if (category === 'parameters') {
          categoryObj[name] = {
            name: name.toLowerCase(),
            in: 'query',
            description: `Stub parameter for ${name} (auto-generated)`,
            schema: { type: 'string' },
          };
        } else if (category === 'requestBodies') {
          categoryObj[name] = {
            description: `Stub request body for ${name} (auto-generated)`,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          };
        }
      }
    }
  }
}

// ============================================================================
// Undocumented but working endpoints to inject
// These endpoints exist in the API but aren't in the public OpenAPI specs
// ============================================================================

// ============================================================================
// Fix external $refs that point to non-existent files
// These need to be converted to local refs with stub schemas
// ============================================================================

function fixExternalRefs(obj: unknown, addedSchemas: Set<string>): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => fixExternalRefs(item, addedSchemas));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        let fixedValue = value;

        // Fix external refs like "common-schemas.yaml#/components/schemas/Error"
        if (value.includes('.yaml') || value.includes('.json')) {
          const match = value.match(/#\/components\/schemas\/(\w+)$/);
          if (match) {
            const schemaName = match[1];
            console.log(`  Fixing external ref: ${value} → #/components/schemas/${schemaName}`);
            fixedValue = `#/components/schemas/${schemaName}`;
            addedSchemas.add(schemaName);
          }
        }

        // Fix singular "Response" to plural "responses" (equipment-measurement spec bug)
        if (fixedValue.includes('#/components/Response/')) {
          const corrected = fixedValue.replace('#/components/Response/', '#/components/responses/');
          console.log(`  Fixing singular Response: ${fixedValue} → ${corrected}`);
          fixedValue = corrected;
        }

        result[key] = fixedValue;
      } else {
        result[key] = fixExternalRefs(value, addedSchemas);
      }
    }

    return result;
  }

  return obj;
}

function injectUndocumentedEndpoints(spec: Record<string, unknown>, filename: string): void {
  const paths = spec.paths as Record<string, unknown> | undefined;
  if (!paths) return;

  // Inject GET /organizations/{orgId}/users into organizations spec
  if (filename === 'organizations.yaml') {
    if (!paths['/organizations/{orgId}/users']) {
      console.log('  Injecting undocumented endpoint: GET /organizations/{orgId}/users');
      paths['/organizations/{orgId}/users'] = {
        get: {
          summary: 'List Organization Users',
          description: 'Returns a list of users belonging to the specified organization.',
          parameters: [{ $ref: '#/components/parameters/OrgIdGet' }],
          responses: {
            '200': {
              description: 'Organization Users List',
              content: {
                'application/vnd.deere.axiom.v3+json': {
                  schema: {
                    properties: {
                      links: {
                        items: { $ref: '#/components/schemas/OrganizationLink' },
                      },
                      values: {
                        items: { $ref: '#/components/schemas/OrganizationUser' },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Not authorized' },
            '404': { description: 'Not found' },
          },
        },
      };

      // Add OrganizationUser schema if not present
      const components = spec.components as Record<string, unknown> | undefined;
      if (components) {
        const schemas = components.schemas as Record<string, unknown> | undefined;
        if (schemas && !schemas.OrganizationUser) {
          schemas.OrganizationUser = {
            properties: {
              accountName: {
                type: 'string',
                description: "User's account name.",
                example: 'JohnDoe',
              },
              givenName: {
                type: 'string',
                description: "User's first name.",
                example: 'John',
              },
              familyName: {
                type: 'string',
                description: "User's last name.",
                example: 'Doe',
              },
              userType: {
                type: 'string',
                description: "User's type. Examples are customer, dealer, internal.",
                example: 'Customer',
              },
            },
          };
        }
      }
    }
  }
}

function fixSpec(content: string, filename: string, globalEnumUnion: string[]): string {
  console.log(`\nProcessing: ${filename}`);

  let spec: Record<string, unknown>;
  try {
    spec = yaml.parse(content) as Record<string, unknown>;
  } catch (e) {
    console.log(`  Failed to parse YAML: ${e}`);
    return content;
  }

  // Fix incorrect swagger version (notifications.yaml has "swagger: '3.0.0'" instead of "openapi: '3.0.0'")
  if (spec.swagger && !spec.openapi) {
    console.log(`  Fixing incorrect swagger field: "${spec.swagger}" → openapi: "3.0.0"`);
    // Reconstruct spec with openapi at the beginning (YAML preserves key order)
    const { swagger, ...rest } = spec;
    spec = { openapi: '3.0.0', ...rest };
  }

  if (!spec?.openapi) {
    console.log('  Not a valid OpenAPI spec');
    return content;
  }

  const refs = collectRefs(spec);
  console.log(`  Found ${refs.length} $ref usages`);

  const defined = getDefinedSchemas(spec);
  console.log(`  Found ${defined.size} defined components`);

  const missingRefs = new Set<string>();
  for (const { ref } of refs) {
    if (ref.startsWith('#/') && !defined.has(ref)) {
      missingRefs.add(ref);
    }
  }

  if (missingRefs.size > 0) {
    console.log(`  Missing refs: ${missingRefs.size}`);
  }

  removeInvalidFields(spec);
  spec = fixTypes(spec) as Record<string, unknown>;

  // Fix external $refs and collect schemas to add
  const externalSchemas = new Set<string>();
  spec = fixExternalRefs(spec, externalSchemas) as Record<string, unknown>;
  for (const schemaName of externalSchemas) {
    missingRefs.add(`#/components/schemas/${schemaName}`);
  }

  // Fix singular "Response" to plural "responses" in missingRefs (equipment-measurement spec bug)
  for (const ref of [...missingRefs]) {
    if (ref.includes('#/components/Response/')) {
      const fixed = ref.replace('#/components/Response/', '#/components/responses/');
      missingRefs.delete(ref);
      missingRefs.add(fixed);
    }
  }

  // Fix singular "Response" to plural "responses" in components (equipment-measurement spec bug)
  const components = spec.components as Record<string, unknown> | undefined;
  if (components?.Response) {
    console.log('  Removing invalid components.Response (merged to responses)');
    if (!components.responses) {
      components.responses = components.Response;
    } else {
      // Merge Response into existing responses
      const responses = components.responses as Record<string, unknown>;
      const response = components.Response as Record<string, unknown>;
      for (const [key, value] of Object.entries(response)) {
        if (!responses[key]) {
          responses[key] = value;
        }
      }
    }
    delete components.Response;
  }

  addMissingSchemas(spec, missingRefs);
  injectUndocumentedEndpoints(spec, filename);

  // Repair jammed-together server URLs (aemp.yaml has multiple URLs
  // concatenated with literal "GET" separators). Runs BEFORE
  // normalizePlatformDisguise because it has to fix the shape first.
  if (repairJammedServers(spec)) {
    console.log(`  Repaired jammed servers URL`);
  }

  // Rewrite platform-disguised servers blocks (files.yaml, organizations.yaml,
  // machine-alerts.yaml, machine-locations.yaml, partnerships.yaml) to templated
  // form. This must run before yaml.stringify so the emitted spec has the new
  // shape. Downstream generate-api-servers.ts sees a uniform templated input.
  if (normalizePlatformDisguise(spec, globalEnumUnion)) {
    console.log(
      `  Normalized platform-disguised servers (enum union: ${globalEnumUnion.join(', ')})`
    );
  }

  // Inject a default templated platform servers block for specs that have
  // no servers at all (notifications.yaml). Without this they'd be
  // classified as `kind: 'unavailable'` and throw NoServerConfigError on
  // every call.
  if (injectDefaultServers(spec, globalEnumUnion)) {
    console.log(`  Injected default templated servers block (no servers declared upstream)`);
  }

  return yaml.stringify(spec, {
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  });
}

async function main() {
  console.log('Fixing John Deere OpenAPI specs...\n');

  if (!existsSync(SPECS_DIR)) {
    console.error(`Specs directory not found: ${SPECS_DIR}`);
    console.error('Run `pnpm fetch-specs` first.');
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const yamlFiles = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  console.log(`Found ${yamlFiles.length} specs to fix`);

  // Pre-pass: collect the union of `environment` enum values across every
  // already-templated spec. Used by normalizePlatformDisguise to inject the
  // same enum breadth into specs whose servers block was hardcoded. Without
  // this, sandbox users of files/organizations/etc. would regress in v2.0.
  const globalEnumUnion = collectGlobalEnvEnum(SPECS_DIR);
  console.log(`Global environment enum union: ${globalEnumUnion.join(', ')}`);

  let fixed = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const inputPath = join(SPECS_DIR, yamlFile);
    const outputPath = join(OUTPUT_DIR, yamlFile);

    try {
      const content = readFileSync(inputPath, 'utf-8');
      const fixedContent = fixSpec(content, yamlFile, globalEnumUnion);
      writeFileSync(outputPath, fixedContent);
      fixed++;
    } catch (error) {
      console.log(`  Failed: ${error}`);
      failed++;
    }
  }

  console.log(`\nFixed ${fixed} specs, ${failed} failed`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm generate-types` to generate TypeScript types');
}

main().catch(console.error);
