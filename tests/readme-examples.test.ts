/**
 * Checks the TypeScript examples in README.md against src/.
 *
 * The README is the one place consumers copy code from, and nothing compiled
 * it. Examples went on calling methods that had been renamed, importing names
 * the package did not export, and passing request bodies the schemas reject.
 *
 * Two checks per fenced `typescript` block:
 *   1. It compiles, as its own module, with `deere-sdk` mapped to src/index.ts.
 *   2. Every call to an API with a fixed host list is made on a client built
 *      for an environment that API has a host for. Types cannot see this one:
 *      `deere.equipment.get()` compiles on any client and throws at the first
 *      call on the default environment.
 *
 * The second check refuses what it cannot follow. A call counts as fine only
 * when the check can trace the object it is made on back to a `const` client
 * constructed in the same block with a literal environment (or to the default
 * client a fragment may assume). A parameter, a `let`, a helper, a class field:
 * all reported. That costs some legitimate ways of writing an example, and in
 * exchange an unfamiliar construction cannot pass by going unrecognised.
 *
 * Limits. Neither check says anything about what John Deere's API accepts at
 * runtime. The second does not see a call made through a value typed `any`,
 * and does not look at absolute URLs passed to `fetchUrl` or `followLink`.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import {
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

/** A call to an SDK method that sends a request, or a reference that could become one. */
interface ApiCall {
  line: number;
  text: string;
  /** The generated API class or safe facade the method belongs to. */
  apiClass?: string;
  /** The spec name, for a call made straight on `DeereClient`. */
  spec?: string;
  /** The environment of the client the call is made on, when the block shows it. */
  environment?: string;
  /** Why the spec or the environment could not be established. */
  unclear?: string;
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
 * Compile `blocks` in memory. Returns their diagnostics and, for each block,
 * its calls to the SDK methods that send requests.
 *
 * This is the only function that touches the TypeScript compiler API. That API
 * is the classic JS one that TypeScript 7 no longer ships (see the TypeScript
 * pin in CLAUDE.md), so the port to whatever replaces it is confined to here.
 */
function analyzeBlocks(blocks: readonly Block[]): {
  diagnostics: BlockDiagnostic[];
  calls: Map<Block, ApiCall[]>;
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

  const checker = program.getTypeChecker();
  const fileOf = (node: ts.Node | undefined) => normalize(node?.getSourceFile().fileName ?? '');
  const inSdk = (node: ts.Node | undefined) => fileOf(node).startsWith(`${ROOT}/src/`);
  const isApiFile = (file: string) =>
    file.startsWith(`${ROOT}/src/api/`) || file.startsWith(`${ROOT}/src/safe/`);

  /**
   * The request-sending SDK method a declaration is, if it is one: a method of
   * a generated API class or safe facade, or one of the DeereClient methods
   * that take the spec name first (`fetchUrl` and `followLink` do not).
   *
   * Everything below asks this of a RESOLVED declaration, the one the type
   * checker says a call or a value leads to. So it does not matter how the
   * method was reached: through `Pick<EquipmentApi, 'get'>`, an interface that
   * extends the class, a subclass, `super`, a computed key, `bind`.
   */
  const sdkMethod = (
    declaration: ts.Declaration | undefined
  ): { apiClass: string } | 'client' | undefined => {
    if (!declaration || !ts.isMethodDeclaration(declaration)) return undefined;
    const owner = declaration.parent;
    // A method of an object literal has no class, and so no name here.
    const className = ts.isClassDeclaration(owner) ? owner.name?.text : undefined;
    const file = fileOf(owner);
    if (className && isApiFile(file)) return { apiClass: className };
    const takesSpec = declaration.parameters[0]?.name.getText() === 'specName';
    return file === `${ROOT}/src/client.ts` && className === 'DeereClient' && takesSpec
      ? 'client'
      : undefined;
  };

  /** Strip the wrappers that change how a value is typed or grouped, not what it is. */
  const unwrap = (node: ts.Expression): ts.Expression => {
    let inner = node;
    while (
      ts.isParenthesizedExpression(inner) ||
      ts.isNonNullExpression(inner) ||
      ts.isAsExpression(inner) ||
      ts.isSatisfiesExpression(inner)
    ) {
      inner = inner.expression;
    }
    return inner;
  };

  /** What `new X(...)` or `f(...)` constructs, when X or f is the SDK's own. */
  const constructs = (node: ts.NewExpression | ts.CallExpression): 'client' | 'api' | undefined => {
    let symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const file = fileOf(symbol?.declarations?.[0]);
    const where = `${file}#${symbol?.getName()}`;
    if (ts.isCallExpression(node)) {
      const factory =
        where === `${ROOT}/src/deere.ts#createDeere` ||
        where === `${ROOT}/src/client.ts#createClient`;
      return factory ? 'client' : undefined;
    }
    if (where === `${ROOT}/src/deere.ts#Deere` || where === `${ROOT}/src/client.ts#DeereClient`) {
      return 'client';
    }
    return isApiFile(file) ? 'api' : undefined;
  };

  /** The `environment` a config literal sets, the default if it sets none, undefined if unclear. */
  const environmentIn = (config: ts.Expression | undefined): string | undefined => {
    if (!config || !ts.isObjectLiteralExpression(config)) return undefined;
    // Later properties win, as they do at runtime. A spread or a non-literal
    // value could hold anything, so from there on the environment is unknown.
    let environment: string | undefined = DEFAULT_ENVIRONMENT;
    for (const property of config.properties) {
      const name = property.name;
      if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
        environment = undefined;
      } else if (name.text === 'environment') {
        const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : undefined;
        environment = value && ts.isStringLiteralLike(value) ? value.text : undefined;
      }
    }
    return environment;
  };

