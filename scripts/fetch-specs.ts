#!/usr/bin/env tsx
/**
 * Fetches John Deere OpenAPI specs from their developer portal.
 *
 * Usage: pnpm fetch-specs
 *
 * The specs are fetched from:
 *   https://developer.deere.com/devDoc/apiDetails/{api-slug}
 *
 * Output:
 *   - specs/raw/*.yaml (individual API specs)
 *   - specs/raw/summary.json (fetch metadata)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ValidatedFetchedSpec, validateFetchedSpec } from './lib/fetched-spec-utils.js';

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';
const OUTPUT_DIR = join(process.cwd(), 'specs', 'raw');

// All John Deere APIs to include in the SDK
const API_SLUGS = [
  // Precision Tech / Operations Center (18)
  'field-operations-api',
  'fields',
  'farms',
  'clients',
  'organizations',
  'boundaries',
  'equipment',
  'crop-types',
  'assets',
  'users',
  'operators',
  'files',
  'flags',
  'guidance-lines',
  'map-layers',
  'products',
  'webhook',
  'connection-management',

  // Precision Tech / Machine Data (10)
  'notifications',
  'machine-locations',
  'machine-alerts',
  'machine-device-state-reports',
  'machine-engine-hours',
  'machine-hours-of-operation',
  'harvest-id',
  'aemp',
  'equipment-measurement',
  'partnerships',
];
const API_SLUG_SET = new Set(API_SLUGS);

async function fetchApiSpec(slug: string): Promise<ValidatedFetchedSpec | null> {
  const url = `${BASE_URL}/${slug}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    return validateFetchedSpec(slug, data, API_SLUG_SET);
  } catch (error) {
    console.error(`Error fetching ${slug}:`, error);
    return null;
  }
}

async function main() {
  console.log('Fetching John Deere OpenAPI specifications...\n');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const foundSpecs: ValidatedFetchedSpec[] = [];
  const notFound: string[] = [];

  for (const slug of API_SLUGS) {
    process.stdout.write(`Fetching ${slug}...`);
    const spec = await fetchApiSpec(slug);
    if (spec) {
      foundSpecs.push(spec);
      console.log(' OK');
    } else {
      notFound.push(slug);
      console.log(' Not found');
    }
  }

  console.log(`\nResults: ${foundSpecs.length} found, ${notFound.length} not found`);

  // Save individual specs (normalize line endings to LF)
  for (const spec of foundSpecs) {
    const { slug } = spec;
    const filename = `${slug}.yaml`;
    // Materializes validated OpenAPI YAML from the trusted Deere API slug catalog.
    // codeql[js/http-to-file-access]
    writeFileSync(join(OUTPUT_DIR, filename), spec.ymlContent);
  }

  // Create summary file
  const summary = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    specs: foundSpecs.map((spec) => ({
      id: spec.id,
      name: spec.name,
      file: `${spec.slug}.yaml`,
    })),
    notFound,
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nSpecs saved to: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm fix-specs` to fix common issues');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
