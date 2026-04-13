#!/usr/bin/env tsx
/**
 * Generates SDK wrapper classes from John Deere OpenAPI specs.
 *
 * This script reads the fixed OpenAPI YAML specs and generates:
 * 1. Typed API wrapper classes (e.g., FarmsApi, FieldsApi)
 * 2. Updated Deere main class with all APIs
 * 3. Index file exporting everything
 *
 * Usage: pnpm generate-sdk
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as yaml from 'yaml';

// ============================================================================
// Configuration
// ============================================================================

const SPECS_DIR = join(process.cwd(), 'specs', 'fixed');
const OUTPUT_DIR = join(process.cwd(), 'src', 'api');
const SRC_DIR = join(process.cwd(), 'src');

// ============================================================================
// Types
// ============================================================================

interface OpenAPISpec {
  openapi: string;
  info: { title: string; description?: string };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    parameters?: Record<string, ParameterObject>;
    responses?: Record<string, ResponseObject>;
    requestBodies?: Record<string, RequestBodyObject>;
  };
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: ParameterObject[];
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject | { $ref: string };
  responses?: Record<string, ResponseObject | { $ref: string }>;
}

interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: SchemaObject;
  description?: string;
  $ref?: string;
}

interface SchemaObject {
  type?: string;
  format?: string;
  $ref?: string;
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  enum?: string[];
}

interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface RequestBodyObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
  required?: boolean;
}

interface ParsedOperation {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary?: string;
  description?: string;
  pathParams: PathParam[];
  queryParams: QueryParam[];
  hasRequestBody: boolean;
  requestBodySchemaRef?: string;
  responseSchemaRef?: string;
  isCollection: boolean;
}

interface PathParam {
  name: string;
  description?: string;
}

interface QueryParam {
  name: string;
  safeName: string;
  required: boolean;
  type: string;
  enumValues?: string[];
  description?: string;
}

interface GeneratedApi {
  specName: string;
  className: string;
  resourceName: string;
  typesImportPath: string;
  operations: ParsedOperation[];
}

// ============================================================================
// Parsing Utilities
// ============================================================================

function toPascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

// Input is trusted JD spec param names; output is a TS identifier, not HTML. Stripping tags is safe here.
function toSafeIdentifier(str: string): string {
  const stripped = str.replace(/<[^>]*>/g, '');
  return stripped
    .split(/[.\-\s]/)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

// Output flows to emitted TS source (type unions, URLSearchParams keys), not HTML.
function cleanParamName(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toClassName(specName: string): string {
  const name = specName.replace(/-api$/, '');
  return `${toPascalCase(name)}Api`;
}

function toResourceName(specName: string): string {
  const name = specName.replace(/-api$/, '');
  return toCamelCase(name);
}

function wrapJsDocText(text: string, prefix: string, maxWidth = 80): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let currentLine = prefix;

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxWidth && currentLine !== prefix) {
      lines.push(currentLine);
      currentLine = `   * ${word}`;
    } else {
      currentLine += (currentLine === prefix ? '' : ' ') + word;
    }
  }

  if (currentLine !== prefix) {
    lines.push(currentLine);
  }

  return lines;
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{([^}]+)}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function isCollectionEndpoint(path: string, method: string): boolean {
  if (method !== 'get') return false;
  const lastSegment = path.split('/').pop() || '';
  return !lastSegment.startsWith('{');
}

function resolveRef(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

function inferMethodName(op: ParsedOperation): string {
  const id = (op.operationId || '').toLowerCase();

  if (id.startsWith('getall') || id.startsWith('list') || id.match(/^get[a-z]+s$/)) {
    return 'list';
  }
  if (id.startsWith('get') && !id.includes('all')) {
    return 'get';
  }
  if (id.startsWith('create') || (id.startsWith('post') && !id.includes('get'))) {
    return 'create';
  }
  if (id.startsWith('update') || id.startsWith('put')) {
    return 'update';
  }
  if (id.startsWith('delete') || id.startsWith('remove')) {
    return 'delete';
  }

  if (op.method === 'get') {
    return op.isCollection ? 'list' : 'get';
  }
  if (op.method === 'post') return 'create';
  if (op.method === 'put') return 'update';
  if (op.method === 'patch') return 'patch';
  if (op.method === 'delete') return 'delete';

  return toCamelCase(op.operationId || `${op.method}Unknown`);
}

function getSchemaType(schema: SchemaObject | undefined): string {
  if (!schema) return 'unknown';

  if (schema.$ref) {
    return 'string';
  }

  if (schema.type === 'array' && schema.items) {
    const itemType = getSchemaType(schema.items);
    if (itemType === 'string' || itemType === 'number' || itemType === 'boolean') {
      return `${itemType}[]`;
    }
    return 'string[]';
  }

  if (schema.type === 'string' && schema.enum) {
    return schema.enum.map((e) => `'${cleanParamName(String(e))}'`).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'Record<string, unknown>';
    case 'array':
      return 'unknown[]';
    default:
      return 'unknown';
  }
}

// ============================================================================
// Schema Resolution Helpers
// ============================================================================

/**
 * Extracts schema reference from response/requestBody content.
 * Handles both direct schema refs and nested values.items refs (for collections).
 * Only returns refs that point to actual schemas (not responses or other components).
 */
