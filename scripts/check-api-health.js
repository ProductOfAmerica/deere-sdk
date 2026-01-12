#!/usr/bin/env node
/**
 * Checks if John Deere API specs are still available.
 * Used by GitHub Actions to track API health.
 */

const API_SLUGS = [
  // Operations Center (18)
  'assets',
  'boundaries',
  'clients',
  'connection-management',
  'crop-types',
  'equipment',
  'farms',
  'field-operations-api',
  'fields',
  'files',
  'flags',
  'guidance-lines',
  'map-layers',
  'operators',
  'organizations',
  'products',
  'users',
  'webhook',

  // Machine Data (10)
  'aemp',
  'equipment-measurement',
  'harvest-id',
  'machine-alerts',
  'machine-device-state-reports',
  'machine-engine-hours',
  'machine-hours-of-operation',
  'machine-locations',
  'notifications',
  'partnerships',
];

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';

async function checkApi(slug) {
  try {
    const response = await fetch(`${BASE_URL}/${slug}`);
    if (!response.ok) {
      return { slug, status: 'error', code: response.status };
    }
    const data = await response.json();
    const hasContent = data[0]?.yml_content?.length > 10;
    return {
      slug,
      status: hasContent ? 'healthy' : 'empty',
      name: data[0]?.name || slug,
    };
  } catch (error) {
    return { slug, status: 'error', message: error.message };
  }
}

async function main() {
  console.error('Checking John Deere API availability...\n');

  const results = await Promise.all(API_SLUGS.map(checkApi));

  const healthy = results.filter((r) => r.status === 'healthy');
  const empty = results.filter((r) => r.status === 'empty');
  const errors = results.filter((r) => r.status === 'error');

  const report = {
    timestamp: new Date().toISOString(),
    total: API_SLUGS.length,
    healthy: healthy.length,
    empty: empty.length,
    errors: errors.length,
    apis: results,
  };

  // Print summary to stderr (for logs)
  console.error(`Results: ${healthy.length}/${API_SLUGS.length} healthy`);
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
