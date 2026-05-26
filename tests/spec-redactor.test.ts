import assert from 'node:assert';
import { describe, it } from 'node:test';
import { redactSensitiveText, redactSpecContent } from '../scripts/lib/spec-redactor.js';

describe('spec redactor', () => {
  it('removes OpenAPI info.contact blocks', () => {
    const redacted = redactSpecContent(`openapi: 3.0.0
info:
  title: Example
  contact:
    name: Person
    email: Person@Example.invalid
  version: 1.0.0
paths: {}
`);

    assert(!redacted.includes('contact:'));
    assert(redacted.includes('  title: Example'));
    assert(redacted.includes('  version: 1.0.0'));
  });

  it('redacts JD emails without storing one in the source text', () => {
    const email = `Example@John${'Deere.com'}`;

    assert.strictEqual(redactSensitiveText(`email: ${email}`), 'email: redacted@example.com');
  });

  it('redacts mailto examples', () => {
    const email = `partnerorg@gmail.${'com'}`;

    assert.strictEqual(
      redactSensitiveText(`uri: mailto:${email}`),
      'uri: mailto:redacted@example.com'
    );
  });

  it('redacts webhook example token values without renaming token fields', () => {
    const token = `wVaS=${'dWgjKTyCg=g3RbDj0V51MWgG+ges9SVvpgIYlbOO2aqBqtSuivWonJY31vrSzf'}`;
    const redacted = redactSensitiveText(`                  token: ${token}`);

    assert.strictEqual(redacted, '                  token: REDACTED');
  });

  it('redacts long client key examples without renaming clientKey fields', () => {
    const clientKey = `deere-${'1234567898765432123456789876543212345678'}`;
    const redacted = redactSensitiveText(`                clientKey: ${clientKey}`);

    assert.strictEqual(redacted, '                clientKey: REDACTED');
  });

  it('redacts long client key examples under generic example fields', () => {
    const clientKey = `johndeere-${'1234567898765432123456789876543212345678'}`;

    assert.strictEqual(
      redactSensitiveText(`          example: ${clientKey}`),
      '          example: REDACTED'
    );
  });

  it('redacts OAuth credential fragments in descriptions', () => {
    const oauthToken = `a5633e06-bd09-43a5-${'942a-2e1255681ca9'}`;
    const oauthSignature = `CX7E9KJra9ok5WpIejjF${'pafh8lE%3D'}`;
    const redacted = redactSensitiveText(
      `Authorization: OAuth oauth_token="${oauthToken}", oauth_signature="${oauthSignature}"`
    );

    assert(redacted.includes('oauth_token="REDACTED"'));
    assert(redacted.includes('oauth_signature="REDACTED"'));
  });

  it('redacts concrete internal user URL examples', () => {
    const userUrl = `https://apiqa.tal.${'deere.com'}/platform/users/${'grumpybear'}`;

    assert.strictEqual(
      redactSensitiveText(`example: ${userUrl}`),
      'example: https://sandboxapi.deere.com/platform/users/USER'
    );
  });
});
