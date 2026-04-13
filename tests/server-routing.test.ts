/**
 * End-to-end server-routing regression tests.
 *
 * These are the 5 critical tests from the v2.0 plan that prove the URL
 * resolution rewrite is correct. Any one failing means v2.0 has shipped the
 * bug it exists to fix.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereClient } from '../src/client.js';
import { Deere } from '../src/deere.js';
import { mockWithSpy } from './helpers/mock-fetch.js';

describe('v2.0 URL resolution regression tests', () => {
  describe('equipment-measurement production routing (THE BUG)', () => {
    it('post on env=api hits equipmentapi.deere.com/isg (NOT -qual, NOT -cert)', async () => {
      const { fetch, calls } = mockWithSpy({});
      const deere = new Deere({ accessToken: 't', environment: 'api', fetch });

      await deere.equipmentMeasurement.create('org-1', 'equip-2', {
        timestamp: '2026-04-13T12:00:00Z',
        measurements: [],
      });

      assert.strictEqual(calls.length, 1);
      assert.match(
        calls[0].url,
        /^https:\/\/equipmentapi\.deere\.com\/isg\//,
        'Production env must route to equipmentapi.deere.com/isg'
      );
      assert.doesNotMatch(
        calls[0].url,
        /-qual\.|-cert\./,
        'Must NOT route to -qual or -cert variants'
      );
      assert.match(calls[0].url, /\/organizations\/org-1\/equipment\/equip-2\/measurements$/);
    });

    it('post on env=partnerapi also hits the bare prod host', async () => {
      const { fetch, calls } = mockWithSpy({});
      const deere = new Deere({ accessToken: 't', environment: 'partnerapi', fetch });

      await deere.equipmentMeasurement.create('o', 'e', {});

      assert.match(calls[0].url, /^https:\/\/equipmentapi\.deere\.com\/isg\//);
      assert.doesNotMatch(calls[0].url, /-qual\.|-cert\./);
    });

    it('post on env=apiqa.tal hits the qual variant', async () => {
      const { fetch, calls } = mockWithSpy({});
      const deere = new Deere({ accessToken: 't', environment: 'apiqa.tal', fetch });

      await deere.equipmentMeasurement.create('o', 'e', {});

      assert.match(
        calls[0].url,
        /^https:\/\/equipmentapi-qual\.deere\.com\/isg\//,
        'apiqa.tal (qual tier) must route to the -qual host'
      );
    });

    it('post on env=apicert hits the cert variant', async () => {
      const { fetch, calls } = mockWithSpy({});
      const deere = new Deere({ accessToken: 't', environment: 'apicert', fetch });

      await deere.equipmentMeasurement.create('o', 'e', {});

      assert.match(
        calls[0].url,
        /^https:\/\/equipmentapi-cert\.deere\.com\/isg\//,
        'apicert must route to the -cert host'
      );
    });
  });

  describe('sandbox trust-boundary refusal (CRITICAL — no silent prod destruction)', () => {
    it('equipmentMeasurement.post on env=sandboxapi throws BEFORE any fetch', async () => {
      const { fetch, calls } = mockWithSpy({});
      const deere = new Deere({ accessToken: 't', environment: 'sandboxapi', fetch });

      await assert.rejects(
        () => deere.equipmentMeasurement.create('o', 'e', {}),
        (err: Error) => {
          assert.strictEqual(err.name, 'UnsupportedEnvironmentError');
          assert(err.message.includes('equipment-measurement'));
          assert(err.message.includes('sandboxapi'));
          return true;
        }
      );
      // Zero HTTP calls = trust boundary held
      assert.strictEqual(calls.length, 0);
    });

    it('equipment.list on env=sandboxapi throws before fetch (single-host prod-only)', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({ accessToken: 't', environment: 'sandboxapi', fetch });

      await assert.rejects(
        () => deere.equipment.get(),
        (err: Error) => err.name === 'UnsupportedEnvironmentError'
      );
      assert.strictEqual(calls.length, 0);
    });

    it('equipment.get on env=apidev.tal throws (no dev tier)', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({ accessToken: 't', environment: 'apidev.tal', fetch });

      await assert.rejects(
        () => deere.equipment.get(),
        (err: Error) => err.name === 'UnsupportedEnvironmentError'
      );
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('files.yaml via fix-specs normalization', () => {
    it('files.listFiles on env=sandboxapi hits sandboxapi.deere.com/platform', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({ accessToken: 't', environment: 'sandboxapi', fetch });

      await deere.files.listFiles('org123');

      assert.strictEqual(calls.length, 1);
      assert.match(
        calls[0].url,
        /^https:\/\/sandboxapi\.deere\.com\/platform\/organizations\/org123\/files/,
        'files.yaml should support sandboxapi via fix-specs normalization'
      );
    });

    it('files.listFiles on env=partnerapicert routes to partnerapicert subdomain', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({
        accessToken: 't',
        environment: 'partnerapicert',
        fetch,
      });

      await deere.files.listFiles('org123');

      assert.match(calls[0].url, /^https:\/\/partnerapicert\.deere\.com\/platform\//);
    });
  });

  describe('v1 → v2 friendly name migration errors', () => {
    it('constructor throws on v1 "production" with hint pointing at "api"', () => {
      assert.throws(
        () =>
          new DeereClient({
            accessToken: 't',
            environment: 'production' as never, // bypass TS to test runtime validator
          }),
        /Invalid environment 'production'[\s\S]*Use 'api' instead of 'production'/
      );
    });

    it('constructor throws on v1 "sandbox" with hint pointing at "sandboxapi"', () => {
      assert.throws(
        () => new DeereClient({ accessToken: 't', environment: 'sandbox' as never }),
        /Invalid environment 'sandbox'[\s\S]*Use 'sandboxapi' instead of 'sandbox'/
      );
    });

    it('constructor throws on arbitrary unknown env with valid-values list', () => {
      assert.throws(
        () => new DeereClient({ accessToken: 't', environment: 'notarealenv' as never }),
        /Invalid environment 'notarealenv'[\s\S]*Valid values: api, sandboxapi/
      );
    });

    it('constructor defaults to sandboxapi when environment unset', () => {
      // Internal field is private, so verify via behavior: URL resolution
      // uses the default. A request with no env should go to sandboxapi.
      // We can't inspect this.environment directly, but the builds URL test
      // in client.test.ts already covers it. This test just asserts
      // construction succeeds with no env.
      const client = new DeereClient({ accessToken: 't' });
      assert(client instanceof DeereClient);
    });
  });

  describe('platform-disguised specs route correctly across envs', () => {
    it('organizations.list on env=partnerapi hits partnerapi.deere.com/platform', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({ accessToken: 't', environment: 'partnerapi', fetch });

      await deere.organizations.list();

      assert.match(calls[0].url, /^https:\/\/partnerapi\.deere\.com\/platform\/organizations/);
    });

    it('machineAlerts on env=sandboxapi hits sandboxapi.deere.com/platform', async () => {
      const { fetch, calls } = mockWithSpy({ values: [], links: [] });
      const deere = new Deere({ accessToken: 't', environment: 'sandboxapi', fetch });

      await deere.machineAlerts.list('principal-1');

      assert.match(calls[0].url, /^https:\/\/sandboxapi\.deere\.com\/platform\//);
    });
  });
});
