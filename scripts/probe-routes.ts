#!/usr/bin/env tsx
/**
 * Asks John Deere's gateway whether every route the SDK ships actually exists.
 *
 * Usage: pnpm probe-routes
 *
 * This is the layer of the routing guard that tests THEIR system, not ours, so
 * it is deliberately not part of any build, and a Deere outage must not turn
 * this repo red; that is how an alarm gets trained into noise. Outages,
 * timeouts and unclassified responses therefore stay report-only.
 *
 * One finding does fail the run: a shipped route answering a deterministic
 * 404/403 while the controls validate. That is not an outage, it is Deere's
 * gateway stating the route is gone, and it is actionable here every time:
 * lift a freeze and cut the major, add a routing override, or drop the
 * method. Before 2026-08-22 that signal landed in a green run's log that
 * nobody opened; the partnerships migration made it the one event this repo
 * has to hear about (a frozen spec's held method keeps shipping only while
 * its route stays alive, and this exit is the tripwire that says it died).
 *
 * The hermetic guards (tests/routing-guard.test.ts) catch us manufacturing or
 * losing routing data. Only this catches Deere moving a route out from under a
 * correctly-derived URL, which is what happened to
 * GET /organizations/{orgId}/users and went unnoticed for months.
 *
 * Unauthenticated GET only. Nothing is created, modified or deleted, and no
 * credentials are involved.
 *
 * ---------------------------------------------------------------------------
 * The discriminator, and why it re-validates itself every run
 * ---------------------------------------------------------------------------
 *
 * Unauthenticated, Deere's gateway answers:
 *
 *   401  route exists, auth is checked before resource lookup
 *   405  route exists, GET is not allowed on it
 *   404  no such route
 *   403  no such base path (nginx, not the gateway)
 *
 * That mapping is an observation about someone else's infrastructure, not a
 * guarantee. If it silently changed, this script would emit confident verdicts
 * built on a false premise, which is precisely the failure the whole routing
 * guard exists to prevent. So it probes three controls first and refuses to
 * report anything if they stop separating.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import type { Environment, SpecName } from '../src/api-servers.generated.js';
import { resolveRequestUrl } from '../src/environment-resolver.js';

const SPECS_DIR = join(process.cwd(), 'specs', 'fixed');
const ENVIRONMENTS: Environment[] = ['api', 'sandboxapi', 'partnerapi', 'apicert'];
const CONCURRENCY = 8;

/** Substituted into `{param}` segments. Any value works: routing ignores it. */
const SAMPLE_PARAM = '00000000-0000-4000-8000-000000000000';

const CONTROLS = [
  {
    label: 'known-good route',
    url: 'https://api.deere.com/platform/organizations',
    expect: 401,
  },
  {
    label: 'known-bad route',
    url: 'https://api.deere.com/platform/zzzznotarealroute',
    expect: 404,
  },
  {
    label: 'known-bad base path',
    url: 'https://api.deere.com/zzzznotarealbase/organizations',
    expect: 403,
  },
] as const;

interface Probe {
  spec: string;
  path: string;
  environment: Environment;
  url: string;
  status: number;
}

const fill = (path: string) => path.replace(/\{[^}]+\}/g, SAMPLE_PARAM);

async function statusOf(url: string): Promise<number> {
  try {
    return (await fetch(url, { method: 'GET' })).status;
  } catch {
    return -1;
  }
}

/**
 * Returns false when the controls stop separating. The caller must then report
 * nothing: a verdict from an unvalidated discriminator is worse than silence,
 * because it looks like a measurement.
 */
async function discriminatorHolds(): Promise<boolean> {
  let ok = true;
  for (const control of CONTROLS) {
    const status = await statusOf(control.url);
    const passed = status === control.expect;
    console.log(
      `control ${passed ? 'ok  ' : 'FAIL'}  ${control.label}: expected ${control.expect}, got ${status}`
    );
    if (!passed) ok = false;
  }
  return ok;
}

