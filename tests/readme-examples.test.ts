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
 * It checks types only. Two things it cannot tell:
 *
 * - What John Deere's API accepts at runtime.
 * - Whether an example's client is in an environment that serves the API it
 *   calls. `deere.equipment.get()` compiles on any client and throws on the
 *   default environment, because the equipment spec has no sandbox host. An
 *   attempt to check that here by static analysis grew to several times the
 *   size of everything else in this file and was still being found unsound
 *   after four reviews, so it was removed. The README states the requirement
 *   in prose and the runtime error lists the environments that work. The fix
 *   that would also protect consumers is to carry the environment in the
 *   client's type, which is a change to the public types.
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
  /** Reason from a `<!-- readme-check: skip: reason -->` marker above the fence. */
  skip?: string;
}

interface BlockDiagnostic {
  /** README line the diagnostic points at, or 0 for one that belongs to no block. */
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
const FENCE = /^(\s*)(`{3,}|~{3,})\s*(.*?)\s*$/;
const QUOTED_FENCE = /^\s*>[>\s]*(`{3,}|~{3,})\s*(.*?)\s*$/;
const TYPESCRIPT_INFO = /^(typescript|typescriptreact|ts|tsx|mts|cts)\b/i;
/** The one spelling that is compiled. Every other TypeScript fence is reported. */
const CHECKED_FENCE = /^```typescript\s*$/;

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
 * block follows, a TypeScript fence written any way other than ```typescript
 * at the start of a line (indented, quoted, `~~~`, `ts`, `tsx`, attributes),
 * and a fence of any language that is never closed, since it would swallow
 * every block after it.
 */
function extractBlocks(markdown: string): { blocks: Block[]; problems: string[] } {
  const blocks: Block[] = [];
  const problems: string[] = [];
  let open: { line: number; code: string[]; skip?: string } | undefined;
  /** A fence this check does not compile: the characters that opened it, and where. */
  let other: { fence: string; line: number } | undefined;
  let marker: { line: number; skip?: string } | undefined;

  const orphaned = (at: { line: number }) =>
    `README.md:${at.line} readme-check marker is not followed by a typescript block`;
  const unchecked = (line: number) =>
    `README.md:${line} TypeScript block is not checked: open it with \`\`\`typescript at the start of a line`;

  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;

    if (open) {
      if (/^`{3,}\s*$/.test(text)) {
        blocks.push({ line: open.line, code: open.code.join('\n'), skip: open.skip });
        open = undefined;
      } else {
        open.code.push(text);
      }
      return;
    }
    if (other) {
      const inner = FENCE.exec(text);
      if (inner?.[2].startsWith(other.fence)) {
        if (inner[3] === '') {
          other = undefined;
        } else if (TYPESCRIPT_INFO.test(inner[3])) {
          // Markdown reads this line as text inside the block above, so the
          // example would render as part of it and never be checked. A fence
          // that is meant to hold fences is opened with a longer run.
          problems.push(
            `README.md:${line} TypeScript block is not checked: the block opened at ` +
              `README.md:${other.line} is still open here`
          );
        }
      }
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

    if (CHECKED_FENCE.test(text)) {
      open = { line: line + 1, code: [], skip: marker?.skip };
    } else {
      if (marker) problems.push(orphaned(marker));
      const fence = FENCE.exec(text);
      const quoted = QUOTED_FENCE.exec(text);
      if (fence) {
        other = { fence: fence[2], line };
        if (TYPESCRIPT_INFO.test(fence[3])) problems.push(unchecked(line));
      } else if (quoted && TYPESCRIPT_INFO.test(quoted[2])) {
        problems.push(unchecked(line));
      }
    }
    marker = undefined;
  });

  if (open) problems.push(`README.md:${open.line - 1} typescript block is never closed`);
  if (other) {
    problems.push(`README.md:${other.line} fence is never closed, so nothing after it is checked`);
  }
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

/** Diagnostics that belong to a block, plus those that belong to none (line 0). */
function within(items: readonly BlockDiagnostic[], block: Block): BlockDiagnostic[] {
  const last = block.line + block.code.split('\n').length;
  return items.filter((item) => item.line === 0 || (item.line >= block.line && item.line <= last));
}

describe('README examples', () => {
  const { blocks, problems } = extractBlocks(readFileSync(join(ROOT, 'README.md'), 'utf8'));
  const diagnostics = typecheckBlocks(blocks.filter((block) => block.skip === undefined));

  it('finds the fenced typescript blocks', () => {
    assert.ok(blocks.length > 0, 'no ```typescript blocks found in README.md');
  });

  it('leaves no TypeScript block unchecked without a stated reason', () => {
    assert.deepStrictEqual(problems, []);
  });

  for (const block of blocks) {
    it(`README.md:${block.line} compiles against src`, { skip: block.skip }, () => {
      assert.deepStrictEqual(within(diagnostics, block).map(format), []);
    });
  }
});