function extractSchemaFromContent(
  content?: Record<string, { schema?: SchemaObject }>
): string | undefined {
  const c = content?.['application/vnd.deere.axiom.v3+json'] || content?.['application/json'];
  if (!c?.schema) return undefined;

  // Direct $ref to schema - only accept refs to components/schemas
  if (c.schema.$ref?.includes('/schemas/')) {
    return resolveRef(c.schema.$ref);
  }

  // Nested values.items.$ref pattern (common for collections)
  if (c.schema.properties?.values?.items?.$ref?.includes('/schemas/')) {
    return resolveRef(c.schema.properties.values.items.$ref);
  }

  return undefined;
}

/**
 * Resolves response schema, handling both $ref responses and inline responses.
 */
function resolveResponseSchema(
  response: ResponseObject | { $ref: string },
  spec: OpenAPISpec
): string | undefined {
  // If it's a $ref, resolve it from components.responses
  if ('$ref' in response && response.$ref) {
    const responseName = resolveRef(response.$ref);
    const resolved = spec.components?.responses?.[responseName];
    if (!resolved) return undefined;
    return extractSchemaFromContent(resolved.content);
  }

  // If it's an inline response
  return extractSchemaFromContent((response as ResponseObject).content);
}

/**
 * Resolves request body schema, handling both $ref and inline requestBodies.
 */
function resolveRequestBodySchema(
  requestBody: RequestBodyObject | { $ref: string },
  spec: OpenAPISpec
): string | undefined {
  // If it's a $ref, resolve it from components.requestBodies
  if ('$ref' in requestBody && requestBody.$ref) {
    const name = resolveRef(requestBody.$ref);
    const resolved = spec.components?.requestBodies?.[name];
    if (!resolved) return undefined;
    return extractSchemaFromContent(resolved.content);
  }

  // If it's an inline request body
  return extractSchemaFromContent((requestBody as RequestBodyObject).content);
}

// ============================================================================
// OpenAPI Spec Parser
// ============================================================================