  const calls = new Map<Block, ApiCall[]>();
  for (const [name, block] of blockOf) {
    const source = program.getSourceFile(name);
    // Skipping a block here would report it as having no calls at all.
    assert.ok(source, `README.md:${block.line} was not compiled`);
    const found: ApiCall[] = [];
    calls.set(block, found);

    const line = (node: ts.Node) =>
      block.line + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const text = (node: ts.Node) => node.getText(source).replace(/\s+/g, ' ').slice(0, 80);

    /**
     * The environment of the client that `expression` is, or belongs to.
     *
     * Every branch that returns an environment names a construction it has
     * read. Anything else ends in the last line, which is the point: a form
     * this function does not know cannot be mistaken for a known client.
     */
    const explain = (expression: ts.Expression): { environment?: string; unclear?: string } => {
      const node = unwrap(expression);

      // `deere.equipment`, `deere.safe.products`, `deere.client`: a member of
      // an SDK object belongs to the same client as the object.
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const member = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
        if (!inSdk(checker.getSymbolAtLocation(member)?.valueDeclaration)) {
          return { unclear: `\`${text(node)}\` is not a member of an SDK object` };
        }
        return explain(node.expression);
      }

      if (ts.isIdentifier(node)) {
        const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
        if (fileOf(declaration) === ambientName) return { environment: DEFAULT_ENVIRONMENT };

        // `const sdk = <something explained>`. Not `let`: it can be given
        // another client anywhere, including places this does not read.
        const isConst = (list: ts.Node) =>
          ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
        if (
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          isConst(declaration.parent)
        ) {
          return explain(declaration.initializer);
        }

        // `const { equipment } = deere`: the same as `deere.equipment`.
        if (declaration && ts.isBindingElement(declaration)) {
          const pattern = declaration.parent;
          const holder = pattern.parent;
          const key = declaration.propertyName ?? declaration.name;
          if (
            ts.isObjectBindingPattern(pattern) &&
            ts.isVariableDeclaration(holder) &&
            holder.initializer &&
            isConst(holder.parent) &&
            !declaration.dotDotDotToken &&
            !declaration.initializer &&
            ts.isIdentifier(key)
          ) {
            const from = checker.getTypeAtLocation(holder.initializer);
            if (inSdk(checker.getPropertyOfType(from, key.text)?.valueDeclaration)) {
              return explain(holder.initializer);
            }
          }
        }
        return { unclear: `\`${node.text}\` is not a \`const\` client constructed in this block` };
      }

      if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        const made = constructs(node);
        if (made === 'client') {
          const environment = environmentIn(node.arguments?.[0]);
          return environment === undefined
            ? { unclear: `\`${text(node)}\` does not set its environment with a literal` }
            : { environment };
        }
        // `new EquipmentApi(client)`: an API is on whatever client it was given.
        const on = made === 'api' ? node.arguments?.[0] : undefined;
        if (on) return explain(on);
      }

