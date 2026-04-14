/**
 * Snapshot regression tests for the generated api-servers.generated.ts.
 *
 * Asserts that the v2.0 URL resolution contract is encoded correctly in the
 * generated data for the current committed spec set. If JD's specs change or
 * scripts/generate-api-servers.ts regresses its classifier, these tests
 * catch it by asserting specific invariants — NOT byte-level snapshots,
 * which would be too brittle.
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
      assert.deepStrictEqual([...KNOWN_ENVIRONMENTS], expected);
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

    it('templated specs declare at least 4 supported envs', () => {
      for (const [specName, config] of Object.entries(API_SERVERS)) {
        if (config.kind === 'templated') {
          assert(
            config.supportedEnvironments.length >= 4,
            `${specName} declares only ${config.supportedEnvironments.length} envs`
          );
        }
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

    it('supports the full 9-env union (default injection uses global union)', () => {
      const config = API_SERVERS.notifications;
      if (config.kind !== 'templated') throw new Error('expected templated');
      assert.strictEqual(config.supportedEnvironments.length, 9);
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

      it(`${specName} supports the full 9-env union`, () => {
        const config = API_SERVERS[specName];
        if (config.kind !== 'templated') throw new Error('expected templated');
        assert.strictEqual(
          config.supportedEnvironments.length,
          KNOWN_ENVIRONMENTS.length,
          `${specName} should declare all 9 envs after normalization, got ${config.supportedEnvironments.length}`
        );
      });
    }
  });

  describe('templated URL format', () => {
    it('every templated spec uses https://{environment}.deere.com/platform', () => {
      for (const [specName, config] of Object.entries(API_SERVERS)) {
        if (config.kind === 'templated') {
          assert.strictEqual(
            config.urlTemplate,
            'https://{environment}.deere.com/platform',
            `${specName} has unexpected urlTemplate: ${config.urlTemplate}`
          );
        }
      }
    });
  });
});