function parseSpec(specPath: string): GeneratedApi | null {
  const content = readFileSync(specPath, 'utf-8');
  let spec: OpenAPISpec;

  try {
    spec = yaml.parse(content) as OpenAPISpec;
  } catch (e) {
    console.error(`  Failed to parse ${specPath}: ${e}`);
    return null;
  }

  if (!spec?.openapi || !spec.paths) {
    console.error(`  Invalid OpenAPI spec: ${specPath}`);
    return null;
  }

  const specName = basename(specPath, '.yaml');
  const operations: ParsedOperation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods: Array<'get' | 'post' | 'put' | 'patch' | 'delete'> = [
      'get',
      'post',
      'put',
      'patch',
      'delete',
    ];

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      const pathParamNames = extractPathParams(path);
      const pathParams: PathParam[] = pathParamNames.map((name) => {
        const param =
          operation.parameters?.find((p) => 'name' in p && p.name === name && p.in === 'path') ||
          pathItem.parameters?.find((p) => 'name' in p && p.name === name && p.in === 'path');
        return {
          name,
          description: param && 'description' in param ? param.description : undefined,
        };
      });

      const queryParams: QueryParam[] = [];
      const allParams = [...(pathItem.parameters || []), ...(operation.parameters || [])];

      for (const param of allParams) {
        if ('$ref' in param && param.$ref) {
          const refName = resolveRef(param.$ref);
          const resolved = spec.components?.parameters?.[refName];
          if (resolved && resolved.in === 'query') {
            queryParams.push({
              name: resolved.name,
              safeName: toSafeIdentifier(resolved.name),
              required: resolved.required || false,
              type: getSchemaType(resolved.schema),
              enumValues: resolved.schema?.enum,
              description: resolved.description,
            });
          }
        } else if ('in' in param && param.in === 'query') {
          queryParams.push({
            name: param.name,
            safeName: toSafeIdentifier(param.name),
            required: param.required || false,
            type: getSchemaType(param.schema),
            enumValues: param.schema?.enum,
            description: param.description,
          });
        }
      }

      // Extract request body schema reference
      let hasRequestBody = false;
      let requestBodySchemaRef: string | undefined;
      if (operation.requestBody) {
        hasRequestBody = true;
        requestBodySchemaRef = resolveRequestBodySchema(operation.requestBody, spec);
      }

      // Extract response schema reference (handles both $ref and inline responses)
      let responseSchemaRef: string | undefined;
      const response200 = operation.responses?.['200'] || operation.responses?.['201'];
      if (response200) {
        responseSchemaRef = resolveResponseSchema(response200, spec);
      }

      operations.push({
        operationId: operation.operationId || `${method}${path.replace(/[^a-zA-Z]/g, '')}`,
        method,
        path,
        summary: operation.summary,
        description: operation.description,
        pathParams,
        queryParams,
        hasRequestBody,
        requestBodySchemaRef,
        responseSchemaRef,
        isCollection: isCollectionEndpoint(path, method),
      });
    }
  }

  return {
    specName,
    className: toClassName(specName),
    resourceName: toResourceName(specName),
    typesImportPath: specName,
    operations,
  };
}

// ============================================================================
// Code Generation
// ============================================================================

