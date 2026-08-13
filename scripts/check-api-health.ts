#!/usr/bin/env npx tsx
/**
 * Checks whether John Deere's published specs are still usable by this
 * pipeline. Used by GitHub Actions to track API health and drive the badge.
 *
 * Two things this file used to get wrong, both fixed here.
 *
 * It carried its own copy of the spec list, so it kept probing
 * `field-operations-api` after the portal renamed it. The list now comes from
 * scripts/spec-registry.yaml, the same source scripts/fetch-specs.ts uses.
 *
 * More subtly, it decided "healthy" with its own heuristic (does every
 * returned document carry more than ten characters of content). That is a
 * second opinion, and it disagreed with the pipeline: it reported
 * `notifications` healthy for three months while fetch-specs could not use
 * that document at all. Health now means exactly what the sync means by it,
 * because both call validateFetchedSpecDocs. A badge that grades on an easier
 * curve than the build is worse than no badge.
 *
 * A registry-frozen spec is reported as its own state rather than being
 * rounded up to healthy or down to broken, and does not fail this check: the
 * freeze is a recorded decision, and re-alarming on it daily is what trains
 * people to ignore the alarm. It is still probed every run so the report can
 * say whether the freeze could now be lifted.
 */

import { validateFetchedSpecDocs } from './lib/fetched-spec-utils.js';
import { loadSpecRegistry, type SpecRegistryEntry } from './lib/spec-registry.js';

const BASE_URL = 'https://developer.deere.com/devDoc/apiDetails';

const REGISTRY_ENTRIES: SpecRegistryEntry[] = loadSpecRegistry().entries;

/**
 * The outcome of probing one slug, before the registry's freeze status is
 * applied. `invalid` means the portal served documents that this pipeline
 * cannot consume, which is a different failure from not serving them at all.
 */
type ProbeStatus = 'healthy' | 'invalid' | 'error';

interface Probe {
  status: ProbeStatus;
  /** The API name the portal reports, when it returned any documents. */
  name?: string;
  docCount?: number;
  /** HTTP status, when the portal answered with one. */
  code?: number;
  /** Failure detail: a network message, or why validation rejected the docs. */
  message?: string;
}

interface ApiResult extends Probe {
  /** The internal spec name, as declared in the registry. */
  slug: string;
  /** Present only for registry-frozen specs. */
  frozen?: {
    since: string;
    /**
     * True when the probe now succeeds despite the freeze, i.e. the freeze may
     * be liftable. Surfaced so a stale freeze cannot quietly become permanent.
     */
    liftable: boolean;
  };
}

interface HealthReport {
  timestamp: string;
  total: number;
  /** Active specs this pipeline could consume right now. */
  healthy: number;
  /** Registry-frozen specs. Neither healthy nor a failure. */
  frozen: number;
  /** Active specs the portal served but validation rejected. */
  invalid: number;
  /** Active specs the portal did not serve at all. */
  errors: number;
  apis: ApiResult[];
}

async function probeApi(entry: SpecRegistryEntry): Promise<Probe> {
  let data: unknown;
  try {
    const response = await fetch(`${BASE_URL}/${entry.slug}`);
    if (!response.ok) {
      return { status: 'error', code: response.status };
    }
    data = await response.json();
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }

  const docs = validateFetchedSpecDocs(entry.name, data, new Set([entry.name]));
  if (docs === null) {
    const served = Array.isArray(data) ? data.length : 0;
    return {
      status: 'invalid',
      docCount: served,
      message:
        served === 0
          ? 'portal returned no documents'
          : `portal returned ${served} document(s), but not all are usable OpenAPI 3`,
    };
  }
  return { status: 'healthy', name: docs[0].name, docCount: docs.length };
}

async function checkApi(entry: SpecRegistryEntry): Promise<ApiResult> {
  const probe = await probeApi(entry);
  if (!entry.frozen) {
    return { slug: entry.name, ...probe };
  }
  return {
    slug: entry.name,
    ...probe,
    frozen: { since: entry.frozen.since, liftable: probe.status === 'healthy' },
  };
}

function describe(result: ApiResult): string {
  const detail = result.code ? `HTTP ${result.code}` : (result.message ?? result.status);
  return `${result.slug} (${detail})`;
}

async function main(): Promise<void> {
  console.error('Checking John Deere API availability...\n');

  const results = await Promise.all(REGISTRY_ENTRIES.map(checkApi));

  const frozen = results.filter((r) => r.frozen);
  const active = results.filter((r) => !r.frozen);
  const healthy = active.filter((r) => r.status === 'healthy');
  const invalid = active.filter((r) => r.status === 'invalid');
  const errors = active.filter((r) => r.status === 'error');

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    total: REGISTRY_ENTRIES.length,
    healthy: healthy.length,
    frozen: frozen.length,
    invalid: invalid.length,
    errors: errors.length,
    apis: results,
  };

  // Summary to stderr (for logs); the JSON below goes to stdout for the file.
  console.error(`Results: ${healthy.length}/${REGISTRY_ENTRIES.length} healthy`);
  if (frozen.length > 0) {
    console.error(
      `Frozen (recorded in scripts/spec-registry.yaml, not a failure): ` +
        `${frozen.map((f) => `${f.slug} since ${f.frozen?.since}`).join(', ')}`
    );
    const liftable = frozen.filter((f) => f.frozen?.liftable);
    if (liftable.length > 0) {
      console.error(
        `  These frozen specs now fetch and validate cleanly, so their freeze may be ` +
          `liftable: ${liftable.map((f) => f.slug).join(', ')}`
      );
    }
  }
  if (invalid.length > 0) {
    console.error(`Unusable specs: ${invalid.map(describe).join(', ')}`);
  }
  if (errors.length > 0) {
    console.error(`Errors: ${errors.map(describe).join(', ')}`);
  }

  console.log(JSON.stringify(report, null, 2));

  // Fail on the same condition the sync fails on: an ACTIVE spec this pipeline
  // cannot consume. A frozen spec is an accepted, documented decision, so it
  // is reported every run but never fails this check.
  if (invalid.length > 0 || errors.length > 0) {
    process.exit(1);
  }
}

main();
