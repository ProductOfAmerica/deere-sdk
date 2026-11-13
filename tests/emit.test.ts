/**
 * scripts/lib/emit.ts: text from a spec must not be able to become code.
 *
 * Each helper is tested the way it is used. An escaped value is placed in the
 * kind of source it is emitted into and that source is evaluated, so a test
 * fails if the text gets out of its literal or comment, not merely if the
 * escaped string differs from one written down here.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';
import {
  assertEnvironmentName,
  assertIdentifier,
  assertPathKey,
  isHttpsDeereBaseUrl,
  jsDocText,
  tsStringLiteral,
} from '../scripts/lib/emit.js';

/** Evaluate a JavaScript expression. Test input only. */
function evaluate(expression: string): unknown {
  return new Function(`return (${expression});`)();
}

// The two Unicode line separators, by code so that this file stays ASCII:
// typed as characters they are indistinguishable from spaces in an editor.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

// Any 16-bit code unit, so unpaired surrogates and line separators occur, with
// extra weight on the characters that end or escape a literal.
const hostileText = fc.string({
  unit: fc.oneof(
    fc.constantFrom("'", '"', '`', '\\', '$', '{', '}', '*', '/', '\n', '\r'),
    fc.constantFrom(LINE_SEPARATOR, PARAGRAPH_SEPARATOR),
    fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code))
  ),
});

describe('tsStringLiteral', () => {
  it('is a literal whose value is the input, for any input', () => {
    fc.assert(
      fc.property(hostileText, (text) => {
        assert.strictEqual(evaluate(tsStringLiteral(text)), text);
      }),
      { numRuns: 2000 }
    );
  });

  it('keeps a value that tries to end the literal inside it', () => {
    const marker = '__emitTestMarker';
    const attack = `x', (globalThis.${marker} = true), '`;
    try {
      assert.strictEqual(evaluate(tsStringLiteral(attack)), attack);
      assert.strictEqual(marker in globalThis, false);
    } finally {
      delete (globalThis as Record<string, unknown>)[marker];
    }
  });

  it('writes ordinary values the way the generators always have', () => {
    // Regenerating must not change committed output, so the common case is
    // pinned as text and not only by evaluating it.
    assert.strictEqual(tsStringLiteral('FieldOperation'), "'FieldOperation'");
    assert.strictEqual(tsStringLiteral('/organizations/{orgId}'), "'/organizations/{orgId}'");
    assert.strictEqual(tsStringLiteral('!Connectivity'), "'!Connectivity'");
    assert.strictEqual(tsStringLiteral('say "hi"'), '\'say "hi"\'');
    assert.strictEqual(tsStringLiteral(''), "''");
  });
});

describe('jsDocText', () => {
  it('cannot close the comment it is placed in, for any input', () => {
    fc.assert(
      fc.property(hostileText, (text) => {
        const source = `/** ${jsDocText(text)} */ 'after the comment'`;
        assert.strictEqual(evaluate(source), 'after the comment');
      }),
      { numRuns: 2000 }
    );
  });

  it('keeps a class member written after a comment terminator inside the comment', () => {
    const marker = '__emitTestMarker';
    const attack = `Get a thing */ static { globalThis.${marker} = true; } /*`;
    try {
      evaluate(`class Demo {\n  /**\n   * ${jsDocText(attack)}\n   */\n  method() {}\n}`);
      assert.strictEqual(marker in globalThis, false);
    } finally {
      delete (globalThis as Record<string, unknown>)[marker];
    }
  });

  it('leaves text without a terminator unchanged', () => {
    const text = 'Lists fields. Supports a * wildcard and a/b style paths.';
    assert.strictEqual(jsDocText(text), text);
  });
});

describe('assertIdentifier', () => {
  it('accepts the names path parameters use', () => {
    for (const name of ['id', 'orgId', 'organizationId', 'equipmentISGTypeId', '_x']) {
      assert.doesNotThrow(() => assertIdentifier(name, 'test'));
    }
  });

  it('refuses "$", which String.replace would read as a pattern in the generator', () => {
    for (const name of ['$', '$$', 'a$b', '$y']) {
      assert.throws(() => assertIdentifier(name, 'demo.yaml'), /not a plain identifier/, name);
    }
  });

  it('says what to do about a refused name, differently for a reserved word', () => {
    assert.throws(() => assertIdentifier('a-b', 'demo.yaml'), /widen IDENTIFIER/);
    assert.throws(
      () => assertIdentifier('class', 'demo.yaml'),
      (error: Error) => /another name/.test(error.message) && !/widen/.test(error.message)
    );
  });

  it('refuses anything that is not a plain identifier', () => {
    for (const name of ['', 'a b', 'a-b', '1a', 'id = (evil())', 'a,b', 'a.b', '@currentUser']) {
      assert.throws(() => assertIdentifier(name, 'demo.yaml'), /demo\.yaml.*parameter name/s);
    }
  });

  it('refuses reserved words, which would not compile as a parameter name', () => {
    for (const name of ['class', 'await', 'arguments', 'default']) {
      assert.throws(() => assertIdentifier(name, 'demo.yaml'), /reserved word/);
    }
  });
});

