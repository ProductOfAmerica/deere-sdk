import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  NoServerConfigError,
  resolveRequestUrl,
  UnsupportedEnvironmentError,
} from '../src/environment-resolver.js';
import { DeereError } from '../src/errors.js';

describe('resolveRequestUrl', () => {
  describe('templated specs', () => {
    it('substitutes {environment} with the given env for fields (api)', () => {
      const url = resolveRequestUrl('fields', '/organizations/123/fields', 'api');
      assert.strictEqual(url, 'https://api.deere.com/platform/organizations/123/fields');
    });

    it('substitutes {environment} for sandboxapi', () => {
      const url = resolveRequestUrl('fields', '/organizations/123/fields', 'sandboxapi');
      assert.strictEqual(url, 'https://sandboxapi.deere.com/platform/organizations/123/fields');
    });

    it('substitutes {environment} for partnerapi', () => {
      const url = resolveRequestUrl('boundaries', '/organizations/999/boundaries', 'partnerapi');
      assert.strictEqual(url, 'https://partnerapi.deere.com/platform/organizations/999/boundaries');
    });

    it('substitutes for apicert (cert tier)', () => {
      const url = resolveRequestUrl('fields', '/organizations/1/fields', 'apicert');
      assert.strictEqual(url, 'https://apicert.deere.com/platform/organizations/1/fields');
    });

    it('handles query-only paths starting with ?', () => {
      const url = resolveRequestUrl('fields', '?embed=boundary', 'api');
      assert.strictEqual(url, 'https://api.deere.com/platform?embed=boundary');
    });

    it('handles paths with query strings', () => {
      const url = resolveRequestUrl('fields', '/organizations/1/fields?embed=boundary', 'api');
      assert.strictEqual(
        url,
        'https://api.deere.com/platform/organizations/1/fields?embed=boundary'
      );
    });

    it('substitutes for every KNOWN_ENVIRONMENTS value on a broadly-supported spec', () => {
      // files.yaml is normalized to the full 9-env union by fix-specs.
      const envs = [
        'api',
        'sandboxapi',
        'partnerapi',
        'apicert',
        'apiqa.tal',
        'partnerapicert',
        'partnerapiqa',
        'sandboxapiqa',
        'apidev.tal',
      ] as const;
      for (const env of envs) {
        const url = resolveRequestUrl('files', '/organizations/1/files', env);
        assert.strictEqual(url, `https://${env}.deere.com/platform/organizations/1/files`);
      }
    });
  });

  describe('static single-host specs (equipment)', () => {
    it('resolves api to equipmentapi.deere.com/isg', () => {
      const url = resolveRequestUrl('equipment', '/equipment', 'api');
      assert.strictEqual(url, 'https://equipmentapi.deere.com/isg/equipment');
    });

    it('resolves partnerapi to equipmentapi.deere.com/isg (shared prod host)', () => {
      const url = resolveRequestUrl('equipment', '/equipment', 'partnerapi');
      assert.strictEqual(url, 'https://equipmentapi.deere.com/isg/equipment');
    });

    it('throws UnsupportedEnvironmentError for sandboxapi (trust boundary)', () => {
      assert.throws(
        () => resolveRequestUrl('equipment', '/equipment', 'sandboxapi'),
        (err: unknown) => {
          assert(err instanceof UnsupportedEnvironmentError);
          assert(err.message.includes("'equipment'"));
          assert(err.message.includes('sandboxapi'));
          assert(err.message.includes('api'));
          assert(err.message.includes('partnerapi'));
          return true;
        }
      );
    });

    it('throws for apicert (equipment.yaml has no cert variant)', () => {
      assert.throws(
        () => resolveRequestUrl('equipment', '/equipment', 'apicert'),
        UnsupportedEnvironmentError
      );
    });

    it('throws for apiqa.tal', () => {
      assert.throws(
        () => resolveRequestUrl('equipment', '/equipment', 'apiqa.tal'),
        UnsupportedEnvironmentError
      );
    });

    it('throws for apidev.tal', () => {
      assert.throws(
        () => resolveRequestUrl('equipment', '/equipment', 'apidev.tal'),
        UnsupportedEnvironmentError
      );
    });
  });

  describe('static multi-host specs (equipment-measurement)', () => {
    it('resolves api to the bare prod host', () => {
      const url = resolveRequestUrl(
        'equipment-measurement',
        '/organizations/1/equipment/2/measurements',
        'api'
      );
      assert.strictEqual(
        url,
        'https://equipmentapi.deere.com/isg/organizations/1/equipment/2/measurements'
      );
    });

    it('resolves partnerapi to the bare prod host', () => {
      const url = resolveRequestUrl('equipment-measurement', '/foo', 'partnerapi');
      assert.strictEqual(url, 'https://equipmentapi.deere.com/isg/foo');
    });

    it('resolves apicert to the cert variant', () => {
      const url = resolveRequestUrl('equipment-measurement', '/foo', 'apicert');
      assert.strictEqual(url, 'https://equipmentapi-cert.deere.com/isg/foo');
    });

    it('resolves partnerapicert to the cert variant', () => {
      const url = resolveRequestUrl('equipment-measurement', '/foo', 'partnerapicert');
      assert.strictEqual(url, 'https://equipmentapi-cert.deere.com/isg/foo');
    });

    it('resolves apiqa.tal to the qual variant', () => {
      const url = resolveRequestUrl('equipment-measurement', '/foo', 'apiqa.tal');
      assert.strictEqual(url, 'https://equipmentapi-qual.deere.com/isg/foo');
    });

    it('resolves sandboxapiqa to the qual variant (qa in name)', () => {
      const url = resolveRequestUrl('equipment-measurement', '/foo', 'sandboxapiqa');
      assert.strictEqual(url, 'https://equipmentapi-qual.deere.com/isg/foo');
    });

    it('throws UnsupportedEnvironmentError for sandboxapi (no sandbox tier in proxy-info)', () => {
      assert.throws(
        () => resolveRequestUrl('equipment-measurement', '/foo', 'sandboxapi'),
        (err: unknown) => {
          assert(err instanceof UnsupportedEnvironmentError);
          assert(err.message.includes('sandboxapi'));
          assert(err.message.includes('apiqa.tal'));
          return true;
        }
      );
    });

    it('throws UnsupportedEnvironmentError for apidev.tal (no dev tier)', () => {
      assert.throws(
        () => resolveRequestUrl('equipment-measurement', '/foo', 'apidev.tal'),
        UnsupportedEnvironmentError
      );
    });
  });

  describe('unavailable specs (unknown spec names)', () => {
    it('throws NoServerConfigError for unknown spec names', () => {
      assert.throws(() => resolveRequestUrl('not-a-real-spec', '/foo', 'api'), NoServerConfigError);
    });

    it('NoServerConfigError message includes the spec name', () => {
      assert.throws(
        () => resolveRequestUrl('mystery-spec', '/foo', 'api'),
        (err: unknown) => {
          assert(err instanceof NoServerConfigError);
          assert(err.message.includes("'mystery-spec'"));
          return true;
        }
      );
    });
  });

  describe('post-fix-specs normalizations', () => {
    it('aemp (repaired from jammed URL) resolves api to partneraemp', () => {
      const url = resolveRequestUrl('aemp', '/Fleet/1', 'api');
      assert.strictEqual(url, 'https://partneraemp.deere.com/Fleet/1');
    });

    it('aemp resolves sandboxapi to sandboxaemp', () => {
      const url = resolveRequestUrl('aemp', '/Fleet/1', 'sandboxapi');
      assert.strictEqual(url, 'https://sandboxaemp.deere.com/Fleet/1');
    });

    it('aemp throws UnsupportedEnvironmentError for apicert (no cert tier)', () => {
      assert.throws(
        () => resolveRequestUrl('aemp', '/Fleet/1', 'apicert'),
        UnsupportedEnvironmentError
      );
    });

    it('notifications (injected default servers) resolves as templated', () => {
      const url = resolveRequestUrl('notifications', '/notifications/abc', 'sandboxapi');
      assert.strictEqual(url, 'https://sandboxapi.deere.com/platform/notifications/abc');
    });
  });

  describe('path invariant guard', () => {
    it('throws on a path without leading slash', () => {
      assert.throws(
        () => resolveRequestUrl('fields', 'organizations', 'api'),
        /must start with '\/'/
      );
    });

    it('throws on a path like "relative/stuff"', () => {
      assert.throws(() => resolveRequestUrl('fields', 'relative/stuff', 'api'), /Invalid path/);
    });

    it('allows empty string (no path, just base URL)', () => {
      const url = resolveRequestUrl('fields', '', 'api');
      assert.strictEqual(url, 'https://api.deere.com/platform');
    });

    it('allows query-only paths', () => {
      const url = resolveRequestUrl('fields', '?x=1', 'api');
      assert.strictEqual(url, 'https://api.deere.com/platform?x=1');
    });
  });

  describe('error hierarchy integration', () => {
    it('UnsupportedEnvironmentError extends DeereError', () => {
      try {
        resolveRequestUrl('equipment', '/equipment', 'sandboxapi');
        assert.fail('should have thrown');
      } catch (err) {
        assert(err instanceof DeereError);
        assert(err instanceof UnsupportedEnvironmentError);
      }
    });

    it('NoServerConfigError extends DeereError', () => {
      try {
        resolveRequestUrl('nonexistent-spec', '/foo', 'api');
        assert.fail('should have thrown');
      } catch (err) {
        assert(err instanceof DeereError);
        assert(err instanceof NoServerConfigError);
      }
    });

    it('client errors use CLIENT_ERROR_STATUS sentinel (-1, not 0)', () => {
      try {
        resolveRequestUrl('equipment', '/equipment', 'sandboxapi');
        assert.fail('should have thrown');
      } catch (err) {
        assert(err instanceof DeereError);
        assert.strictEqual(err.status, -1);
        // Must NOT match the timeout sentinel (status 0 + statusText 'Timeout')
        // that requestUrl's retry logic checks for.
        assert.notStrictEqual(err.status, 0);
      }
    });
  });
});