function generateMethod(op: ParsedOperation, usedMethodNames: Set<string>): string {
  let methodName = inferMethodName(op);

  if (usedMethodNames.has(methodName)) {
    const pathParts = op.path.split('/').filter((p) => !p.startsWith('{') && p);
    const suffix = toPascalCase(pathParts[pathParts.length - 1] || 'Item');
    methodName = `${methodName}${suffix}`;

    let counter = 2;
    while (usedMethodNames.has(methodName)) {
      methodName = `${methodName}${counter}`;
      counter++;
    }
  }
  usedMethodNames.add(methodName);

  const params: string[] = [];

  for (const pp of op.pathParams) {
    params.push(`${pp.name}: string`);
  }

  if (op.hasRequestBody) {
    if (op.requestBodySchemaRef) {
      params.push(`data: components['schemas']['${op.requestBodySchemaRef}']`);
    } else {
      params.push('data: Record<string, unknown>');
    }
  }

  if (op.queryParams.length > 0) {
    const queryParamTypes = op.queryParams
      .map((qp) => {
        const optional = qp.required ? '' : '?';
        let type = qp.type;
        if (qp.enumValues) {
          type = qp.enumValues.map((v) => `'${cleanParamName(String(v))}'`).join(' | ');
        }
        return `${qp.safeName}${optional}: ${type}`;
      })
      .join('; ');
    params.push(`params?: { ${queryParamTypes} }`);
  }

  params.push('options?: RequestOptions');

  let returnType = 'unknown';
  if (op.method === 'delete') {
    // DELETE typically returns 204 No Content
    returnType = 'void';
  } else if (op.responseSchemaRef) {
    // Use response schema for GET, POST, PUT, PATCH when available
    if (op.isCollection && op.method === 'get') {
      returnType = `PaginatedResponse<components['schemas']['${op.responseSchemaRef}']>`;
    } else {
      returnType = `components['schemas']['${op.responseSchemaRef}']`;
    }
  } else if (op.method === 'post' || op.method === 'put' || op.method === 'patch') {
    // No response schema defined - return void
    returnType = 'void';
  }

  let pathTemplate = op.path;
  for (const pp of op.pathParams) {
    pathTemplate = pathTemplate.replace(`{${pp.name}}`, `\${${pp.name}}`);
  }

  const lines: string[] = [];

  if (op.queryParams.length > 0) {
    lines.push('    const query = new URLSearchParams();');
    for (const qp of op.queryParams) {
      const cleanName = cleanParamName(qp.name);
      lines.push(
        `    if (params?.${qp.safeName} !== undefined) query.set('${cleanName}', String(params.${qp.safeName}));`
      );
    }
    lines.push('    const queryString = query.toString();');
    lines.push(`    const path = \`${pathTemplate}\${queryString ? \`?\${queryString}\` : ''}\`;`);
  } else {
    lines.push(`    const path = \`${pathTemplate}\`;`);
  }

  const bodyArg = op.hasRequestBody ? ', data' : '';

  // v2.0: every generated method passes `this.spec` as the first arg so
  // DeereClient can resolve the request URL via API_SERVERS[spec].
  if (returnType === 'void') {
    lines.push(`    await this.client.${op.method}(this.spec, path${bodyArg}, options);`);
  } else {
    lines.push(
      `    return this.client.${op.method}<${returnType}>(this.spec, path${bodyArg}, options);`
    );
  }

  const jsdoc: string[] = ['  /**'];
  if (op.summary) {
    jsdoc.push(`   * ${op.summary}`);
  }
  if (op.description && op.description !== op.summary) {
    jsdoc.push(...wrapJsDocText(op.description, '   * @description '));
  }
  jsdoc.push(`   * @generated from ${op.method.toUpperCase()} ${op.path}`);
  jsdoc.push('   */');

  let listAllMethod = '';
  if (op.isCollection && op.method === 'get' && methodName === 'list') {
    const listAllReturnType = op.responseSchemaRef
      ? `components['schemas']['${op.responseSchemaRef}'][]`
      : 'unknown[]';

    const getAllLines = [...lines];
    getAllLines[getAllLines.length - 1] = `    return this.client.getAll<${
      op.responseSchemaRef ? `components['schemas']['${op.responseSchemaRef}']` : 'unknown'
    }>(this.spec, path, options);`;

    listAllMethod = `
  /**
   * Get all items (follows pagination automatically)
   * @generated from ${op.method.toUpperCase()} ${op.path}
   */
  async listAll(${params.join(', ')}): Promise<${listAllReturnType}> {
${getAllLines.join('\n')}
  }`;
  }

  return `${jsdoc.join('\n')}
  async ${methodName}(${params.join(', ')}): Promise<${returnType}> {
${lines.join('\n')}
  }${listAllMethod}`;
}

