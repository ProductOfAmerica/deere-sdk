/**
 * Checks the TypeScript examples in README.md against src/.
 *
 * The README is the one place consumers copy code from, and nothing compiled
 * it. Examples went on calling methods that had been renamed, importing names
 * the package did not export, and passing request bodies the schemas reject.
 *
 * Two checks per fenced `typescript` block:
 *   1. It compiles, as its own module, with `deere-sdk` mapped to src/index.ts.
 *   2. Every API it calls is served in the environment its client was built
 *      for. Types cannot see this one: `deere.equipment.get()` compiles on any
 *      client and throws at the first call on the default environment.
 *
 * Neither check says anything about what John Deere's API accepts at runtime.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import {
  API_SERVERS,
  DEFAULT_ENVIRONMENT,
  type Environment,
  KNOWN_ENVIRONMENTS,
} from '../src/api-servers.generated.js';
import { resolveRequestUrl } from '../src/environment-resolver.js';
import { Deere } from '../src/index.js';

const ROOT = process.cwd().replaceAll('\\', '/');
const SDK_ENTRY = `${ROOT}/src/index.ts`;

/** A fenced `typescript` block. `line` is the README line of its first code line. */
interface Block {
  line: number;
  code: string;
  /** Reason from a `<!-- readme-check: skip: reason -->` marker above the fence. */
  skip?: string;
}

interface BlockDiagnostic {
  /** README line the diagnostic points at, or 0 for one that belongs to no block. */
  line: number;
  code: number;
  message: string;
}

/** One place where a block reaches a John Deere API through the SDK. */
interface ApiUse {
  line: number;
  /** The expression as written, such as `deere.equipment` or `client.get('fields', path)`. */
  text: string;
  /** A generated API on `Deere` or on `deere.safe`. */
  field?: { name: string; safe: boolean };
  /** A spec name passed straight to a `DeereClient` method. */
  spec?: string;
  /** The environment the client was built for; undefined when the block does not show it. */
  environment: string | undefined;
}

/**
 * Names a fragment may use without declaring them. Declared globally and fully
 * typed, so `deere.noSuchApi` is still an error. A block that declares its own
 * `deere` shadows this one, because every block is compiled as a module.
 */
const AMBIENT = `
declare const deere: import('deere-sdk').Deere;
declare const client: import('deere-sdk').DeereClient;
declare const accessToken: string;
`;

const MARKER = /^<!--\s*readme-check:\s*(.*?)\s*-->\s*$/;
const SKIP_DIRECTIVE = /^skip:\s*(\S.*)$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*(.*?)\s*$/;
/** Info strings that mean TypeScript. Only the first form of CHECKED_FENCE is compiled. */
const TYPESCRIPT_INFO = /^(typescript|ts|tsx|mts|cts)\b/i;
const CHECKED_FENCE = /^```(typescript|ts)\s*$/;

/**
 * Find the fenced `typescript` blocks, and the markers that exempt one.
 *
 * A block that cannot compile on purpose (the migration example shows a call
 * that no longer exists) is exempted by an HTML comment above its fence:
 *
 *     <!-- readme-check: skip: why this block is not valid code -->
 *
 * Everything that would leave code unchecked without saying so is reported in
 * `problems` instead: a marker with no reason, a marker that no typescript
 * block follows, and a TypeScript fence written any way other than
 * ```typescript at the start of a line (indented, `~~~`, `tsx`, attributes).
 */
