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

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';
const OUTPUT_DIR = join(process.cwd(), 'specs', 'raw');

// All known John Deere Operations Center APIs
const API_SLUGS = [
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
  'work-plans',
  'webhook',
  'connection-management',
];

interface ApiResponse {
  id: number;
  name: string;
  yml_content: string;
}

async function fetchApiSpec(slug: string): Promise<ApiResponse | null> {
  const url = `${BASE_URL}/${slug}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as ApiResponse[];
    return data[0] || null;
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

  const foundSpecs: ApiResponse[] = [];
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
    const filename = `${spec.name}.yaml`;
    const normalized = spec.yml_content.replace(/\r\n/g, '\n');
    writeFileSync(join(OUTPUT_DIR, filename), normalized);
  }

  // Create summary file
  const summary = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    specs: foundSpecs.map((s) => ({
      id: s.id,
      name: s.name,
      file: `${s.name}.yaml`,
    })),
    notFound,
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\nSpecs saved to: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm fix-specs` to fix common issues');
}

main().catch(console.error);