describe('the README checker catches what it exists to catch', () => {
  // One compile for every control. Each gets its own line range, so its
  // diagnostics can be told apart from the others'.
  const CONTROLS: Record<string, { code: string; codes: number[] }> = {
    'a method that does not exist': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        "const sdk = new Deere({ accessToken: 't' });\n" +
        'await sdk.fields.noSuchMethod();',
      codes: [2339],
    },
    'a name the package does not export': {
      code: "import { NoSuchExport } from 'deere-sdk';",
      codes: [2305],
    },
    'misuse of the ambient deere, which is typed and not any': {
      code: 'await deere.noSuchApi.list();',
      codes: [2339],
    },
    'an optional id passed where a string is required': {
      code:
        'const orgs = await deere.organizations.listAll();\n' +
        'await deere.fields.listAll(orgs[0].id);',
      codes: [2345],
    },
    'a request body the schema rejects': {
      code: "await deere.equipment.create('org-id', { type: 'Machine', name: 'Tractor 1' });",
      codes: [2353],
    },
    'nothing, for an example that is correct': {
      code:
        "import { Deere, UnsupportedEnvironmentError } from 'deere-sdk';\n" +
        "const sdk = new Deere({ accessToken: 't', environment: 'api' });\n" +
        'try {\n' +
        '  await sdk.equipment.get();\n' +
        '} catch (error) {\n' +
        '  if (!(error instanceof UnsupportedEnvironmentError)) throw error;\n' +
        '}',
      codes: [],
    },
  };

  const names = Object.keys(CONTROLS);
  const controlBlocks = names.map((name, index) => ({
    line: (index + 1) * 1000,
    code: CONTROLS[name].code,
  }));
  const diagnostics = typecheckBlocks(controlBlocks);

  names.forEach((name, index) => {
    it(name, () => {
      assert.deepStrictEqual(
        within(diagnostics, controlBlocks[index]).map((d) => d.code),
        CONTROLS[name].codes
      );
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

    it('a skip marker followed by another marker, which leaves the first exempting nothing', () => {
      const found = extractBlocks(
        `<!-- readme-check: skip: first -->\n<!-- readme-check: skip: second -->\n${fence('a')}`
      );
      assert.deepStrictEqual(found.problems, [
        'README.md:1 readme-check marker is not followed by a typescript block',
      ]);
      assert.strictEqual(found.blocks[0]?.skip, 'second');
    });

    it('a skip marker at the end of the file', () => {
      const found = extractBlocks(`${fence('a')}\n\n<!-- readme-check: skip: nothing follows -->`);
      assert.deepStrictEqual(found.problems, [
        'README.md:5 readme-check marker is not followed by a typescript block',
      ]);
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
      ['as ts', fence('a', '```ts')],
      ['with attributes', fence('a', '```typescript title="x"')],
      ['as tsx', fence('a', '```tsx')],
      ['as typescriptreact', fence('a', '```typescriptreact')],
      ['in another case', fence('a', '```TypeScript')],
      ['indented', fence('  a', '  ```typescript', '  ```')],
      ['with tildes', fence('a', '~~~typescript', '~~~')],
      ['inside a blockquote', fence('> a', '> ```typescript', '> ```')],
    ] as const) {
      it(`a TypeScript block it would not compile: fenced ${how}`, () => {
        const found = extractBlocks(markdown);
        assert.deepStrictEqual(found.blocks, []);
        assert.strictEqual(found.problems.length, 1);
      });
    }

    it('a typescript block that is never closed', () => {
      const found = extractBlocks("```typescript\nconst x: number = 'a';");
      assert.deepStrictEqual(found.blocks, []);
      assert.strictEqual(found.problems.length, 1);
    });

    it('a typescript block swallowed by an earlier block that was not closed', () => {
      const found = extractBlocks(`\`\`\`bash\nnpm install\n\n${fence('a')}`);
      assert.deepStrictEqual(found.blocks, []);
      assert.strictEqual(found.problems.length, 1);
      assert.match(
        found.problems[0],
        /^README\.md:4 .* the block opened at README\.md:1 is still open/
      );
    });

    it('a block in another language that runs to the end of the file', () => {
      const found = extractBlocks('Text.\n\n```bash\nnpm install');
      assert.deepStrictEqual(found.blocks, []);
      assert.strictEqual(found.problems.length, 1);
      assert.match(found.problems[0], /^README\.md:3 fence is never closed/);
    });

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
