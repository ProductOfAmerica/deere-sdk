#!/usr/bin/env npx tsx
/**
 * Checks if John Deere API specs are still available.
 * Used by GitHub Actions to track API health.
 *
 * Which specs to check, and the portal slug each is served under, come from
 * scripts/spec-registry.yaml, the same source scripts/fetch-specs.ts uses.
 * This file previously carried its own copy of the list, which is how it kept
 * probing `field-operations-api` after the portal had renamed it.
 */

import { loadSpecRegistry, type SpecRegistryEntry } from './lib/spec-registry.js';

const REGISTRY_ENTRIES: SpecRegistryEntry[] = loadSpecRegistry().entries;

/** An internal spec name, as declared in the registry. */
type ApiSlug = string;

interface ApiHealthyResult {
  slug: ApiSlug;
  status: 'healthy';
  name: string;
  docCount: number;
}

interface ApiEmptyResult {
  slug: ApiSlug;
  status: 'empty';
  name: string;
  docCount: number;
}

interface ApiErrorResult {
  slug: ApiSlug;
  status: 'error';
  code?: number;
  message?: string;
}

type ApiResult = ApiHealthyResult | ApiEmptyResult | ApiErrorResult;

interface ApiSpecResponse {
  name?: string;
  yml_content?: string;
}

interface HealthReport {
  timestamp: string;
  total: number;
  healthy: number;
  empty: number;
  errors: number;
  apis: ApiResult[];
}

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';

async function checkApi(entry: SpecRegistryEntry): Promise<ApiResult> {
  const slug = entry.name;
  try {
    const response = await fetch(`${BASE_URL}/${entry.slug}`);
    if (!response.ok) {
      return { slug, status: 'error', code: response.status };
    }
    const data = (await response.json()) as ApiSpecResponse[];
    const docs = Array.isArray(data) ? data : [];
    // The portal returns multiple documents for 7 of 28 slugs; a slug is
    // healthy only when every returned document carries real content.
    const hasContent = docs.length > 0 && docs.every((doc) => (doc?.yml_content?.length ?? 0) > 10);
    return {
      slug,
      status: hasContent ? 'healthy' : 'empty',
      name: docs[0]?.name || slug,
      docCount: docs.length,
    };
  } catch (error) {
    return { slug, status: 'error', message: (error as Error).message };
  }
}

async function main(): Promise<void> {
  console.error('Checking John Deere API availability...\n');

  const results = await Promise.all(REGISTRY_ENTRIES.map(checkApi));

  const healthy = results.filter((r): r is ApiHealthyResult => r.status === 'healthy');
  const empty = results.filter((r): r is ApiEmptyResult => r.status === 'empty');
  const errors = results.filter((r): r is ApiErrorResult => r.status === 'error');

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    total: REGISTRY_ENTRIES.length,
    healthy: healthy.length,
    empty: empty.length,
    errors: errors.length,
    apis: results,
  };

  // Print summary to stderr (for logs)
  console.error(`Results: ${healthy.length}/${REGISTRY_ENTRIES.length} healthy`);
  if (empty.length > 0) {
    console.error(`Empty specs: ${empty.map((e) => e.slug).join(', ')}`);
  }
  if (errors.length > 0) {
    console.error(`Errors: ${errors.map((e) => `${e.slug} (${e.code || e.message})`).join(', ')}`);
  }

  // Print JSON to stdout (for file output)
  console.log(JSON.stringify(report, null, 2));

  // Exit with error if any APIs are unhealthy
  if (empty.length > 0 || errors.length > 0) {
    process.exit(1);
  }
}

main();