function generateApiClass(api: GeneratedApi): string {
  const usedMethodNames = new Set<string>();

  const methods = api.operations.map((op) => generateMethod(op, usedMethodNames)).join('\n\n');

  // Determine which imports are actually used
  const usesPaginatedResponse = api.operations.some(
    (op) => op.isCollection && op.method === 'get' && op.responseSchemaRef
  );
  const usesComponents = api.operations.some(
    (op) => op.requestBodySchemaRef || op.responseSchemaRef
  );

  // Build client imports (only include what's used)
  const clientImports = ['DeereClient', 'RequestOptions'];
  if (usesPaginatedResponse) {
    clientImports.push('PaginatedResponse');
  }

  // Build import lines. The SpecName import is always needed for the typed
  // `spec` field on the generated class — gives us compile-time typo
  // protection against renamed specs.
  const imports = [
    `import type { ${clientImports.join(', ')} } from '../client.js';`,
    `import type { SpecName } from '../api-servers.generated.js';`,
  ];
  if (usesComponents) {
    imports.push(`import type { components } from '../types/generated/${api.typesImportPath}.js';`);
  }

  return `/**
 * ${api.className}
 *
 * Auto-generated SDK wrapper for John Deere ${api.specName} API.
 * @generated from ${api.specName}.yaml
 */

${imports.join('\n')}

export class ${api.className} {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = '${api.specName}';

  constructor(private readonly client: DeereClient) {}

${methods}
}

// Re-export types for convenience
export type { components as ${toPascalCase(api.specName)}Types } from '../types/generated/${api.typesImportPath}.js';
`;
}

function generateApiIndex(apis: GeneratedApi[]): string {
  const imports = apis
    .map((api) => `export { ${api.className} } from './${api.specName}.js';`)
    .join('\n');

  const typeExports = apis
    .map((api) => `export type { ${toPascalCase(api.specName)}Types } from './${api.specName}.js';`)
    .join('\n');

  return `/**
 * John Deere API Modules
 *
 * Auto-generated SDK wrappers for all John Deere APIs.
 * @generated
 */

${imports}

${typeExports}
`;
}

function generateMainClass(apis: GeneratedApi[]): string {
  const classNames = apis.map((api) => api.className).join(',\n  ');

  const properties = apis
    .map(
      (api) =>
        `  /** ${api.specName.replace(/-/g, ' ')} API */
  readonly ${api.resourceName}: ${api.className};`
    )
    .join('\n\n');

  const assignments = apis
    .map((api) => `    this.${api.resourceName} = new ${api.className}(this.client);`)
    .join('\n');

  return `/**
 * John Deere SDK
 *
 * High-level SDK that combines all API resources.
 * @generated
 */

import { DeereClient, type DeereClientConfig } from './client.js';
import {
  ${classNames},
} from './api/index.js';

/**
 * John Deere SDK
 *
 * Provides typed access to all John Deere Operations Center APIs.
 *
 * @example
 * \`\`\`typescript
 * import { Deere } from 'deere-sdk';
 *
 * const deere = new Deere({
 *   accessToken: 'your-token',
 *   environment: 'sandbox',
 * });
 *
 * const orgs = await deere.organizations.listAll();
 * const farms = await deere.farms.listAll(orgs[0].id);
 * const fields = await deere.fields.listAll(orgs[0].id);
 * \`\`\`
 */
export class Deere {
  /** Raw HTTP client for custom requests */
  readonly client: DeereClient;

${properties}

  constructor(config: DeereClientConfig) {
    this.client = new DeereClient(config);
${assignments}
  }
}

/**
 * Create a John Deere SDK instance
 */
export function createDeere(config: DeereClientConfig): Deere {
  return new Deere(config);
}
`;
}

interface HateoasEntry {
  parentPath: string;
  rel: string;
  parentSpec: string;
}

/**
 * Normalize a path pattern by replacing every `{paramName}` with `{_}` so
 * path-param name differences (e.g. `{orgId}` vs `{organizationId}`) collapse
 * into the same key. Used for pathOwner index lookups — HATEOAS entries
 * should match regardless of which variable name a spec uses.
 */
function normalizePathPattern(path: string): string {
  return path.replace(/\{[^}]+\}/g, '{_}');
}

