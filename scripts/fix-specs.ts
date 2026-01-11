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

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import * as yaml from 'yaml';

const SPECS_DIR = join(process.cwd(), 'specs', 'raw');
const OUTPUT_DIR = join(process.cwd(), 'specs', 'fixed');

// Map invalid types to valid OpenAPI types
const TYPE_FIXES: Record<string, { type: string; format?: string }> = {
  GUID: { type: 'string', format: 'uuid' },
  guid: { type: 'string', format: 'uuid' },
  datetime: { type: 'string', format: 'date-time' },
  'date-time': { type: 'string', format: 'date-time' },
  'Asset array': { type: 'array' },
  'Location object': { type: 'object' },
  '<a href= "#measurement-data">Measurement Data</a> array': { type: 'array' },
};

// Invalid fields that should be removed from their contexts
const INVALID_PATH_FIELDS = ['contentType', 'note', 'headers'];
const INVALID_OPERATION_FIELDS = ['note'];

interface RefUsage {
  path: string;
  ref: string;
}

function collectRefs(obj: unknown, path: string = ''): RefUsage[] {
  const refs: RefUsage[] = [];

  if (obj && typeof obj === 'object') {
    if ('$ref' in obj && typeof (obj as Record<string, unknown>)['$ref'] === 'string') {
      refs.push({ path, ref: (obj as Record<string, unknown>)['$ref'] as string });
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
      properties: {
        '@type': { type: 'string' },
        rel: { type: 'string' },
        uri: { type: 'string', format: 'uri' },
      },
    };
  }

  return {
    type: 'object',
    description: `Stub schema for ${name} (auto-generated - original was missing)`,
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
          result['type'] = fix.type;
          if (fix.format) {
            result['format'] = fix.format;
          }
          continue;
        }
      }

      if (key === 'required' && typeof value === 'boolean') {
        continue;
      }

      if (key === 'properties' && value && typeof value === 'object') {
        const fixedProps: Record<string, unknown> = {};
        for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
          if (typeof propValue === 'string') {
            fixedProps[propKey] = {
              type: 'string',
              enum: [propValue],
              description: `Fixed from invalid string value: ${propValue}`,
            };
          } else {
            fixedProps[propKey] = fixTypes(propValue);
          }
        }
        result[key] = fixedProps;
        continue;
      }

      result[key] = fixTypes(value);
    }

    return result;
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
              delete operation.headers;
            }
          }
        }
      }
    }
  }
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

function fixSpec(content: string, filename: string): string {
  console.log(`\nProcessing: ${filename}`);

  let spec: Record<string, unknown>;
  try {
    spec = yaml.parse(content) as Record<string, unknown>;
  } catch (e) {
    console.log(`  Failed to parse YAML: ${e}`);
    return content;
  }

  if (!spec || !spec.openapi) {
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
  addMissingSchemas(spec, missingRefs);

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

  const yamlFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.yaml'));
  console.log(`Found ${yamlFiles.length} specs to fix`);

  let fixed = 0;
  let failed = 0;

  for (const yamlFile of yamlFiles) {
    const inputPath = join(SPECS_DIR, yamlFile);
    const outputPath = join(OUTPUT_DIR, yamlFile);

    try {
      const content = readFileSync(inputPath, 'utf-8');
      const fixedContent = fixSpec(content, yamlFile);
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