function extractBlocks(markdown: string): { blocks: Block[]; problems: string[] } {
  const blocks: Block[] = [];
  const problems: string[] = [];
  let open: { line: number; code: string[]; skip?: string } | undefined;
  /** The fence characters that opened a block this check does not compile. */
  let otherFence: string | undefined;
  let marker: { line: number; skip?: string } | undefined;

  const orphaned = (at: { line: number }) =>
    `README.md:${at.line} readme-check marker is not followed by a typescript block`;

  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;

    if (open) {
      if (/^```\s*$/.test(text)) {
        blocks.push({ line: open.line, code: open.code.join('\n'), skip: open.skip });
        open = undefined;
      } else {
        open.code.push(text);
      }
      return;
    }
    if (otherFence) {
      const closing = FENCE.exec(text);
      if (closing && closing[3] === '' && closing[2].startsWith(otherFence)) otherFence = undefined;
      return;
    }

    const directive = MARKER.exec(text)?.[1];
    if (directive !== undefined) {
      if (marker) problems.push(orphaned(marker));
      const reason = SKIP_DIRECTIVE.exec(directive)?.[1];
      if (reason === undefined) {
        problems.push(`README.md:${line} readme-check marker must read "skip: <reason>"`);
      }
      marker = { line, skip: reason };
      return;
    }
    if (text.trim() === '') return;

    const fence = FENCE.exec(text);
    if (CHECKED_FENCE.test(text)) {
      open = { line: line + 1, code: [], skip: marker?.skip };
    } else {
      if (marker) problems.push(orphaned(marker));
      if (fence) {
        otherFence = fence[2];
        if (TYPESCRIPT_INFO.test(fence[3])) {
          problems.push(
            `README.md:${line} TypeScript block is not checked: open it with \`\`\`typescript at the start of a line`
          );
        }
      }
    }
    marker = undefined;
  });

  if (marker) problems.push(orphaned(marker));
  return { blocks, problems };
}

/**
 * Compile `blocks` in memory. Returns their diagnostics and every place they
 * reach an API.
 *
 * This is the only function that touches the TypeScript compiler API. That API
 * is the classic JS one that TypeScript 7 no longer ships (see the TypeScript
 * pin in CLAUDE.md), so the port to whatever replaces it is confined to here.
 */
