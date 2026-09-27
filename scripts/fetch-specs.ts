#!/usr/bin/env tsx
/**
 * Fetches John Deere OpenAPI specs from their developer portal.
 *
 * Usage: pnpm fetch-specs
 *
 * Which specs to fetch, and the portal slug each is served under, come from
 * scripts/spec-registry.yaml. The specs are fetched from:
 *   https://developer.deere.com/devDoc/apiDetails/{slug}
 *
 * The portal returns one or more documents per slug. Every document is
 * validated (validateFetchedSpecDocs), parsed, and, when a slug returns more
 * than one document, structurally merged into a single spec (mergeSpecDocs).
 * The merged (or single) document is then canonicalized so an upstream
 * reorder of `paths` or `components` produces a byte-identical raw file
 * instead of a misleading diff.
 *
 * A spec that cannot be fetched or validated FAILS THE RUN unless the registry
 * marks it frozen. Before that gate, a failure printed "Not found" and exited
 * 0, so a spec could silently stop being refreshed while the nightly sync
 * reported success; `notifications` did exactly that for three months.
 *
 * Output:
 *   - specs/raw/*.yaml (one file per active spec)
 *   - specs/raw/summary.json (fetch metadata; write-only, no consumers)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { assessContractContinuity, isDiscontinuous } from './lib/contract-continuity.js';
import { type ValidatedFetchedDoc, validateFetchedSpecDocs } from './lib/fetched-spec-utils.js';
import { explainSlug, fetchPortalCatalog } from './lib/portal-catalog.js';
import { findSpecOverride, loadRoutingOverrides } from './lib/routing-overrides.js';
import { canonicalizeSpec, stringifySpec } from './lib/spec-canonicalize.js';
import { type FetchedDoc, mergeSpecDocs } from './lib/spec-merge.js';
import { loadSpecRegistry, type SpecRegistryEntry } from './lib/spec-registry.js';
import { isRecord } from './lib/spec-utils.js';

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';
const OUTPUT_DIR = join(process.cwd(), 'specs', 'raw');

/**
 * Retry budget for a single slug. Covers a transient portal blip only: a 404
 * is a real answer and is never retried. Kept small because the gate below
 * fails the run on the first genuinely failed refresh, so the only job here is
 * to tell "the portal is down" apart from "one packet dropped".
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [500, 1500];

/** How many missing operations the block detail lists before summarizing. */
const MAX_MISSING_SHOWN = 10;

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

/**
 * Why a slug did not yield usable documents. The old code collapsed all of
 * these to `null` and printed the same "Not found" for every one, which is how
 * a 404 (upstream rename) and a validation rejection (our own validator) were
 * indistinguishable in the logs for three months.
 */
type FetchOutcome =
  | { kind: 'ok'; docs: ValidatedFetchedDoc[] }
  | { kind: 'http'; status: number }
  | { kind: 'rejected' }
  | { kind: 'network'; message: string };

