#!/usr/bin/env tsx
/**
 * Fetches John Deere OpenAPI specs from their developer portal.
 *
 * Usage: pnpm fetch-specs
 *
 * The specs are fetched from:
 *   https://developer.deere.com/devDoc/apiDetails/{api-slug}
 *
 * The portal returns one or more documents per slug. Every document is
 * validated (validateFetchedSpecDocs), parsed, and, when a slug returns more
 * than one document, structurally merged into a single spec (mergeSpecDocs).
 * The merged (or single) document is then canonicalized so an upstream
 * reorder of `paths` or `components` produces a byte-identical raw file
 * instead of a misleading diff.
 *
 * Output:
 *   - specs/raw/*.yaml (one file per slug)
 *   - specs/raw/summary.json (fetch metadata; write-only, no consumers)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { type ValidatedFetchedDoc, validateFetchedSpecDocs } from './lib/fetched-spec-utils.js';
import { canonicalizeSpec, stringifySpec } from './lib/spec-canonicalize.js';
import { type FetchedDoc, mergeSpecDocs } from './lib/spec-merge.js';

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

/** A source-document reference as recorded in summary.json's per-spec `docs` list. */
interface SourceDocRef {
  id: number;
  endPointName: string;
}

interface ProcessedSpec {
  id: number;
  name: string;
  file: string;
  docs: SourceDocRef[];
}

async function fetchApiSpec(slug: string): Promise<ValidatedFetchedDoc[] | null> {
  const url = `${BASE_URL}/${slug}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    return validateFetchedSpecDocs(slug, data, API_SLUG_SET);
  } catch (error) {
    console.error(`Error fetching ${slug}:`, error);
    return null;
  }
}

/**
 * Parse every fetched document's (already redacted) YAML content for one
 * slug. A parse failure here is unexpected: validateFetchedSpecDocs already
 * confirmed each document parses and satisfies isOpenApiDocument. Wrapped
 * per-slug (not per-document) so a failure names both the slug and the
 * endpoint name of the document that failed, then returns null so the caller
 * can count the slug as failed and move on to the next one, mirroring the
 * existing not-found handling.
 */
function parseSlugDocs(slug: string, docs: ValidatedFetchedDoc[]): FetchedDoc[] | null {
  let current: ValidatedFetchedDoc | undefined;
  try {
    return docs.map((doc) => {
      current = doc;
      return { endPointName: doc.endPointName, id: doc.id, doc: yaml.parse(doc.ymlContent) };
    });
  } catch (error) {
    const where = current ? `${slug} (${current.endPointName})` : slug;
    console.error(`  Failed to parse fetched YAML for ${where}: ${error}`);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read back the merge order mergeSpecDocs stamped onto the merged document's
 * `x-source-documents` extension field (primary document first, then the
 * rest sorted by endPointName). fetch-specs has no access to spec-merge's
 * private primary-selection table, so this stamped field is the only way to
 * learn which document mergeSpecDocs chose as primary.
 */
function extractSourceDocuments(slug: string, merged: unknown): SourceDocRef[] {
  const sourceDocuments = isRecord(merged) ? merged['x-source-documents'] : undefined;
  if (!Array.isArray(sourceDocuments)) {
    throw new Error(
      `Internal error: mergeSpecDocs did not stamp x-source-documents for multi-document slug "${slug}".`
    );
  }
  return sourceDocuments as SourceDocRef[];
}

function findDocById(slug: string, docs: ValidatedFetchedDoc[], id: number): ValidatedFetchedDoc {
  const found = docs.find((doc) => doc.id === id);
  if (!found) {
    throw new Error(
      `Internal error: document id ${id} not found among fetched documents for slug "${slug}".`
    );
  }
  return found;
}

async function main() {
  console.log('Fetching John Deere OpenAPI specifications...\n');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const processed: ProcessedSpec[] = [];
  const notFound: string[] = [];
  let failedCount = 0;

  for (const slug of API_SLUGS) {
    process.stdout.write(`Fetching ${slug}...`);
    const docs = await fetchApiSpec(slug);
    if (!docs) {
      notFound.push(slug);
      console.log(' Not found');
      continue;
    }

    const parsedDocs = parseSlugDocs(slug, docs);
    if (!parsedDocs) {
      failedCount += 1;
      console.log(' FAILED');
      continue;
    }

    const merged =
      parsedDocs.length > 1
        ? mergeSpecDocs(slug, parsedDocs, { onWarning: (message) => console.log(message) })
        : parsedDocs[0].doc;
    const canonical = canonicalizeSpec(merged);

    // Raw files are now re-serialized canonical YAML rather than
    // portal-verbatim text: redaction already ran per document, BEFORE
    // parse, preserving spec-redactor's line-anchored regex assumptions, so
    // this stringify is purely a formatting step. `pnpm redact-specs`
    // remains downstream as an idempotent safety net, not the primary
    // redaction path.
    const yamlText = stringifySpec(canonical);
    // Materializes validated, merged, and canonicalized OpenAPI YAML from the
    // trusted Deere API slug catalog (the filename comes from API_SLUGS, not
    // portal data).
    // codeql[js/http-to-file-access]
    writeFileSync(join(OUTPUT_DIR, `${slug}.yaml`), yamlText);

    const sourceDocs =
      parsedDocs.length > 1
        ? extractSourceDocuments(slug, merged)
        : [{ id: parsedDocs[0].id, endPointName: parsedDocs[0].endPointName }];
    const primary = findDocById(slug, docs, sourceDocs[0].id);

    processed.push({
      id: primary.id,
      name: primary.name,
      file: `${slug}.yaml`,
      docs: sourceDocs,
    });

    console.log(docs.length > 1 ? ` OK (${docs.length} documents merged)` : ' OK');
  }

  console.log(
    `\nResults: ${processed.length} found, ${notFound.length} not found, ${failedCount} failed`
  );

  // Write-only metadata file: nothing in this repo or its CI workflows reads
  // it back (sync-api.yml explicitly excludes summary.json from change
  // detection).
  const summary = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    specs: processed,
    notFound,
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  if (failedCount > 0) {
    console.error(
      `fetch-specs: ${failedCount} slug(s) failed to parse; failing the run so CI cannot ship a corrupted raw spec.`
    );
    process.exitCode = 1;
  }

  console.log(`\nSpecs saved to: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm fix-specs` to fix common issues');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