/**
 * Build a reverse index mapping every declared path pattern to the spec that
 * owns it. Used by generateHateoasMap to record `parentSpec` per entry —
 * critical for cross-spec HATEOAS flows (e.g. equipment.yaml declares
 * `/organizations/{orgId}/equipment`, but the parent `/organizations/{orgId}`
 * is declared in organizations.yaml, which routes to a different host).
 *
 * Keyed by NORMALIZED path (param names replaced with `{_}`) so
 * `/organizations/{orgId}` and `/organizations/{organizationId}` both resolve
 * to the same entry. First-write-wins is stable because main() sorts
 * yamlFiles before parsing.
 */
function buildPathOwnerIndex(apis: GeneratedApi[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const api of apis) {
    for (const op of api.operations) {
      const key = normalizePathPattern(op.path);
      if (!owners.has(key)) {
        owners.set(key, api.specName);
      }
    }
  }
  return owners;
}

function generateHateoasMap(apis: GeneratedApi[]): string {
  const entries: Record<string, HateoasEntry> = {};
  const pathOwners = buildPathOwnerIndex(apis);
  const skippedSynthesizedParents: string[] = [];

  for (const api of apis) {
    for (const op of api.operations) {
      const segments = op.path.split('/').filter(Boolean);

      // Only nested paths need HATEOAS entries (3+ segments ending with a resource name)
      if (segments.length < 2) continue;

      const lastSegment = segments[segments.length - 1];

      // Skip if last segment is a path parameter (item access — direct)
      if (lastSegment.startsWith('{')) continue;

      const rel = lastSegment;
      const parentPath = `/${segments.slice(0, -1).join('/')}`;

      // The HATEOAS generator creates parent paths by stripping the last
      // segment. That synthesis only produces a VALID parent when the
      // stripped path is a real declared endpoint somewhere. For cases like
      // `/organizations/{orgId}/equipment/{principalId}/measurements`, the
      // stripped parent `/organizations/{orgId}/equipment/{principalId}` is
      // NOT a declared endpoint in any spec, so the HATEOAS walk would 404
      // at runtime. Skip these entries — resolveHateoasUrl falls back to
      // direct URL resolution for paths without a map match, which is the
      // correct behavior.
      const parentSpec = pathOwners.get(normalizePathPattern(parentPath));
      if (!parentSpec) {
        skippedSynthesizedParents.push(op.path);
        continue;
      }

      // Deduplicate — multiple HTTP methods on the same path share one entry
      if (!entries[op.path]) {
        entries[op.path] = { parentPath, rel, parentSpec };
      }
    }
  }

  if (skippedSynthesizedParents.length > 0) {
    console.log(
      `  HATEOAS: skipped ${skippedSynthesizedParents.length} entries with synthesized parents that aren't declared endpoints:`
    );
    for (const path of skippedSynthesizedParents) {
      console.log(`    ${path}`);
    }
    console.log(
      `  (Runtime resolveHateoasUrl falls back to direct URL resolution for these paths.)`
    );
  }

  // Build-time collision check: ensure no two patterns would match the same concrete path
  const patterns = Object.keys(entries);
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i].split('/').filter(Boolean);
      const b = patterns[j].split('/').filter(Boolean);
      if (a.length !== b.length) continue;
      const couldCollide = a.every(
        (seg, idx) => seg === b[idx] || seg.startsWith('{') || b[idx].startsWith('{')
      );
      if (couldCollide) {
        console.warn(
          `  HATEOAS map collision warning: "${patterns[i]}" and "${patterns[j]}" could match the same path`
        );
      }
    }
  }

  const mapEntries = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([path, entry]) =>
        `  '${path}': { parentPath: '${entry.parentPath}', rel: '${entry.rel}', parentSpec: '${entry.parentSpec}' },`
    )
    .join('\n');

  return `/**
 * HATEOAS Route Map
 *
 * Maps API path patterns to their parent resource and link relation name.
 * Used by DeereClient to resolve URLs via HAL link traversal when hateoas mode is enabled.
 *
 * @generated by generate-sdk.ts — do not edit manually
 */

import type { SpecName } from './api-servers.generated.js';

export interface HateoasRoute {
  /** Path pattern of the parent resource (with parameter placeholders) */
  parentPath: string;
  /** HAL link relation name to follow from the parent response */
  rel: string;
  /**
   * Which OpenAPI spec declares the parent resource. Required for cross-spec
   * HATEOAS: if a child lives in equipment.yaml but its parent
   * /organizations/{orgId} is declared in organizations.yaml, the client
   * must fetch the parent via organizations.yaml's host (platform) not
   * equipment.yaml's host (equipmentapi.deere.com/isg).
   */
  parentSpec: SpecName;
}

export const HATEOAS_MAP: Record<string, HateoasRoute> = {
${mapEntries}
};
`;
}

