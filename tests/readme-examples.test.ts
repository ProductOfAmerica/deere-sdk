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

const ROOT = process.cwd().replaceAll('\\', '/');
const SDK_ENTRY = `${ROOT}/src/index.ts`;

/** A fenced `typescript` block. `line` is the README line of its first code line. */
interface Block {
  line: number;
  code: string;
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

function extractBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let open: { line: number; code: string[] } | undefined;

  markdown.split(/\r?\n/).forEach((text, index) => {
    if (!open) {
      if (/^```(typescript|ts)\s*$/.test(text)) open = { line: index + 2, code: [] };
      return;
    }
    if (/^```\s*$/.test(text)) {
      blocks.push({ line: open.line, code: open.code.join('\n') });
      open = undefined;
      return;
    }
    open.code.push(text);
  });

  return blocks;
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

describe('README examples', () => {
  const blocks = extractBlocks(readFileSync(join(ROOT, 'README.md'), 'utf8'));

  // Only the Quick Start for now; the remaining blocks are checked once the
  // examples that currently fail have been corrected.
  const checked = blocks.slice(0, 1);
  const diagnostics = typecheckBlocks(checked);

  it('finds the fenced typescript blocks', () => {
    assert.ok(blocks.length > 0, 'no ```typescript blocks found in README.md');
  });

  for (const block of checked) {
    it(`README.md:${block.line} compiles against src`, () => {
      const last = block.line + block.code.split('\n').length;
      const mine = diagnostics.filter(
        (d) => d.line === 0 || (d.line >= block.line && d.line <= last)
      );
      assert.deepStrictEqual(mine.map(format), []);
    });
  }

  describe('the checker catches what it exists to catch', () => {
    const codes = (code: string) => typecheckBlocks([{ line: 1, code }]).map((d) => d.code);

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