      return { unclear: `\`${text(node)}\` is not a client constructed in this block` };
    };

    /** True when `node`, possibly wrapped, is what a call expression calls. */
    const isCalled = (node: ts.Node) => {
      let callee = node;
      while (
        ts.isParenthesizedExpression(callee.parent) ||
        ts.isNonNullExpression(callee.parent) ||
        ts.isAsExpression(callee.parent) ||
        ts.isSatisfiesExpression(callee.parent)
      ) {
        callee = callee.parent;
      }
      return ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
    };

    /**
     * Places a method may sit without being called there, because every later
     * use of the value is itself looked at: the name or the initial value of a
     * variable, and the receiver of `.bind(...)`.
     */
    const isHeldForLater = (node: ts.Node) => {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) || ts.isBindingElement(parent)) return true;
      return (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === 'bind' &&
        isCalled(parent)
      );
    };

    const visit = (node: ts.Node): void => {
      // Annotations and `typeof x` mention a value without using it. A heritage
      // clause and `f<T>` hold real expressions under a type node's kind, so
      // those are still walked.
      if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;

      const called = ts.isCallExpression(node)
        ? sdkMethod(checker.getResolvedSignature(node)?.declaration)
        : undefined;
      if (called && ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const on =
          ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
            ? explain(callee.expression)
            : { unclear: 'it is not called on the object it belongs to' };
        const call = { line: line(node), text: text(node) };
        if (called !== 'client') {
          found.push({ ...call, apiClass: called.apiClass, ...on });
        } else {
          const argument = node.arguments[0];
          const type = argument ? checker.getTypeAtLocation(argument) : undefined;
          found.push(
            type?.isStringLiteral()
              ? { ...call, spec: type.value, ...on }
              : {
                  ...call,
                  unclear: 'the spec name is not one literal, so this could call any API',
                }
          );
        }
      } else if (ts.isExpression(node) && !isCalled(node) && !isHeldForLater(node)) {
        // A method that is a value here and is not being called: handed to
        // `.call`, passed as a callback, put in an array. Wherever it goes
        // next, nothing ties it to a client any more. This includes a call
        // whose RESULT is such a method, as `client.get.bind(client)` is.
        const isMemberName =
          ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
        // `type Get = typeof client.get` names a type after the method. The
        // name is an identifier too, but it is not a value anything can call.
        const namesAType =
          ts.isIdentifier(node) &&
          ((checker.getSymbolAtLocation(node)?.flags ?? 0) & ts.SymbolFlags.Value) === 0;
        const declaration = checker.getTypeAtLocation(node).getSymbol()?.valueDeclaration;
        const method = isMemberName || namesAType ? undefined : sdkMethod(declaration);
        if (method) {
          found.push({
            line: line(node),
            text: text(node),
            ...(method === 'client' ? {} : { apiClass: method.apiClass }),
            unclear: 'the method is used as a value without being called there',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { diagnostics, calls };
}

const format = (d: BlockDiagnostic) => `README.md:${d.line} TS${d.code}: ${d.message}`;

/**
 * Which spec each generated API class and safe facade belongs to, read from a
 * real instance. It never sends a request.
 */
const SPEC_OF_CLASS = new Map<string, string>();
{
  const probe = new Deere({ accessToken: 'readme-check' });
  const specOf = (api: unknown) => (api instanceof Object ? Reflect.get(api, 'spec') : undefined);
  for (const api of Object.values(probe)) {
    const spec = specOf(api);
    if (typeof spec === 'string') SPEC_OF_CLASS.set(api.constructor.name, spec);
  }
  for (const facade of Object.values(probe.safe)) {
    // A safe facade wraps the generated API it guards in `raw`.
    const spec = specOf(Reflect.get(facade, 'raw'));
    if (typeof spec === 'string') SPEC_OF_CLASS.set(facade.constructor.name, spec);
  }
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
 * The calls that would throw before any request is sent, and the ones the
 * check could not rule out.
 *
 * Only a spec with a fixed host list can fail: the resolver does not check a
 * templated spec against its environment list. So a call the check could not
 * trace to a client is reported only when its spec is one of those.
 */
function unservedApis(calls: readonly ApiCall[] = []): string[] {
  const problems: string[] = [];
  for (const call of calls) {
    const where = `README.md:${call.line} ${call.text}`;
    const spec = call.spec ?? SPEC_OF_CLASS.get(call.apiClass ?? '');
    if (!spec) {
      const why = call.apiClass ? `no spec is known for ${call.apiClass}` : call.unclear;
      problems.push(`${where}: ${why}`);
      continue;
    }

    const served = KNOWN_ENVIRONMENTS.filter((environment) => serves(spec, environment));
    if (served.length === KNOWN_ENVIRONMENTS.length) continue;

    if (call.environment === undefined) {
      problems.push(
        `${where}: '${spec}' is served on ${served.join(', ')} only, and the check cannot tell ` +
          `which environment this uses: ${call.unclear}. Call it on a \`const\` client ` +
          'constructed in this block with a literal environment.'
      );
    } else if (!serves(spec, call.environment)) {
      problems.push(
        `${where}: '${spec}' is not served on '${call.environment}', the environment of the ` +
          `client this is called on. It is served on ${served.join(', ')} only.`
      );
    }
  }
  return [...new Set(problems)];
}

/** Diagnostics that belong to a block, plus those that belong to none (line 0). */
function within(items: readonly BlockDiagnostic[], block: Block): BlockDiagnostic[] {
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

    it(`README.md:${block.line} calls only APIs its client's environment serves`, {
      skip: block.skip,
    }, () => {
      assert.deepStrictEqual(unservedApis(analysis.calls.get(block)), []);
    });
  }
});

describe('the README checker catches what it exists to catch', () => {
  const NOT_ON_SANDBOX = /'equipment' is not served on 'sandboxapi'/;
  const CANNOT_TELL = /'equipment' is served on api, partnerapi only, and the check cannot tell/;
  const AS_A_VALUE = /the method is used as a value without being called there/;

  const DEERE = "import { Deere } from 'deere-sdk';\n";
  const DEERE_TYPE = "import type { Deere } from 'deere-sdk';\n";
  const ON_API = "{ accessToken: 't', environment: 'api' }";
  const ON_DEFAULT = "{ accessToken: 't' }";

  // One compile for every control. `codes` are the compile diagnostics a
  // control must produce and `unserved` the environment problems, in order.
  // A control that names neither must be clean on both counts.
  const CONTROLS: Record<string, { code: string; codes?: number[]; unserved?: RegExp[] }> = {
    // The compile check.
    'a method that does not exist': {
      code: `${DEERE}const sdk = new Deere(${ON_DEFAULT});\nawait sdk.fields.noSuchMethod();`,
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

    // The environment check: clients it can trace.
    'nothing, for an API that every environment serves': {
      code: "await deere.fields.listAll(accessToken);\nawait client.get('fields', '/x');",
    },
    'a call on the default client': {
      code: 'await deere.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'a call through a safe facade': {
      code: 'await deere.safe.equipment.getWithEmbed({} as never);',
      unserved: [NOT_ON_SANDBOX],
    },
    'nothing, on clients built for environments that serve the API': {
      code:
        "import { Deere, createDeere } from 'deere-sdk';\n" +
        'const sdk = new Deere({ accessToken: "t", environment: "api" });\n' +
        "const other = createDeere({ accessToken: 't', environment: 'partnerapi' });\n" +
        'await sdk.equipment.get();\n' +
        'await other.equipment.get();',
    },
    'nothing, when each call is made on a client that serves it': {
      code:
        `${DEERE}const prod = new Deere(${ON_API});\n` +
        `const sandbox = new Deere(${ON_DEFAULT});\n` +
        'await prod.equipment.get();\n' +
        "await sandbox.fields.listAll('org');",
    },
    'a call on a default client that sits beside a serving one': {
      code:
        `${DEERE}export const prod = new Deere(${ON_API});\n` +
        `const sandbox = new Deere(${ON_DEFAULT});\n` +
        'await sandbox.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an environment that appears only in a comment inside the config': {
      code:
        `${DEERE}const sdk = new Deere({\n` +
        "  accessToken: 't',\n" +
        "  // environment: 'api',\n" +
        '});\n' +
        'await sdk.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'nothing, when the environment is written `as const` and a default client is only named in a type':
      {
        code:
          `${DEERE}const sdk = new Deere({ accessToken: 't', environment: 'api' as const });\n` +
          'export type Ambient = typeof deere;\n' +
          'await sdk.equipment.get();',
      },
    'an API taken off the client by destructuring': {
      code: 'const { equipment } = deere;\nawait equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an API reached with bracket access': {
      code: "await deere['equipment'].get();",
      unserved: [NOT_ON_SANDBOX],
    },
    'an API reached through a chain of const aliases': {
      code: 'const sdk = deere;\nconst machines = sdk.equipment;\nawait (machines!).get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'nothing, for an API class constructed on a client that serves it': {
      code:
        "import { DeereClient, EquipmentApi } from 'deere-sdk';\n" +
        `const api = new EquipmentApi(new DeereClient(${ON_API}));\n` +
        'await api.get();',
    },
    'an API class constructed on the default client': {
      code: "import { EquipmentApi } from 'deere-sdk';\nawait new EquipmentApi(client).get();",
      unserved: [NOT_ON_SANDBOX],
    },

    // The environment check: clients it refuses to guess about.
    'a client that can be reassigned': {
      code:
        `${DEERE}let sdk = new Deere(${ON_API});\n` +
        `sdk = new Deere(${ON_DEFAULT});\n` +
        'await sdk.equipment.get();',
      unserved: [/cannot tell which environment this uses: `sdk` is not a `const` client/],
    },
    'a client built from a config held in a variable': {
      code:
        `${DEERE}const config = { accessToken: 't', environment: 'api' as const };\n` +
        'const sdk = new Deere(config);\n' +
        'await sdk.equipment.get();',
      unserved: [/cannot tell .*`new Deere\(config\)` does not set its environment with a literal/],
    },
    'a `let` client filled in by a destructuring assignment': {
      code:
        `${DEERE}export const prod = new Deere(${ON_API});\n` +
        'declare const holder: { sdk: Deere };\n' +
        'let sdk: Deere;\n' +
        '({ sdk } = holder);\n' +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client whose environment is not a literal': {
      code:
        "import { Deere, type Environment } from 'deere-sdk';\n" +
        'declare const environment: Environment;\n' +
        "const sdk = new Deere({ accessToken: 't', environment });\n" +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client whose config is spread from somewhere else': {
      code:
        `${DEERE}declare const base: { accessToken: string };\n` +
        "const sdk = new Deere({ environment: 'api', ...base });\n" +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a subclass of the client': {
      code:
        `${DEERE}class Mine extends Deere {}\n` +
        `const sdk = new Mine(${ON_API});\n` +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client that may be undefined': {
      code:
        "declare const maybe: import('deere-sdk').Deere | undefined;\n" +
        'await maybe?.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client from a helper the check knows nothing about': {
      code:
        `${DEERE_TYPE}declare function make(config: { accessToken: string }, tier: string): Deere;\n` +
        "const sdk = make({ accessToken: 't' }, 'apicert');\n" +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client made by a tagged template': {
      code:
        `${DEERE_TYPE}declare function make(strings: TemplateStringsArray): Deere;\n` +
        'const sdk = make`x`;\n' +
        'await sdk.equipment.get();',
      unserved: [/cannot tell which environment this uses: `make`x`` is not a client constructed/],
    },
    'a client passed in as a parameter': {
      code: `${DEERE_TYPE}export const list = (sdk: Deere) => sdk.equipment.get();`,
      unserved: [CANNOT_TELL],
    },
    'a client that arrives through a promise, beside one built for a serving environment': {
      code:
        `${DEERE}declare function connect(): Promise<Deere>;\n` +
        `const prod = new Deere(${ON_API});\n` +
        'const sdk = await connect();\n' +
        'await prod.equipment.get();\n' +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client kept on another object': {
      code:
        "declare const context: { sdk: import('deere-sdk').Deere };\n" +
        'await context.sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client destructured from another object': {
      code:
        "declare const context: { sdk: import('deere-sdk').Deere };\n" +
        'const { sdk } = context;\n' +
        'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'a client read out of untyped data': {
      code:
        "const sdk: import('deere-sdk').Deere = JSON.parse('{}');\n" + 'await sdk.equipment.get();',
      unserved: [CANNOT_TELL],
    },
    'an API reached through `this` in a subclass': {
      code:
        `${DEERE}export class Mine extends Deere {\n` +
        '  machines() {\n' +
        '    return this.equipment.get();\n' +
        '  }\n' +
        '}',
      unserved: [CANNOT_TELL],
    },
    'an API reached through `super` in a subclass': {
      code:
        "import { EquipmentApi } from 'deere-sdk';\n" +
        'export class Machines extends EquipmentApi {\n' +
        '  all() {\n' +
        '    return super.get();\n' +
        '  }\n' +
        '}',
      unserved: [CANNOT_TELL],
    },
    'an API reached through a subclass of the generated class': {
      code:
        "import { EquipmentApi } from 'deere-sdk';\n" +
        'class Machines extends EquipmentApi {}\n' +
        'await new Machines(client).get();',
      unserved: [CANNOT_TELL],
    },
    'an API seen only through a structural type': {
      code:
        "import type { EquipmentApi } from 'deere-sdk';\n" +
        "export const list = (api: Pick<EquipmentApi, 'get'>) => api.get();",
      unserved: [CANNOT_TELL],
    },
    'an API picked off the client with a key the check cannot read': {
      code:
        "export function run<K extends 'equipment'>(key: K) {\n" +
        '  return deere[key].get();\n' +
        '}',
      unserved: [CANNOT_TELL],
    },
    'a call made inside the expression a class extends': {
      code:
        'declare function mixin(value: unknown): new () => object;\n' +
        "export class Fleet extends mixin(client.get('equipment', '/equipment')) {}",
      unserved: [NOT_ON_SANDBOX],
    },

    // The environment check: spec names given straight to the client.
    'a spec name passed to the client, but not a URL passed to fetchUrl': {
      code:
        "await client.get('equipment', '/equipment');\n" +
        "await deere.client.post('equipment', '/equipment', {});\n" +
        "await client.fetchUrl('GET', 'https://api.deere.com/platform/organizations');",
      unserved: [NOT_ON_SANDBOX, NOT_ON_SANDBOX],
    },
    'a spec name held in a constant': {
      code: "const spec = 'equipment';\nawait client.get(spec, '/equipment');",
      unserved: [NOT_ON_SANDBOX],
    },
    'a spec name that could be any spec': {
      code: "declare const spec: import('deere-sdk').SpecName;\n" + "await client.get(spec, '/x');",
      unserved: [/the spec name is not one literal/],
    },

    // The environment check: methods that leave their object.
    'a client method invoked through call': {
      code: "await client.get.call(client, 'equipment', '/equipment');",
      unserved: [AS_A_VALUE],
    },
    'a destructured client method invoked through call': {
      code: "const { get } = client;\nawait get.call(client, 'equipment', '/equipment');",
      unserved: [AS_A_VALUE],
    },
    'a client method reached with a computed key and invoked through call': {
      code: "const name = 'get';\nawait client[name].call(client, 'equipment', '/equipment');",
      unserved: [AS_A_VALUE],
    },
    'a bound client method invoked through call': {
      code: "await client.get.bind(client).call(null, 'equipment', '/equipment');",
      unserved: [AS_A_VALUE],
    },
    'a client method given type arguments and invoked through call': {
      code:
        'const typed = client.get<string[]>;\n' +
        "await typed.call(client, 'equipment', '/equipment');",
      // Reported where the method leaves the client. `typed` itself has an
      // instantiated type that no longer names the method.
      unserved: [/client\.get: the method is used as a value/],
    },
    'a client method passed as a callback': {
      code:
        'declare function later(run: (spec: "equipment", path: string) => unknown): void;\n' +
        'later(client.get);',
      unserved: [AS_A_VALUE],
    },
    'nothing, for methods the block declares itself, whatever they are called': {
      code:
        'class Helper {\n' +
        '  get(spec: string) {\n    return spec;\n  }\n' +
        '}\n' +
        "new Helper().get('equipment');\n" +
        'const tool = {\n' +
        '  get(specName: string) {\n    return specName;\n  },\n' +
        '};\n' +
        "tool.get('equipment');",
    },
    'nothing, for a type that only names a client method': {
      code:
        'export type Get = typeof client.get;\n' + "export type GetAgain = (typeof client)['get'];",
    },
    'nothing, for a bound client method called with a spec every environment serves': {
      code: "const get = client.get.bind(client);\nawait get('fields', '/x');",
    },
    'a bound client method called with a spec the default environment does not serve': {
      code: "const get = client.get.bind(client);\nawait get('equipment', '/equipment');",
      unserved: [CANNOT_TELL],
    },
    'an API method held in a constant and called later': {
      code: 'const get = deere.equipment.get;\nawait get();',
      unserved: [CANNOT_TELL],
    },
    'an API method passed as a callback': {
      code: 'declare function later(run: () => unknown): void;\nlater(deere.equipment.get);',
      unserved: [CANNOT_TELL],
    },
    'nothing, for a method passed around when every environment serves its API': {
      code: 'declare function later(run: (org: string) => unknown): void;\nlater(deere.fields.listAll);',
    },
  };

  const names = Object.keys(CONTROLS);
  const controlBlocks = names.map((name, index) => ({
    line: (index + 1) * 1000,
    code: CONTROLS[name].code,
  }));
  const analysis = analyzeBlocks(controlBlocks);

  it('knows which spec a generated API and a safe facade belong to', () => {
    assert.strictEqual(SPEC_OF_CLASS.get('EquipmentApi'), 'equipment');
    assert.strictEqual(SPEC_OF_CLASS.get('SafeEquipmentApi'), 'equipment');
  });

  names.forEach((name, index) => {
    it(name, () => {
      const block = controlBlocks[index];
      const expected = CONTROLS[name];
      assert.deepStrictEqual(
        within(analysis.diagnostics, block).map((d) => d.code),
        expected.codes ?? []
      );

      const unserved = unservedApis(analysis.calls.get(block));
      const patterns = expected.unserved ?? [];
      assert.strictEqual(unserved.length, patterns.length, unserved.join('\n'));
      patterns.forEach((pattern, at) => {
        assert.match(unserved[at], pattern);
      });
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