/** Describes an outcome in one line, for both the progress log and the gate. */
function describeOutcome(outcome: FetchOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return 'ok';
    case 'http':
      return `HTTP ${outcome.status}`;
    case 'rejected':
      return 'portal returned documents, but none passed validateFetchedSpecDocs';
    case 'network':
      return `network error: ${outcome.message}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient enough to be worth another attempt. A 4xx is a real answer. */
function isRetryable(outcome: FetchOutcome): boolean {
  return outcome.kind === 'network' || (outcome.kind === 'http' && outcome.status >= 500);
}

async function attemptFetch(entry: SpecRegistryEntry): Promise<FetchOutcome> {
  const url = `${BASE_URL}/${entry.slug}`;
  let data: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { kind: 'http', status: response.status };
    }
    data = await response.json();
  } catch (error) {
    return { kind: 'network', message: error instanceof Error ? error.message : String(error) };
  }
  // Outside the try: a throw from validateFetchedSpecDocs means an untrusted
  // slug reached it, which is a config error, not a network condition, and
  // must not be swallowed as a retryable blip.
  const docs = validateFetchedSpecDocs(entry.name, data, new Set([entry.name]));
  if (docs === null) {
    return { kind: 'rejected' };
  }
  return { kind: 'ok', docs };
}

async function fetchApiSpec(entry: SpecRegistryEntry): Promise<FetchOutcome> {
  let outcome = await attemptFetch(entry);
  for (let attempt = 1; attempt < MAX_ATTEMPTS && isRetryable(outcome); attempt++) {
    const wait = RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1];
    console.log(
      `\n  ${entry.name}: ${describeOutcome(outcome)}; retrying in ${wait}ms ` +
        `(attempt ${attempt + 1}/${MAX_ATTEMPTS})`
    );
    await delay(wait);
    outcome = await attemptFetch(entry);
  }
  return outcome;
}

/**
 * The identity guard, run on the merged document just before it would
 * overwrite specs/raw/<name>.yaml. It measures one thing: how much of the
 * contract we committed under this name the slug still serves. A slug
 * repointed at a different API keeps essentially none of it, so the raw file
 * would be overwritten with another API's contract under our filename.
 *
 * Deliberately not an upstream id comparison; see the tombstone in
 * scripts/spec-registry.yaml for what api_id was measured to be. Counting and
 * the block decision (MIN_SURVIVAL, and the baseline floor under it) both live
 * in lib/contract-continuity.ts; this function only reads the baseline off
 * disk and reports. Returns a block detail, or null to proceed.
 */
function checkContractContinuity(entry: SpecRegistryEntry, merged: unknown): string | null {
  const rawFile = join(OUTPUT_DIR, `${entry.name}.yaml`);
  if (!existsSync(rawFile)) {
    console.log(
      `\n  ${entry.name}: no committed specs/raw/${entry.name}.yaml, so this spec is new and ` +
        `has no continuity baseline; check skipped`
    );
    return null;
  }
  let committed: unknown;
  try {
    committed = yaml.parse(readFileSync(rawFile, 'utf-8'));
  } catch (error) {
    // Only identity is in scope here. fix-specs and generate-types are what
    // validate that the committed file is a usable document.
    console.log(
      `\n  ${entry.name}: committed specs/raw/${entry.name}.yaml does not parse as YAML ` +
        `(${error instanceof Error ? error.message : String(error)}), so there is no ` +
        `continuity baseline; check skipped`
    );
    return null;
  }

  const result = assessContractContinuity(committed, merged);
  const { committedCount, survivingCount, missing } = result;
  if (committedCount === 0) {
    console.log(
      `\n  ${entry.name}: committed specs/raw/${entry.name}.yaml has no recognizable operations, ` +
        `so there is no continuity baseline; check skipped`
    );
    return null;
  }
  if (!isDiscontinuous(result)) {
    return null;
  }

  const shown = missing.slice(0, MAX_MISSING_SHOWN);
  const rest = missing.length - shown.length;
  return (
    `${missing.length} of ${committedCount} committed operations in specs/raw/${entry.name}.yaml ` +
    `no longer appear in what slug "${entry.slug}" now serves (${survivingCount} still appear). ` +
    `Missing: ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}. A loss this size is ` +
    `consistent with the slug having been repointed at a different API upstream. This check ` +
    `cannot tell that apart from a heavy rewrite of the same API, so both remediations stand: ` +
    `if the slug really was repointed, what "${entry.slug}" now is, and what specs/raw/` +
    `${entry.name}.yaml should therefore be, is a human decision; if upstream genuinely rewrote ` +
    `the API this heavily, delete specs/raw/${entry.name}.yaml to drop the old baseline and ` +
    `rerun, after which the manifest classification in scripts/api-surface.yaml still accounts ` +
    `for every removed method as breaking.`
  );
}

/**
 * Parse every fetched document's (already redacted) YAML content for one
 * slug. A parse failure here is unexpected: validateFetchedSpecDocs already
 * confirmed each document parses and satisfies isOpenApiDocument. Wrapped
 * per-slug (not per-document) so a failure names both the slug and the
 * endpoint name of the document that failed, then returns null so the caller
 * can block that spec and move on to the next one.
 */
function parseSlugDocs(specName: string, docs: ValidatedFetchedDoc[]): FetchedDoc[] | null {
  let current: ValidatedFetchedDoc | undefined;
  try {
    return docs.map((doc) => {
      current = doc;
      return { endPointName: doc.endPointName, id: doc.id, doc: yaml.parse(doc.ymlContent) };
    });
  } catch (error) {
    const where = current ? `${specName} (${current.endPointName})` : specName;
    console.error(`  Failed to parse fetched YAML for ${where}: ${error}`);
    return null;
  }
}

/**
 * Read back the merge order mergeSpecDocs stamped onto the merged document's
 * `x-source-documents` extension field (primary document first, then the
 * rest sorted by endPointName). fetch-specs has no access to spec-merge's
 * private primary-selection table, so this stamped field is the only way to
 * learn which document mergeSpecDocs chose as primary.
 */
function extractSourceDocuments(specName: string, merged: unknown): SourceDocRef[] {
  const sourceDocuments = isRecord(merged) ? merged['x-source-documents'] : undefined;
  if (!Array.isArray(sourceDocuments)) {
    throw new Error(
      `Internal error: mergeSpecDocs did not stamp x-source-documents for multi-document spec "${specName}".`
    );
  }
  return sourceDocuments as SourceDocRef[];
}

function findDocById(
  specName: string,
  docs: ValidatedFetchedDoc[],
  id: number
): ValidatedFetchedDoc {
  const found = docs.find((doc) => doc.id === id);
  if (!found) {
    throw new Error(
      `Internal error: document id ${id} not found among fetched documents for spec "${specName}".`
    );
  }
  return found;
}

async function main() {
  console.log('Fetching John Deere OpenAPI specifications...\n');

  const registry = loadSpecRegistry();
  const frozenCount = registry.entries.filter((e) => e.frozen).length;
  console.log(
    `Registry: ${registry.entries.length} specs (${registry.entries.length - frozenCount} active, ` +
      `${frozenCount} frozen)\n`
  );

  // Only consulted for acknowledgedDivergentServers here; fix-specs applies the
  // overrides themselves. Loaded up front so a malformed registry fails before
  // any spec is written.
  const routingOverrides = loadRoutingOverrides();

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const processed: ProcessedSpec[] = [];
  const frozen: string[] = [];
  /**
   * Active specs that did not yield a usable document. Fails the run below.
   * `kind` separates "the slug did not give us a document" from "it gave us a
   * different API's document": only the former can be explained by the portal
   * catalog, since a continuity block means the fetch itself succeeded and the
   * catalog therefore still lists the slug.
   */
  const blocked: { entry: SpecRegistryEntry; kind: 'fetch' | 'continuity'; detail: string }[] = [];

  for (const entry of registry.entries) {
    const { name } = entry;
    process.stdout.write(`Fetching ${name}...`);
    const outcome = await fetchApiSpec(entry);

    if (entry.frozen) {
      // A frozen spec is still fetched, purely so the log can say whether the
      // freeze could now be lifted. Its file is never written, and it can
      // never fail the run.
      frozen.push(name);
      console.log(
        outcome.kind === 'ok'
          ? ` FROZEN (since ${entry.frozen.since}; fetches cleanly today, which is a fact ` +
              `about the fetch and not a reason to unfreeze: see its reason in ` +
              `scripts/spec-registry.yaml)`
          : ` FROZEN (since ${entry.frozen.since}; ${describeOutcome(outcome)})`
      );
      continue;
    }

    if (outcome.kind !== 'ok') {
      blocked.push({ entry, kind: 'fetch', detail: describeOutcome(outcome) });
      console.log(` BLOCKED (${describeOutcome(outcome)})`);
      continue;
    }

    const docs = outcome.docs;
    const parsedDocs = parseSlugDocs(name, docs);
    if (!parsedDocs) {
      blocked.push({ entry, kind: 'fetch', detail: 'fetched documents failed to parse as YAML' });
      console.log(' BLOCKED (parse failed)');
      continue;
    }

    const merged =
      parsedDocs.length > 1
        ? mergeSpecDocs(name, parsedDocs, {
            onWarning: (message) => console.log(message),
            // A slug whose documents declare different server families only
            // merges when a human has recorded why, with evidence, in
            // scripts/routing-overrides.yaml.
            acknowledgedDivergentServers:
              findSpecOverride(routingOverrides, name)?.acknowledgedDivergentServers ?? false,
          })
        : parsedDocs[0].doc;

    // Identity is checked here, against the merged document and before the
    // write below, because the merged document is the first point at which
    // what the slug serves is comparable to what we committed.
    const discontinuity = checkContractContinuity(entry, merged);
    if (discontinuity) {
      blocked.push({ entry, kind: 'continuity', detail: discontinuity });
      console.log(' BLOCKED (contract discontinuity)');
      continue;
    }

    const canonical = canonicalizeSpec(merged);

    // Raw files are now re-serialized canonical YAML rather than
    // portal-verbatim text: redaction already ran per document, BEFORE
    // parse, preserving spec-redactor's line-anchored regex assumptions, so
    // this stringify is purely a formatting step. `pnpm redact-specs`
    // remains downstream as an idempotent safety net, not the primary
    // redaction path.
    const yamlText = stringifySpec(canonical);
    // Materializes validated, merged, and canonicalized OpenAPI YAML. The
    // filename comes from the committed registry's spec name (validated
    // against /^[a-z0-9]+(-[a-z0-9]+)*$/ by loadSpecRegistry), never from
    // portal data.
    // codeql[js/http-to-file-access]
    writeFileSync(join(OUTPUT_DIR, `${name}.yaml`), yamlText);

    const sourceDocs =
      parsedDocs.length > 1
        ? extractSourceDocuments(name, merged)
        : [{ id: parsedDocs[0].id, endPointName: parsedDocs[0].endPointName }];
    const primary = findDocById(name, docs, sourceDocs[0].id);

    processed.push({
      id: primary.id,
      name: primary.name,
      file: `${name}.yaml`,
      docs: sourceDocs,
    });

    console.log(docs.length > 1 ? ` OK (${docs.length} documents merged)` : ' OK');
  }

  console.log(
    `\nResults: ${processed.length} written, ${frozen.length} frozen, ${blocked.length} blocked`
  );

  // Write-only metadata file: nothing in this repo or its CI workflows reads
  // it back (sync-api.yml explicitly excludes summary.json from change
  // detection). The registry, not this file, is what the pipeline gates on.
  const summary = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    specs: processed,
    frozen,
    blocked: blocked.map((b) => b.entry.name),
  };

  writeFileSync(join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  // The gate. Reported after the whole loop so one run names every broken
  // spec rather than surfacing them one failed build at a time.
  if (blocked.length > 0) {
    console.error(
      `\nfetch-specs: ${blocked.length} active spec(s) could not be refreshed. Failing the run: ` +
        `continuing would regenerate the SDK from stale committed specs while reporting success, ` +
        `which is how notifications went three months without anyone noticing.\n`
    );
    // Consulted only now, on an already-failed run, and only when a block the
    // catalog can actually explain is present, so a healthy sync never pays for
    // it and neither does a run whose blocks are all continuity (there the
    // fetch succeeded, so the catalog lists the slug and its hint would be
    // false). Null when the landing page is unreachable or its shape has moved.
    const anyFetchBlock = blocked.some((b) => b.kind === 'fetch');
    const catalog = anyFetchBlock ? await fetchPortalCatalog() : null;
    if (anyFetchBlock && !catalog) {
      console.error(`  (the portal catalog could not be read, so no rename hints below)\n`);
    }

    for (const { entry, kind, detail } of blocked) {
      console.error(`  ${entry.name}: ${detail}`);
      if (kind === 'fetch' && catalog) {
        for (const line of explainSlug(catalog, entry.slug)) {
          console.error(`    - ${line}`);
        }
      }
    }
    console.error(
      `\nRemediation, per spec:\n` +
        `  - upstream renamed the slug: repoint "slug:" in scripts/spec-registry.yaml. The\n` +
        `    internal spec name stays put; it is a public SpecName literal.\n` +
        `  - the spec is genuinely gone or cannot be validated for now: add "status: frozen"\n` +
        `    with a "reason:" and an evidence-derived "since:", which keeps the committed raw\n` +
        `    spec and stops this failing, while staying visible in every run's output.\n`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nSpecs saved to: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm fix-specs` to fix common issues');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