function generateTypesIndex(apis: GeneratedApi[]): string {
  const exports = apis
    .map(
      (api) =>
        `export * as ${toPascalCase(api.specName)} from './generated/${api.typesImportPath}.js';`
    )
    .join('\n');

  return `/**
 * John Deere API Types
 *
 * Re-exports all generated OpenAPI types.
 * @generated
 */

${exports}
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Generating SDK wrappers from OpenAPI specs...\n');

  if (!existsSync(SPECS_DIR)) {
    console.error(`Specs directory not found: ${SPECS_DIR}`);
    console.error('Run `pnpm fetch-specs` and `pnpm fix-specs` first.');
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const typesDir = join(SRC_DIR, 'types');
  if (!existsSync(typesDir)) {
    mkdirSync(typesDir, { recursive: true });
  }

  // Sort for determinism: first-write-wins in the HATEOAS path-owner index
  // depends on iteration order, and readdirSync returns filesystem-inode
  // order on Linux (non-deterministic across CI runners).
  const yamlFiles = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  console.log(`Found ${yamlFiles.length} OpenAPI specs\n`);

  const apis: GeneratedApi[] = [];

  for (const yamlFile of yamlFiles) {
    const specPath = join(SPECS_DIR, yamlFile);
    process.stdout.write(`Parsing ${yamlFile}...`);

    const api = parseSpec(specPath);
    if (api) {
      apis.push(api);
      console.log(` OK (${api.operations.length} operations)`);
    } else {
      console.log(' FAILED');
    }
  }

  console.log(
    `\nParsed ${apis.length} APIs with ${apis.reduce((sum, a) => sum + a.operations.length, 0)} operations\n`
  );

  console.log('Generating API wrapper classes...');
  for (const api of apis) {
    const code = generateApiClass(api);
    const outputPath = join(OUTPUT_DIR, `${api.specName}.ts`);
    writeFileSync(outputPath, code);
    console.log(`  ${api.className} -> ${api.specName}.ts`);
  }

  console.log('\nGenerating index files...');
  const apiIndex = generateApiIndex(apis);
  writeFileSync(join(OUTPUT_DIR, 'index.ts'), apiIndex);
  console.log('  api/index.ts');

  const typesIndex = generateTypesIndex(apis);
  writeFileSync(join(SRC_DIR, 'types', 'index.ts'), typesIndex);
  console.log('  types/index.ts');

  const mainClass = generateMainClass(apis);
  writeFileSync(join(SRC_DIR, 'deere.ts'), mainClass);
  console.log('  deere.ts');

  console.log('\nGenerating HATEOAS route map...');
  const hateoasMap = generateHateoasMap(apis);
  writeFileSync(join(SRC_DIR, 'hateoas-map.ts'), hateoasMap);
  const hateoasEntryCount = (hateoasMap.match(/parentPath:/g) || []).length;
  console.log(`  hateoas-map.ts (${hateoasEntryCount} route entries)`);

  console.log('\nSDK generation complete!');
  console.log(`\nGenerated ${apis.length} API wrappers:`);
  for (const api of apis) {
    console.log(
      `  - ${api.className} (${api.operations.length} methods) -> deere.${api.resourceName}`
    );
  }

  console.log('\nNext: Run `pnpm build` to compile TypeScript');
}

main().catch(console.error);
