/**
 * Snapshot regression tests for the generated api-servers.generated.ts.
 *
 * Asserts that the v2.0 URL resolution contract is encoded correctly in the
 * generated data for the current committed spec set. If JD's specs change or
 * scripts/generate-api-servers.ts regresses its classifier, these tests
 * catch it by asserting specific invariants — NOT byte-level snapshots,
 * which would be too brittle.
 *
 * The daily sync runs this suite on the freshly regenerated tree before it
 * commits. So a test here that writes down a fact about John Deere's specs
 * stops the sync on the day that fact changes. That is the intent for a fact
 * a person should look at before it ships (which host an environment reaches,
 * a new environment name). Anything else should not be written down here: it
 * either follows from the data or is not worth stopping the sync for.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  API_SERVERS,
  DEFAULT_ENVIRONMENT,
  type Environment,
  KNOWN_ENVIRONMENTS,
  type SpecName,
} from '../src/api-servers.generated.js';

describe('api-servers.generated.ts — invariants for the current spec set', () => {
  describe('KNOWN_ENVIRONMENTS', () => {
    // Written out on purpose, and meant to stop the sync: an environment is a
    // public type and a hostname requests are sent to.
    it('contains the 9 expected subdomain values', () => {
      const expected: Environment[] = [
        'api',
        'sandboxapi',
        'partnerapi',
        'apicert',
        'apiqa.tal',
        'partnerapicert',
        'partnerapiqa',
        'sandboxapiqa',
        'apidev.tal',
      ];
      assert.deepStrictEqual(
        [...KNOWN_ENVIRONMENTS],
        expected,
        'The set of environments changed, most likely because John Deere added one to a ' +
          "spec's servers enum. Before accepting it: decide its tier in ENV_TIER and its place " +
          'in the canonical order (both in scripts/generate-api-servers.ts), and add it to the ' +
          "README's environment table and to the `environment` option's doc comment in " +
          'src/client.ts. Then update the list in this test.'
      );
    });

    it('DEFAULT_ENVIRONMENT is sandboxapi (safe-by-default)', () => {
      assert.strictEqual(DEFAULT_ENVIRONMENT, 'sandboxapi');
    });

    it('every DEFAULT_ENVIRONMENT value is in KNOWN_ENVIRONMENTS', () => {
      assert(KNOWN_ENVIRONMENTS.includes(DEFAULT_ENVIRONMENT));
    });
  });

  describe('API_SERVERS — spec coverage', () => {
    it('has at least 28 spec entries', () => {
      assert(Object.keys(API_SERVERS).length >= 28);
    });

    it('every entry has a valid kind discriminator', () => {
      for (const [specName, config] of Object.entries(API_SERVERS)) {
        assert(
          config.kind === 'templated' || config.kind === 'static' || config.kind === 'unavailable',
          `${specName} has invalid kind: ${(config as { kind?: string }).kind}`
        );
      }
    });

    it('every supported env on a templated spec is in KNOWN_ENVIRONMENTS', () => {
      for (const [specName, config] of Object.entries(API_SERVERS)) {
        if (config.kind === 'templated') {
          for (const env of config.supportedEnvironments) {
            assert(KNOWN_ENVIRONMENTS.includes(env), `${specName} references unknown env: ${env}`);
          }
        }
      }
    });
  });

  describe('equipment (single-host static)', () => {
    it('is kind=static', () => {
      const config = API_SERVERS.equipment;
      assert.strictEqual(config.kind, 'static');
    });

    it('supports only prod-tier envs (api, partnerapi)', () => {
      const config = API_SERVERS.equipment;
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.api, 'https://equipmentapi.deere.com/isg');
      assert.strictEqual(config.urlByEnvironment.partnerapi, 'https://equipmentapi.deere.com/isg');
    });

    it('does NOT support sandboxapi, apicert, apiqa.tal, apidev.tal', () => {
      const config = API_SERVERS.equipment;
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.sandboxapi, undefined);
      assert.strictEqual(config.urlByEnvironment.apicert, undefined);
      assert.strictEqual(config.urlByEnvironment['apiqa.tal'], undefined);
      assert.strictEqual(config.urlByEnvironment['apidev.tal'], undefined);
    });
  });

  describe('equipment-measurement (multi-host static with proxy-info)', () => {
    it('maps api + partnerapi to the bare prod host', () => {
      const config = API_SERVERS['equipment-measurement'];
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.api, 'https://equipmentapi.deere.com/isg');
      assert.strictEqual(config.urlByEnvironment.partnerapi, 'https://equipmentapi.deere.com/isg');
    });

    it('maps apicert + partnerapicert to the -cert variant', () => {
      const config = API_SERVERS['equipment-measurement'];
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(
        config.urlByEnvironment.apicert,
        'https://equipmentapi-cert.deere.com/isg'
      );
      assert.strictEqual(
        config.urlByEnvironment.partnerapicert,
        'https://equipmentapi-cert.deere.com/isg'
      );
    });

    it('maps apiqa.tal + partnerapiqa + sandboxapiqa to the -qual variant', () => {
      const config = API_SERVERS['equipment-measurement'];
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(
        config.urlByEnvironment['apiqa.tal'],
        'https://equipmentapi-qual.deere.com/isg'
      );
      assert.strictEqual(
        config.urlByEnvironment.partnerapiqa,
        'https://equipmentapi-qual.deere.com/isg'
      );
      assert.strictEqual(
        config.urlByEnvironment.sandboxapiqa,
        'https://equipmentapi-qual.deere.com/isg'
      );
    });

    it('does NOT map sandboxapi (trust boundary — no sandbox tier)', () => {
      const config = API_SERVERS['equipment-measurement'];
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.sandboxapi, undefined);
    });

    it('does NOT map apidev.tal (no dev tier)', () => {
      const config = API_SERVERS['equipment-measurement'];
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment['apidev.tal'], undefined);
    });
  });

  describe('aemp (repaired from jammed servers URL)', () => {
    it('is kind=static after fix-specs repair', () => {
      assert.strictEqual(API_SERVERS.aemp.kind, 'static');
    });

    it('maps api and partnerapi to partneraemp.deere.com (prod tier)', () => {
      const config = API_SERVERS.aemp;
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.api, 'https://partneraemp.deere.com');
      assert.strictEqual(config.urlByEnvironment.partnerapi, 'https://partneraemp.deere.com');
    });

    it('maps sandboxapi to sandboxaemp.deere.com (new sandbox tier)', () => {
      const config = API_SERVERS.aemp;
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.sandboxapi, 'https://sandboxaemp.deere.com');
    });

    it('does NOT map cert/qual/dev envs (no matching tiers in aemp)', () => {
      const config = API_SERVERS.aemp;
      if (config.kind !== 'static') throw new Error('expected static');
      assert.strictEqual(config.urlByEnvironment.apicert, undefined);
      assert.strictEqual(config.urlByEnvironment['apiqa.tal'], undefined);
      assert.strictEqual(config.urlByEnvironment['apidev.tal'], undefined);
    });
  });

  describe('notifications (injected default servers)', () => {
    it('is kind=templated after fix-specs default injection', () => {
      assert.strictEqual(API_SERVERS.notifications.kind, 'templated');
    });

    it('has the standard platform urlTemplate', () => {
      const config = API_SERVERS.notifications;
      if (config.kind !== 'templated') throw new Error('expected templated');
      assert.strictEqual(config.urlTemplate, 'https://{environment}.deere.com/platform');
    });
  });

  describe('platform-disguised specs normalized by fix-specs', () => {
    const normalized = [
      'files',
      'flags',
      'organizations',
      'machine-alerts',
      'machine-locations',
      'partnerships',
    ] satisfies SpecName[];

    for (const specName of normalized) {
      it(`${specName} is templated (not static) after normalization`, () => {
        const config = API_SERVERS[specName];
        assert.strictEqual(
          config.kind,
          'templated',
          `${specName} should be templated — check fix-specs.ts normalization pass`
        );
      });
    }
  });

  // The length of each templated spec's environment list used to be asserted
  // here (at least 4, exactly 9 for the normalized specs). Nothing reads those
  // lists at run time: the resolver substitutes any known environment into a
  // templated URL without consulting them. So the counts pinned John Deere's
  // enums for no behaviour, and would have stopped the sync when one changed.
  // What does matter, that these specs are templated at all, is checked above.

  describe('templated URL format', () => {
    // The token is attached to whatever host these produce, so the shape that
    // matters is pinned: https, the environment as the leading host label, on
    // deere.com. The path after it (/platform, /isg) is the routing guard's.
    const SHAPE = /^https:\/\/\{environment\}\.deere\.com(\/|$)/;

    it('every templated spec and path override is https://{environment}.deere.com/...', () => {
      for (const [specName, config] of Object.entries(API_SERVERS)) {
        if (config.kind !== 'templated') continue;
        const templates = [
          config.urlTemplate,
          ...(config.pathOverrides ?? []).map((override) => override.urlTemplate),
        ];
        for (const template of templates) {
          assert.match(template, SHAPE, `${specName} has unexpected urlTemplate: ${template}`);
        }
      }
    });
  });
});