function analyzeBlocks(blocks: readonly Block[]): {
  diagnostics: BlockDiagnostic[];
  apiUses: ApiUse[];
} {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // Absolute targets, so no baseUrl is needed.
    paths: {
      'deere-sdk': [SDK_ENTRY],
      'deere-sdk/types': [`${ROOT}/src/types/generated/index.ts`],
    },
  };

  // `.mts` makes each block an ES module regardless of any package.json, which
  // gives it its own scope and allows top-level await. `export {}` covers the
  // blocks that have no import of their own.
  const virtual = new Map<string, string>();
  const blockOf = new Map<string, Block>();
  blocks.forEach((block, index) => {
    const name = `${ROOT}/readme-example-${index}.mts`;
    virtual.set(name, `${block.code}\nexport {};\n`);
    blockOf.set(name, block);
  });
  const ambientName = `${ROOT}/readme-ambient.d.mts`;
  virtual.set(ambientName, AMBIENT);

  const normalize = (file: string) => file.replaceAll('\\', '/');
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = virtual.get(normalize(file));
    return text === undefined
      ? getSourceFile.call(host, file, languageVersion, ...rest)
      : ts.createSourceFile(file, text, languageVersion, true);
  };
  host.fileExists = (file) => virtual.has(normalize(file)) || fileExists.call(host, file);
  host.readFile = (file) => virtual.get(normalize(file)) ?? readFile.call(host, file);

  const program = ts.createProgram([...virtual.keys()], options, host);

  // Guard the mapping itself: if `deere-sdk` resolved anywhere but src (a
  // stale dist through the package's self-reference, say), every example
  // would be checked against the wrong code and still pass.
  const entry = program.getSourceFile(SDK_ENTRY);
  assert.ok(entry, `README examples must compile against ${SDK_ENTRY}`);

  const diagnostics: BlockDiagnostic[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const block = file ? blockOf.get(normalize(file.fileName)) : undefined;
    if (file && block) {
      const { line } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      diagnostics.push({ line: block.line + line, code: diagnostic.code, message });
    } else if (!file || normalize(file.fileName) === ambientName) {
      // A global or ambient failure would otherwise vanish, leaving every block
      // looking clean.
      diagnostics.push({ line: 0, code: diagnostic.code, message });
    }
  }

  // API uses are found through the type checker, not by matching text, so they
  // do not depend on what a client variable is called and cannot be confused by
  // a comment or by a second client in the same block.
  const checker = program.getTypeChecker();
  const typeName = (node: ts.Expression) => checker.getTypeAtLocation(node).getSymbol()?.getName();

  /** The environment `client` was constructed with, read from its declaration. */
  const environmentOf = (client: ts.Expression): string | undefined => {
    // `deere.client` is that Deere instance's own client.
    if (ts.isPropertyAccessExpression(client)) {
      return client.name.text === 'client' ? environmentOf(client.expression) : undefined;
    }
    if (!ts.isIdentifier(client)) return undefined;
    const declaration = checker.getSymbolAtLocation(client)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration)) return undefined;

    const built = declaration.initializer;
    if (!built) {
      // Only the ambient names are known to stand for a default client.
      const ambient = normalize(declaration.getSourceFile().fileName) === ambientName;
      return ambient ? DEFAULT_ENVIRONMENT : undefined;
    }
    if (!ts.isNewExpression(built) && !ts.isCallExpression(built)) return undefined;
    const config = built.arguments?.[0];
    if (!config || !ts.isObjectLiteralExpression(config)) return undefined;

    // Later properties win, as they do at runtime. A spread or a non-literal
    // value could hold anything, so from there on the environment is unknown.
    let environment: string | undefined = DEFAULT_ENVIRONMENT;
    for (const property of config.properties) {
      const name = property.name;
      if (!name) {
        environment = undefined;
      } else if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) {
        environment = undefined;
      } else if (name.text === 'environment') {
        const literal = ts.isPropertyAssignment(property) ? property.initializer : undefined;
        environment = literal && ts.isStringLiteralLike(literal) ? literal.text : undefined;
      }
    }
    return environment;
  };

  const apiUses: ApiUse[] = [];
  for (const [name, block] of blockOf) {
    const source = program.getSourceFile(name);
    if (!source) continue;
    const at = (node: ts.Node) =>
      block.line + source.getLineAndCharacterOfPosition(node.getStart(source)).line;

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const owner = typeName(node.expression);
        const field = node.name.text;
        if (owner === 'Deere' && field !== 'client' && field !== 'safe') {
          apiUses.push({
            line: at(node),
            text: node.getText(source),
            field: { name: field, safe: false },
            environment: environmentOf(node.expression),
          });
        } else if (owner === 'SafeFacades') {
          const facades = node.expression;
          apiUses.push({
            line: at(node),
            text: node.getText(source),
            field: { name: field, safe: true },
            environment: ts.isPropertyAccessExpression(facades)
              ? environmentOf(facades.expression)
              : undefined,
          });
        }
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        typeName(node.expression.expression) === 'DeereClient'
      ) {
        // get, post, paginate and the rest take the spec name first. Other
        // string first arguments (a URL, an HTTP method) are not spec names.
        const first = node.arguments[0];
        if (first && ts.isStringLiteralLike(first) && Object.hasOwn(API_SERVERS, first.text)) {
          apiUses.push({
            line: at(node),
            text: node.getText(source),
            spec: first.text,
            environment: environmentOf(node.expression.expression),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { diagnostics, apiUses };
}

const format = (d: BlockDiagnostic) => `README.md:${d.line} TS${d.code}: ${d.message}`;

/** Never sends a request: used only to read which spec each API field belongs to. */
const probe = new Deere({ accessToken: 'readme-check' });

/** The spec behind `deere.<field>` or `deere.safe.<field>`. */
function specOf(field: { name: string; safe: boolean }): string | undefined {
  const api: unknown = Reflect.get(field.safe ? probe.safe : probe, field.name);
  // A safe facade wraps the generated API it guards in `raw`.
  const generated: unknown = field.safe && api instanceof Object ? Reflect.get(api, 'raw') : api;
  const spec: unknown = generated instanceof Object ? Reflect.get(generated, 'spec') : undefined;
  return typeof spec === 'string' ? spec : undefined;
}

function serves(spec: string, environment: string): boolean {
  try {
    resolveRequestUrl(spec, '/', environment as Environment);
    return true;
  } catch {
    return false;
  }
}

/**
 * The uses that would throw before any request is sent, because the client was
 * built for an environment the spec has no host for.
 *
 * Only specs with a fixed host list can fail: the resolver does not check a
 * templated spec against its environment list. For a spec like that, a client
 * whose environment the block does not show is reported too, since the check
 * would otherwise have to assume.
 */
function unservedApis(uses: readonly ApiUse[]): string[] {
  const problems = new Set<string>();
  for (const use of uses) {
    const where = `README.md:${use.line} ${use.text}`;
    const spec = use.spec ?? (use.field ? specOf(use.field) : undefined);
    if (!spec) {
      problems.add(`${where}: cannot tell which spec this belongs to`);
      continue;
    }

    const served = KNOWN_ENVIRONMENTS.filter((environment) => serves(spec, environment));
    if (served.length === KNOWN_ENVIRONMENTS.length) continue;

    if (use.environment === undefined) {
      problems.add(
        `${where}: '${spec}' is served on ${served.join(', ')} only, and this block does not ` +
          `show which environment its client uses. Construct the client here with a literal one.`
      );
    } else if (!serves(spec, use.environment)) {
      problems.add(
        `${where}: '${spec}' is not served on '${use.environment}' (only on ${served.join(', ')})`
      );
    }
  }
  return [...problems];
}

/** Items that belong to a block, plus those that belong to none (line 0). */
function within<T extends { line: number }>(items: readonly T[], block: Block): T[] {
  const last = block.line + block.code.split('\n').length;
  return items.filter((item) => item.line === 0 || (item.line >= block.line && item.line <= last));
}

describe('README examples', () => {
  const { blocks, problems } = extractBlocks(readFileSync(join(ROOT, 'README.md'), 'utf8'));
  const analysis = analyzeBlocks(blocks.filter((block) => block.skip === undefined));

  it('finds the fenced typescript blocks', () => {
    assert.ok(blocks.length > 0, 'no ```typescript blocks found in README.md');
  });

  it('leaves no TypeScript block unchecked without a stated reason', () => {
    assert.deepStrictEqual(problems, []);
  });

  for (const block of blocks) {
    it(`README.md:${block.line} compiles against src`, { skip: block.skip }, () => {
      assert.deepStrictEqual(within(analysis.diagnostics, block).map(format), []);
    });

    it(`README.md:${block.line} calls only APIs its environment serves`, {
      skip: block.skip,
    }, () => {
      assert.deepStrictEqual(unservedApis(within(analysis.apiUses, block)), []);
    });
  }
});

describe('the README checker catches what it exists to catch', () => {
  // One compile for every control. Each gets its own line range, so its
  // diagnostics and API uses can be told apart.
  const CONTROLS = {
    missingMethod:
      "import { Deere } from 'deere-sdk';\n" +
      "const sdk = new Deere({ accessToken: 't' });\n" +
      'await sdk.fields.noSuchMethod();',
    missingExport: "import { NoSuchExport } from 'deere-sdk';",
    ambientIsTyped: 'await deere.noSuchApi.list();',
    optionalId:
      'const orgs = await deere.organizations.listAll();\n' +
      'await deere.fields.listAll(orgs[0].id);',
    servedEverywhere: 'await deere.fields.listAll(accessToken);',
    defaultEnvironment: 'await deere.equipment.get();',
    safeFacade: 'void deere.safe.equipment;',
    configuredForApi:
      "import { Deere } from 'deere-sdk';\n" +
      'const sdk = new Deere({ accessToken: "t", environment: "api" });\n' +
      'await sdk.equipment.get();',
    otherClientsEnvironment:
      "import { Deere, DeereClient } from 'deere-sdk';\n" +
      "export const other = new DeereClient({ accessToken: 't', environment: 'api' });\n" +
      "const sdk = new Deere({ accessToken: 't' });\n" +
      'await sdk.equipment.get();',
    environmentInComment: "// environment: 'api'\nawait deere.equipment.get();",
    rawClientCalls:
      "await client.get('equipment', '/equipment');\n" +
      "await deere.client.get('equipment', '/equipment');\n" +
      "await client.get('fields', '/organizations/1/fields');\n" +
      "await client.fetchUrl('GET', 'https://api.deere.com/platform/organizations');",
    unreadableEnvironment:
      "import { Deere, type Environment } from 'deere-sdk';\n" +
      'declare const environment: Environment;\n' +
      "const sdk = new Deere({ accessToken: 't', environment });\n" +
      'await sdk.equipment.get();',
  } as const;

  const names = Object.keys(CONTROLS) as Array<keyof typeof CONTROLS>;
  const controlBlocks = names.map((name, index) => ({
    line: (index + 1) * 1000,
    code: CONTROLS[name],
  }));
  const analysis = analyzeBlocks(controlBlocks);
  const result = (name: keyof typeof CONTROLS) => {
    const block = controlBlocks[names.indexOf(name)];
    return {
      codes: within(analysis.diagnostics, block).map((d) => d.code),
      unserved: unservedApis(within(analysis.apiUses, block)),
    };
  };

  describe('when compiling', () => {
    it('a method that does not exist', () => {
      assert.deepStrictEqual(result('missingMethod').codes, [2339]);
    });

    it('a name the package does not export', () => {
      assert.deepStrictEqual(result('missingExport').codes, [2305]);
    });

    it('misuse of the ambient deere, which is typed and not any', () => {
      assert.deepStrictEqual(result('ambientIsTyped').codes, [2339]);
    });

    it('an optional id passed where a string is required', () => {
      assert.deepStrictEqual(result('optionalId').codes, [2345]);
    });
  });

  describe('when checking environments', () => {
    it('says nothing about an API that every environment serves', () => {
      assert.deepStrictEqual(result('servedEverywhere'), { codes: [], unserved: [] });
    });

    it('an API the default environment does not serve', () => {
      const { unserved } = result('defaultEnvironment');
      assert.strictEqual(unserved.length, 1);
      assert.match(unserved[0], /deere\.equipment: 'equipment' is not served on 'sandboxapi'/);
    });

    it('the same API through its safe facade', () => {
      assert.strictEqual(result('safeFacade').unserved.length, 1);
    });

    it('but not on a client built for an environment that serves it, whatever it is called', () => {
      assert.deepStrictEqual(result('configuredForApi'), { codes: [], unserved: [] });
    });

    it('a default client beside another client that names a serving environment', () => {
      const { codes, unserved } = result('otherClientsEnvironment');
      assert.deepStrictEqual(codes, []);
      assert.strictEqual(unserved.length, 1);
      assert.match(unserved[0], /sdk\.equipment: .*'sandboxapi'/);
    });

    it('an environment that appears only in a comment', () => {
      assert.strictEqual(result('environmentInComment').unserved.length, 1);
    });

    it('a spec name passed straight to the client, and nothing that is not a spec name', () => {
      const { codes, unserved } = result('rawClientCalls');
      assert.deepStrictEqual(codes, []);
      assert.strictEqual(unserved.length, 2);
      assert.match(unserved[0], /^README\.md:\d+ client\.get\('equipment'/);
      assert.match(unserved[1], /^README\.md:\d+ deere\.client\.get\('equipment'/);
    });

    it('a client whose environment the block does not show', () => {
      const { codes, unserved } = result('unreadableEnvironment');
      assert.deepStrictEqual(codes, []);
      assert.strictEqual(unserved.length, 1);
      assert.match(unserved[0], /does not show which environment/);
    });
  });

  describe('when reading the README', () => {
    const fence = (code: string, opening = '```typescript', closing = '```') =>
      `${opening}\n${code}\n${closing}`;

    it('a skip marker that gives no reason', () => {
      const found = extractBlocks(`<!-- readme-check: skip -->\n${fence('a')}`);
      assert.strictEqual(found.problems.length, 1);
      assert.strictEqual(found.blocks[0]?.skip, undefined);
    });

    it('a skip marker that no typescript block follows', () => {
      const found = extractBlocks(`<!-- readme-check: skip: reason -->\nProse.\n${fence('a')}`);
      assert.strictEqual(found.problems.length, 1);
      assert.strictEqual(found.blocks[0]?.skip, undefined);
    });

    it('a well-formed marker exempts the next block and only that one', () => {
      const found = extractBlocks(
        `<!-- readme-check: skip: shows a removed call -->\n\n${fence('a')}\n\n${fence('b')}`
      );
      assert.deepStrictEqual(found.problems, []);
      assert.deepStrictEqual(
        found.blocks.map((block) => block.skip),
        ['shows a removed call', undefined]
      );
    });

    for (const [how, markdown] of [
      ['with attributes', fence('a', '```ts title="x"')],
      ['as tsx', fence('a', '```tsx')],
      ['in another case', fence('a', '```TypeScript')],
      ['indented', fence('  a', '  ```typescript', '  ```')],
      ['with tildes', fence('a', '~~~typescript', '~~~')],
    ] as const) {
      it(`a TypeScript block it would not compile: fenced ${how}`, () => {
        const found = extractBlocks(markdown);
        assert.deepStrictEqual(found.blocks, []);
        assert.strictEqual(found.problems.length, 1);
      });
    }

    it('and stays quiet about other languages, whose contents it never reads as markup', () => {
      const found = extractBlocks(
        `${fence('<!-- readme-check: skip -->\n```typescript', '````bash', '````')}\n\n${fence('a')}`
      );
      assert.deepStrictEqual(found.problems, []);
      assert.deepStrictEqual(
        found.blocks.map((block) => block.code),
        ['a']
      );
    });
  });
});
