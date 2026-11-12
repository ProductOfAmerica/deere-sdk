/**
 * Type-checks the TypeScript examples in README.md against src/.
 *
 * The README is the one place consumers copy code from, and nothing compiled
 * it. Examples went on calling methods that had been renamed, importing names
 * the package did not export, and passing request bodies the schemas reject.
 * This compiles every fenced `typescript` block as its own module, with
 * `deere-sdk` mapped to src/index.ts, so an example that no longer matches the
 * SDK fails here.
 *
 * It checks types only. An example can compile and still be wrong about what
 * John Deere's API accepts at runtime.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { DEFAULT_ENVIRONMENT, type Environment } from '../src/api-servers.generated.js';
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
  /** README line the diagnostic points at. */
  line: number;
  code: number;
  message: string;
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

/**
 * Find the fenced `typescript` blocks, and the markers that exempt one.
 *
 * A block that cannot compile on purpose (the migration example shows a call
 * that no longer exists) is exempted by an HTML comment above its fence:
 *
 *     <!-- readme-check: skip: why this block is not valid code -->
 *
 * The reason is required and the marker must be followed by a typescript
 * block, with nothing but blank lines between. Anything else is reported in
 * `problems`, so a marker cannot quietly exempt nothing or the wrong block.
 */
function extractBlocks(markdown: string): { blocks: Block[]; problems: string[] } {
  const blocks: Block[] = [];
  const problems: string[] = [];
  let open: { line: number; code: string[]; skip?: string } | undefined;
  let inOtherFence = false;
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
    if (inOtherFence) {
      if (/^```\s*$/.test(text)) inOtherFence = false;
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

    if (/^```(typescript|ts)\s*$/.test(text)) {
      open = { line: line + 1, code: [], skip: marker?.skip };
    } else {
      if (marker) problems.push(orphaned(marker));
      if (text.startsWith('```')) inOtherFence = true;
    }
    marker = undefined;
  });

  if (marker) problems.push(orphaned(marker));
  return { blocks, problems };
}

/**
 * Compile `blocks` in memory and return their diagnostics.
 *
 * This is the only function that touches the TypeScript compiler API. That API
 * is the classic JS one that TypeScript 7 no longer ships (see the TypeScript
 * pin in CLAUDE.md), so the port to whatever replaces it is confined to here.
 */
function typecheckBlocks(blocks: readonly Block[]): BlockDiagnostic[] {
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
  return diagnostics;
}

const format = (d: BlockDiagnostic) => `README.md:${d.line} TS${d.code}: ${d.message}`;

/** Never sends a request: used only to read which spec each API field belongs to. */
const probe = new Deere({ accessToken: 'readme-check' });

/** The spec behind `deere.<field>` or `deere.safe.<field>`, or undefined if it is not an API. */
function specOf(safe: boolean, field: string): string | undefined {
  const api: unknown = Reflect.get(safe ? probe.safe : probe, field);
  // A safe facade wraps the generated API it guards in `raw`.
  const generated: unknown = safe && api instanceof Object ? Reflect.get(api, 'raw') : api;
  const spec: unknown = generated instanceof Object ? Reflect.get(generated, 'spec') : undefined;
  return typeof spec === 'string' ? spec : undefined;
}

/**
 * APIs a block calls that are not served in the environment it configures, or
 * in the default environment when it configures none.
 *
 * Types cannot catch this. `deere.equipment.get()` compiles on any client and
 * throws at the first call unless the client was built for an environment the
 * equipment spec has a host for. The Quick Start shipped exactly that.
 *
 * Only specs with a fixed host list can fail here, because the resolver does
 * not check a templated spec against its environment list.
 */
function unservedApis(block: Block): string[] {
  const named = [...block.code.matchAll(/\benvironment:\s*'([^']+)'/g)].map((match) => match[1]);
  const environments = named.length > 0 ? [...new Set(named)] : [DEFAULT_ENVIRONMENT];

  const calls = new Map<string, string>();
  for (const [, safe, field] of block.code.matchAll(/\bdeere\.(safe\.)?(\w+)\./g)) {
    const spec = specOf(safe !== undefined, field);
    if (spec) calls.set(`deere.${safe ?? ''}${field}`, spec);
  }

  const unserved: string[] = [];
  for (const [call, spec] of calls) {
    for (const environment of environments) {
      try {
        resolveRequestUrl(spec, '/', environment as Environment);
      } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
        unserved.push(`README.md:${block.line} ${call}: ${reason}`);
      }
    }
  }
  return unserved;
}

describe('README examples', () => {
  const { blocks, problems } = extractBlocks(readFileSync(join(ROOT, 'README.md'), 'utf8'));
  const diagnostics = typecheckBlocks(blocks.filter((block) => block.skip === undefined));

  it('finds the fenced typescript blocks', () => {
    assert.ok(blocks.length > 0, 'no ```typescript blocks found in README.md');
  });

  it('has only well-formed readme-check markers', () => {
    assert.deepStrictEqual(problems, []);
  });

  for (const block of blocks) {
    it(`README.md:${block.line} compiles against src`, { skip: block.skip }, () => {
      const last = block.line + block.code.split('\n').length;
      const mine = diagnostics.filter(
        (d) => d.line === 0 || (d.line >= block.line && d.line <= last)
      );
      assert.deepStrictEqual(mine.map(format), []);
    });

    it(`README.md:${block.line} calls only APIs its environment serves`, {
      skip: block.skip,
    }, () => {
      assert.deepStrictEqual(unservedApis(block), []);
    });
  }

  describe('the checker catches what it exists to catch', () => {
    const codes = (code: string) => typecheckBlocks([{ line: 1, code }]).map((d) => d.code);
    const fence = (code: string) => `\`\`\`typescript\n${code}\n\`\`\``;

    it('an API that the default environment does not serve', () => {
      const found = unservedApis({ line: 1, code: 'await deere.equipment.get();' });
      assert.strictEqual(found.length, 1);
      assert.match(found[0], /deere\.equipment: .*'sandboxapi'/);
    });

    it('the same API through its safe facade', () => {
      const found = unservedApis({ line: 1, code: 'await deere.safe.equipment.anything();' });
      assert.strictEqual(found.length, 1);
    });

    it('but not once the block configures an environment that serves it', () => {
      const code =
        "const deere = new Deere({ accessToken: 't', environment: 'api' });\n" +
        'await deere.equipment.get();';
      assert.deepStrictEqual(unservedApis({ line: 1, code }), []);
    });

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

    it('a method that does not exist', () => {
      const found = codes(
        "import { Deere } from 'deere-sdk';\n" +
          "const sdk = new Deere({ accessToken: 't' });\n" +
          'await sdk.fields.noSuchMethod();'
      );
      assert.deepStrictEqual(found, [2339]);
    });

    it('a name the package does not export', () => {
      assert.deepStrictEqual(codes("import { NoSuchExport } from 'deere-sdk';"), [2305]);
    });

    it('misuse of the ambient deere, which is typed and not any', () => {
      assert.deepStrictEqual(codes('await deere.noSuchApi.list();'), [2339]);
    });

    it('an optional id passed where a string is required', () => {
      const found = codes(
        'const orgs = await deere.organizations.listAll();\n' +
          'await deere.fields.listAll(orgs[0].id);'
      );
      assert.deepStrictEqual(found, [2345]);
    });
  });
});