describe('assertPathKey', () => {
  it('accepts the shapes the committed specs use', () => {
    const paths = [
      '/organizations',
      '/organizations/{orgId}/fields/{fieldId}/boundaries',
      '/users/@currentUser',
      '/equipmentMakes/{equipmentMakeId}/equipmentISGTypes',
      '/Fleet/{pageNumber}',
      '/a_b/c-d/e.f',
    ];
    for (const path of paths) assert.doesNotThrow(() => assertPathKey(path, 'test'));
  });

  it('refuses a path that could leave the template literal, the quotes or the comment', () => {
    const attacks = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a template-literal injection, as text
      '/a/{id}/${globalThis.x}',
      '/a/`b`',
      "/a/b', x: (evil()), y: '",
      '/a/b*/c',
      '/a/b\\c',
      '/a/b c',
      '/a/b\nc',
    ];
    for (const path of attacks) {
      assert.throws(() => assertPathKey(path, 'demo.yaml'), /demo\.yaml: path/, path);
    }
  });

  it('refuses a parameter name that is not an identifier', () => {
    assert.throws(() => assertPathKey('/a/{id = (evil())}', 'demo.yaml'), /parameter name/);
    assert.throws(() => assertPathKey('/a/{}', 'demo.yaml'), /parameter name/);
    assert.throws(() => assertPathKey('/a/{class}', 'demo.yaml'), /reserved word/);
  });

  it('refuses a parameter named twice, which no method signature can express', () => {
    assert.throws(
      () => assertPathKey('/a/{id}/b/{id}', 'demo.yaml'),
      /names the parameter \{id\} twice/
    );
    assert.doesNotThrow(() => assertPathKey('/a/{id}/b/{otherId}', 'demo.yaml'));
  });

  it('refuses a segment that mixes a parameter with other text', () => {
    assert.throws(() => assertPathKey('/a/{id}.json', 'demo.yaml'), /segment/);
    assert.throws(() => assertPathKey('/a/x{id}', 'demo.yaml'), /segment/);
  });

  it('refuses dot segments, which a URL parser would resolve into a different path', () => {
    for (const path of ['/a/./b', '/a/../b', '/..']) {
      assert.throws(() => assertPathKey(path, 'demo.yaml'), /demo\.yaml: path/, path);
    }
  });

  // Not dangerous to emit. No committed spec has them, and an empty last
  // segment would be read as a collection endpoint, so a person should look.
  it('refuses an empty segment and a path with no leading slash', () => {
    for (const path of ['', 'a/b', '/', '/a/', '/a//b']) {
      assert.throws(() => assertPathKey(path, 'demo.yaml'), /demo\.yaml: path/, path);
    }
  });
});

describe('assertEnvironmentName', () => {
  it('accepts the environments the specs declare', () => {
    for (const name of ['api', 'sandboxapi', 'apiqa.tal', 'partnerapicert', 'apidev.tal', 'a-b']) {
      assert.doesNotThrow(() => assertEnvironmentName(name, 'test'));
    }
  });

  it('refuses a name that could change the host it is substituted into', () => {
    const attacks = [
      '',
      'evil.example/',
      'a@b',
      'a:b',
      'a/b',
      'a?b',
      'a#b',
      'API',
      'a b',
      '.a',
      'a.',
    ];
    for (const name of attacks) {
      assert.throws(() => assertEnvironmentName(name, 'demo.yaml'), /environment name/, name);
    }
  });

  it('refuses a name that could leave its quotes or the header comment', () => {
    for (const name of ["x', (evil()), 'y", 'a*/b', 'a\nb']) {
      assert.throws(() => assertEnvironmentName(name, 'demo.yaml'), /environment name/, name);
    }
  });

  it('keeps every accepted name under the host it is substituted before', () => {
    // The property the grammar exists for: substituted into the leading label
    // of a deere.com host, an accepted name cannot move the request elsewhere.
    const label = fc.stringMatching(/^[a-z0-9]{1,8}$/);
    const name = fc
      .tuple(label, fc.array(fc.tuple(fc.constantFrom('.', '-'), label), { maxLength: 3 }))
      .map(([first, rest]) => first + rest.map(([joiner, part]) => joiner + part).join(''));
    fc.assert(
      fc.property(name, (environment) => {
        assert.doesNotThrow(() => assertEnvironmentName(environment, 'test'));
        const url = new URL(`https://${environment}.deere.com/platform`);
        assert.strictEqual(url.hostname, `${environment}.deere.com`);
        assert.strictEqual(url.pathname, '/platform');
      }),
      { numRuns: 500 }
    );
  });
});

describe('isHttpsDeereBaseUrl', () => {
  it('accepts https URLs on deere.com and its subdomains', () => {
    const urls = [
      'https://api.deere.com/platform',
      'https://equipmentapi.deere.com/isg',
      'https://partneraemp.deere.com',
      'https://apiqa.tal.deere.com/platform',
      'https://deere.com',
    ];
    for (const url of urls) assert.strictEqual(isHttpsDeereBaseUrl(url), true, url);
  });

  it('refuses a URL that is not https on deere.com', () => {
    const urls = [
      'http://api.deere.com/platform',
      'https://server.com',
      'https://deere.com.untrusted.example/platform',
      'https://untrusted.example/deere.com',
      'https://api.deere.com@untrusted.example/',
      'https://notdeere.com',
      'ftp://api.deere.com',
      'api.deere.com/platform',
      '',
    ];
    for (const url of urls) assert.strictEqual(isHttpsDeereBaseUrl(url), false, url);
  });

  // The resolver appends the request path to the base as text. These are on
  // deere.com and still wrong as a base: the path would not end up in the path.
  it('refuses a deere.com URL that a path cannot be appended to', () => {
    const urls = [
      'https://api.deere.com/platform?x=1',
      'https://api.deere.com/platform?',
      'https://api.deere.com/platform#',
      'https://api.deere.com/platform#section',
      'https://user:secret@api.deere.com/platform',
      'https://user@api.deere.com/platform',
    ];
    for (const url of urls) assert.strictEqual(isHttpsDeereBaseUrl(url), false, url);
  });
});