function buildProbeList(): { spec: string; path: string; environment: Environment; url: string }[] {
  const jobs: { spec: string; path: string; environment: Environment; url: string }[] = [];

  for (const file of readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()) {
    const spec = file.replace(/\.yaml$/, '');
    const doc = yaml.parse(readFileSync(join(SPECS_DIR, file), 'utf-8'));

    for (const path of Object.keys(doc?.paths ?? {}).sort()) {
      for (const environment of ENVIRONMENTS) {
        let url: string;
        try {
          url = resolveRequestUrl(spec as SpecName, fill(path), environment);
        } catch {
          // The spec declares no URL for this environment. The resolver
          // refusing is correct behaviour, not a routing failure.
          continue;
        }
        jobs.push({ spec, path, environment, url });
      }
    }
  }
  return jobs;
}

async function runProbes(
  jobs: readonly { spec: string; path: string; environment: Environment; url: string }[]
): Promise<Probe[]> {
  const results: Probe[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        results.push({ ...job, status: await statusOf(job.url) });
      }
    })
  );
  return results;
}

async function main(): Promise<void> {
  console.log('Probing every route the SDK ships against the live gateway.\n');

  if (!(await discriminatorHolds())) {
    console.error(
      `\nDISCRIMINATOR INVALID: the control probes no longer separate a missing route from ` +
        `one that needs auth, so no routing verdict from this run would mean anything. ` +
        `Deere's gateway behaviour has changed; re-establish what its responses mean before ` +
        `trusting this script again. Reporting nothing rather than guessing.`
    );
    process.exitCode = 1;
    return;
  }

  const jobs = buildProbeList();
  const results = await runProbes(jobs);

  const exists = results.filter((r) => r.status === 401 || r.status === 405);
  const missing = results.filter((r) => r.status === 404 || r.status === 403);
  const unknown = results.filter((r) => ![401, 405, 404, 403].includes(r.status));

  const paths = new Set(results.map((r) => `${r.spec} ${r.path}`)).size;
  console.log(
    `\nProbed ${results.length} (path, environment) pairs over ${paths} paths in ` +
      `${ENVIRONMENTS.join(', ')}`
  );
  console.log(`  route exists (401/405): ${exists.length}`);
  console.log(`  NO SUCH ROUTE (404/403): ${missing.length}`);
  console.log(`  unclassified: ${unknown.length}`);

  if (missing.length > 0) {
    const grouped = new Map<string, Probe[]>();
    for (const probe of missing) {
      const key = `${probe.spec}: ${probe.path}`;
      grouped.set(key, [...(grouped.get(key) ?? []), probe]);
    }
    console.log(`\n${grouped.size} path(s) resolve to a URL that does not exist:\n`);
    for (const [key, probes] of [...grouped].sort()) {
      console.log(`  ${key}`);
      console.log(`    ${probes[0].url}`);
      console.log(`    ${probes.map((p) => `${p.environment}(${p.status})`).join(' ')}`);
    }
    console.log(
      `\nEach is one of: Deere moved the route (repoint it in ` +
        `scripts/routing-overrides.yaml with the measurement above as evidence), Deere ` +
        `retired it (drop the operation, a major-version decision), or this pipeline built ` +
        `the wrong URL (fix the pipeline, and tests/routing-guard.test.ts should have caught ` +
        `it, so work out why it did not).`
    );
  }

  if (unknown.length > 0) {
    console.log(`\n${unknown.length} unclassified response(s), neither existence nor absence:`);
    for (const probe of unknown.slice(0, 20)) {
      console.log(`  [${probe.status}] ${probe.environment} ${probe.spec}: ${probe.path}`);
    }
  }

  // Deterministic absence fails the run: the controls validated this run, so
  // a 404/403 is Deere's gateway stating the route is gone, not an outage.
  // Everything else (5xx, timeouts, unclassified) stays report-only; a third
  // party's incident must not fail our builds.
  if (missing.length > 0) {
    console.log(
      '\nFailing the run: a shipped route that deterministically does not exist is ' +
        'actionable every time, and a green run buries it.'
    );
    process.exitCode = 2;
    return;
  }
  console.log('\nEvery route the SDK ships exists upstream.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
