/**
 * `npm version` runs the `version` script before it commits and tags, and
 * release.yml runs its checks on the tagged commit before it builds. A check
 * only release.yml runs lets a releaser tag a commit that will never publish,
 * so the local script must run every check release.yml runs before its build.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as yaml from 'yaml';

interface Step {
  name?: string;
  run?: string;
}

function releaseChecks(): string[] {
  const workflow = yaml.parse(readFileSync('.github/workflows/release.yml', 'utf-8')) as {
    jobs: { release: { steps: Step[] } };
  };
  const steps = workflow.jobs.release.steps;
  const build = steps.findIndex((s) => s.run?.trim() === 'pnpm build');
  assert.ok(build > 0, 'release.yml has no `pnpm build` step in its release job');
  return steps
    .slice(0, build)
    .map((s) => s.run?.trim())
    .filter((run): run is string => run !== undefined && !run.startsWith('pnpm install'));
}

describe('the version script', () => {
  it('runs every check release.yml runs before it builds', () => {
    const checks = releaseChecks();
    assert.ok(checks.length > 0, 'found no checks before the build step in release.yml');

    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts.version;
    assert.ok(script, 'package.json has no version script');
    const commands = script.split('&&').map((c) => c.trim());
    for (const check of checks) {
      assert.ok(commands.includes(check), `the version script does not run \`${check}\``);
    }
  });
});
