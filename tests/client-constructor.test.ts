/**
 * DeereClient constructor tests — runtime env validation + v1 migration hints.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DeereClient } from '../src/client.js';

describe('DeereClient constructor — runtime env validation', () => {
  describe('valid environments', () => {
    const validEnvs = [
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

    for (const env of validEnvs) {
      it(`accepts '${env}'`, () => {
        const client = new DeereClient({ accessToken: 't', environment: env });
        assert(client instanceof DeereClient);
      });
    }

    it('defaults to sandboxapi when environment is unset', () => {
      const client = new DeereClient({ accessToken: 't' });
      assert(client instanceof DeereClient);
      // Private field can't be read directly — we verify via behavior in
      // client.test.ts which asserts the default URL uses sandboxapi.
    });
  });

  describe('v1 legacy friendly names throw with migration hint', () => {
    const v1ToV2: Array<[string, string]> = [
      ['production', 'api'],
      ['sandbox', 'sandboxapi'],
      ['partner', 'partnerapi'],
      ['cert', 'apicert'],
      ['qa', 'apiqa.tal'],
    ];

    for (const [v1, v2] of v1ToV2) {
      it(`rejects v1 '${v1}' with hint pointing at v2 '${v2}'`, () => {
        assert.throws(
          () =>
            new DeereClient({
              accessToken: 't',
              environment: v1 as never,
            }),
          (err: Error) => {
            assert(err.message.includes(`Invalid environment '${v1}'`));
            assert(err.message.includes(`Use '${v2}' instead of '${v1}'`));
            assert(err.message.includes('CHANGELOG.md'));
            return true;
          }
        );
      });
    }
  });

  describe('unknown environment strings throw without hint', () => {
    const unknownEnvs = ['', 'prod', 'foo', 'notarealenv', 'sandbox-api', 'api-eu'];

    for (const env of unknownEnvs) {
      it(`rejects '${env}' with valid-values list`, () => {
        assert.throws(
          () =>
            new DeereClient({
              accessToken: 't',
              environment: env as never,
            }),
          (err: Error) => {
            assert(err.message.includes(`Invalid environment '${env}'`));
            assert(err.message.includes('Valid values: api, sandboxapi'));
            return true;
          }
        );
      });
    }

    it('rejects numeric input passed through untyped config', () => {
      assert.throws(
        () => new DeereClient({ accessToken: 't', environment: 42 as never }),
        /Invalid environment '42'/
      );
    });
  });
});
