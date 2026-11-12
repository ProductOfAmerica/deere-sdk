/**
 * Checks the TypeScript examples in README.md against src/.
 *
 * The README is the one place consumers copy code from, and nothing compiled
 * it. Examples went on calling methods that had been renamed, importing names
 * the package did not export, and passing request bodies the schemas reject.
 *
 * Two checks per fenced `typescript` block:
 *   1. It compiles, as its own module, with `deere-sdk` mapped to src/index.ts.
 *   2. Every API it reaches is served in the environment of every client it
 *      constructs. Types cannot see this one: `deere.equipment.get()` compiles
 *      on any client and throws at the first call on the default environment.
 *
 * Neither check says anything about what John Deere's API accepts at runtime.
 * The second cannot see through a deliberate escape from the type system
 * (`as any`), and does not look at absolute URLs passed to `fetchUrl`.
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

/** A place where a block has its hands on a John Deere API. */
interface ApiUse {
  line: number;
  text: string;
  /** Name of the generated API class or safe facade the value is an instance of. */
  apiClass?: string;
  /** Spec name passed straight to a `DeereClient` method. */
  spec?: string;
  /** Why the API cannot be told: the use is reported whatever the environment. */
  unknown?: string;
}

/** A client that a block constructs, or is handed from outside. */
interface ClientOrigin {
  line: number;
  text: string;
  /** The environment it was built for; undefined when the block does not show it. */
  environment: string | undefined;
}

interface Reach {
  uses: ApiUse[];
  clients: ClientOrigin[];
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
 * at the start of a line (indented, `~~~`, `ts`, `tsx`, attributes), and a
 * block that is never closed.
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
      if (/^`{3,}\s*$/.test(text)) {
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

    if (CHECKED_FENCE.test(text)) {
      open = { line: line + 1, code: [], skip: marker?.skip };
    } else {
      if (marker) problems.push(orphaned(marker));
      const fence = FENCE.exec(text);
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

  if (open) problems.push(`README.md:${open.line - 1} typescript block is never closed`);
  if (marker) problems.push(orphaned(marker));
  return { blocks, problems };
}

/**
 * Compile `blocks` in memory. Returns their diagnostics and, for each block,
 * the APIs it reaches and the clients it reaches them through.
 *
 * This is the only function that touches the TypeScript compiler API. That API
 * is the classic JS one that TypeScript 7 no longer ships (see the TypeScript
 * pin in CLAUDE.md), so the port to whatever replaces it is confined to here.
 */
function analyzeBlocks(blocks: readonly Block[]): {
  diagnostics: BlockDiagnostic[];
  reach: Map<Block, Reach>;
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

  // What a block reaches is decided by the TYPE of its expressions, never by
  // how they are spelled. A value typed as a generated API is a use of that
  // API whether it came from `deere.equipment`, `deere['equipment']`,
  // destructuring, an alias, optional chaining on a union, or a subclass.
  const checker = program.getTypeChecker();
  const fileOf = (node: ts.Node | undefined) => normalize(node?.getSourceFile().fileName ?? '');

  type Role = 'client' | 'facades' | 'api';
  /** The SDK classes a type is an instance of, through unions, base classes and generics. */
  const sdkClasses = (type: ts.Type): Array<{ name: string; role: Role }> => {
    const found: Array<{ name: string; role: Role }> = [];
    const pending = [type];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.isUnionOrIntersection()) {
        pending.push(...current.types);
        continue;
      }
      if (current.flags & ts.TypeFlags.Instantiable) {
        // A type parameter or `Deere[K]`: judge it by what it is constrained to.
        const constraint = checker.getBaseConstraintOfType(current);
        if (constraint && constraint !== current) pending.push(constraint);
        continue;
      }
      if (!current.isClass()) continue;
      pending.push(...checker.getBaseTypes(current));
      const symbol = current.getSymbol();
      const name = symbol?.getName() ?? '';
      const file = fileOf(symbol?.declarations?.[0]);
      if (file === `${ROOT}/src/deere.ts` && name === 'Deere') {
        found.push({ name, role: 'client' });
      } else if (file === `${ROOT}/src/client.ts` && name === 'DeereClient') {
        found.push({ name, role: 'client' });
      } else if (file === `${ROOT}/src/safe/index.ts` && name === 'SafeFacades') {
        found.push({ name, role: 'facades' });
      } else if (file.startsWith(`${ROOT}/src/api/`) || file.startsWith(`${ROOT}/src/safe/`)) {
        found.push({ name, role: 'api' });
      }
    }
    return found;
  };
  const rolesOf = (node: ts.Node) => sdkClasses(checker.getTypeAtLocation(node));

  /** True for `new Deere(...)`, `new DeereClient(...)` and the two factory functions. */
  const constructsSdkClient = (node: ts.NewExpression | ts.CallExpression): boolean => {
    let symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const where = `${fileOf(symbol?.declarations?.[0])}#${symbol?.getName()}`;
    return ts.isNewExpression(node)
      ? where === `${ROOT}/src/deere.ts#Deere` || where === `${ROOT}/src/client.ts#DeereClient`
      : where === `${ROOT}/src/deere.ts#createDeere` ||
          where === `${ROOT}/src/client.ts#createClient`;
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
        let value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
        // `'api' as const` and `('api')` are still the literal.
        while (
          value &&
          (ts.isAsExpression(value) ||
            ts.isSatisfiesExpression(value) ||
            ts.isParenthesizedExpression(value))
        ) {
          value = value.expression;
        }
        environment = value && ts.isStringLiteralLike(value) ? value.text : undefined;
      }
    }
    return environment;
  };

  /**
   * For an expression that only passes a value along, the expressions the
   * value can come from. Undefined for anything that makes a value of its own.
   */
  const passesAlong = (node: ts.Node): ts.Expression[] | undefined => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return [node.expression];
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      return [node.expression];
    }
    if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
    if (ts.isBinaryExpression(node)) return [node.left, node.right];
    return undefined;
  };

  /** True when `node` names a DeereClient method that takes the spec name first. */
  const isSpecMethod = (declaration: ts.Declaration | undefined): boolean => {
    if (!declaration || !ts.isMethodDeclaration(declaration)) return false;
    const owner = declaration.parent;
    return (
      ts.isClassDeclaration(owner) &&
      owner.name?.text === 'DeereClient' &&
      fileOf(owner) === `${ROOT}/src/client.ts` &&
      declaration.parameters[0]?.name.getText() === 'specName'
    );
  };

  const reach = new Map<Block, Reach>();
  for (const [name, block] of blockOf) {
    const source = program.getSourceFile(name);
    if (!source) continue;
    const found: Reach = { uses: [], clients: [] };
    reach.set(block, found);

    const line = (node: ts.Node) =>
      block.line + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const text = (node: ts.Node) => node.getText(source).replace(/\s+/g, ' ').slice(0, 80);
    const seenDeclarations = new Set<ts.Node>();
    const origin = (node: ts.Node, environment: string | undefined) => {
      found.clients.push({ line: line(node), text: text(node), environment });
    };

    /**
     * Record where an SDK value entered the block. Values derived from another
     * SDK value (`deere.client`, `const { equipment } = deere`) are not
     * origins; whatever they were derived from is.
     */
    const recordOrigin = (node: ts.Node, isClient: boolean) => {
      if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        if (isClient && constructsSdkClient(node)) {
          origin(node, environmentIn(node.arguments?.[0]));
        } else if (
          ts.isNewExpression(node) &&
          !isClient &&
          (node.arguments ?? []).some((argument) => rolesOf(argument).length > 0)
        ) {
          // An API or facade built on an SDK value takes that value's environment.
        } else {
          origin(node, undefined);
        }
        return;
      }

      // A value that is only passed along has no origin of its own, as long as
      // what it passes along is itself an SDK value. `await somePromise` and
      // `holder.sdk` are not: there the client appears from nowhere the check
      // can read.
      const sources = passesAlong(node);
      if (sources) {
        if (!sources.some((from) => rolesOf(from).length > 0)) origin(node, undefined);
        return;
      }

      if (!ts.isIdentifier(node)) {
        // `this`, and any other way to hold an SDK value.
        origin(node, undefined);
        return;
      }
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (!declaration || seenDeclarations.has(declaration)) return;
      seenDeclarations.add(declaration);

      if (fileOf(declaration) === ambientName) {
        origin(node, DEFAULT_ENVIRONMENT);
      } else if (ts.isVariableDeclaration(declaration)) {
        const from = declaration.initializer;
        const list = declaration.parent;
        // `let sdk: Deere;` gets its value from a later assignment, which is an
        // expression and is examined as one. A `declare`d or loop variable never
        // shows where its value came from.
        const assignedLater =
          ts.isVariableDeclarationList(list) &&
          ts.isVariableStatement(list.parent) &&
          !(list.flags & ts.NodeFlags.Const) &&
          !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient);
        if (from ? rolesOf(from).length === 0 : !assignedLater) origin(node, undefined);
      } else if (ts.isBindingElement(declaration)) {
        let holder: ts.Node = declaration;
        while (
          ts.isBindingElement(holder) ||
          ts.isObjectBindingPattern(holder) ||
          ts.isArrayBindingPattern(holder)
        ) {
          holder = holder.parent;
        }
        const from = ts.isVariableDeclaration(holder) ? holder.initializer : undefined;
        if (!from || rolesOf(from).length === 0) origin(node, undefined);
      } else {
        // A parameter, or anything else that hands the block a value.
        origin(node, undefined);
      }
    };

    /** Identifiers that name a value. Type names and import bindings are not uses. */
    const namesAValue = (node: ts.Identifier) => {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      return (
        declaration !== undefined &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isBindingElement(declaration) ||
          ts.isParameter(declaration))
      );
    };

    const visit = (node: ts.Node): void => {
      // Annotations and `typeof deere` mention a value without using it.
      if (ts.isTypeNode(node)) return;

      // get, post, paginate and the rest of DeereClient take the spec name
      // first. A direct call is found through its resolved signature, so a
      // subclass, an alias, `bind` or a destructured method is covered, and
      // fetchUrl (a URL, not a spec) is not.
      if (
        ts.isCallExpression(node) &&
        isSpecMethod(checker.getResolvedSignature(node)?.declaration)
      ) {
        const argument = node.arguments[0];
        const type = argument ? checker.getTypeAtLocation(argument) : undefined;
        found.uses.push({
          line: line(node),
          text: text(node),
          ...(type?.isStringLiteral()
            ? { spec: type.value }
            : { unknown: 'the spec name is not one literal, so this could call any API' }),
        });
      }
      // The same method taken off the client without being called on the
      // spot (`client.get.call(...)`, a callback) can be given any spec later.
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const member = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
        const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (!called && isSpecMethod(checker.getSymbolAtLocation(member)?.valueDeclaration)) {
          found.uses.push({
            line: line(node),
            text: text(node),
            unknown: 'this client method is not called directly, so it could be given any spec',
          });
        }
      }

      const tracked =
        passesAlong(node) !== undefined ||
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        node.kind === ts.SyntaxKind.ThisKeyword ||
        (ts.isIdentifier(node) && namesAValue(node));
      if (tracked) {
        const roles = rolesOf(node);
        for (const { name: apiClass, role } of roles) {
          if (role === 'api') found.uses.push({ line: line(node), text: text(node), apiClass });
        }
        if (roles.length > 0) {
          recordOrigin(
            node,
            roles.some(({ role }) => role === 'client')
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return { diagnostics, reach };
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
 * The APIs a block reaches that one of its clients cannot serve.
 *
 * The rule is deliberately blunt: every API the block reaches must be served
 * in the environment of EVERY client the block constructs or is handed. It
 * does not trace which client a call goes through, so no reassignment, alias
 * or helper can route a call past it. A block that mixes clients for different
 * environments has to be split, which reads better anyway.
 *
 * Only specs with a fixed host list can fail: the resolver does not check a
 * templated spec against its environment list.
 */
function unservedApis(reach: Reach | undefined): string[] {
  const problems = new Map<string, string>();
  const report = (key: string, message: string) => {
    if (!problems.has(key)) problems.set(key, message);
  };

  for (const use of reach?.uses ?? []) {
    const where = `README.md:${use.line} ${use.text}`;
    if (use.unknown) {
      report(where, `${where}: ${use.unknown}`);
      continue;
    }
    const spec = use.spec ?? SPEC_OF_CLASS.get(use.apiClass ?? '');
    if (!spec) {
      report(where, `${where}: cannot tell which spec ${use.apiClass} belongs to`);
      continue;
    }

    const served = KNOWN_ENVIRONMENTS.filter((environment) => serves(spec, environment));
    if (served.length === KNOWN_ENVIRONMENTS.length) continue;
    const only = `'${spec}' is served on ${served.join(', ')} only`;

    const clients = reach?.clients ?? [];
    if (clients.length === 0) {
      report(`${spec} with no client`, `${where}: ${only}, and this block constructs no client`);
    }
    for (const client of clients) {
      const whose = `\`${client.text}\` (README.md:${client.line})`;
      if (client.environment === undefined) {
        report(
          `${spec} through ${whose}`,
          `${where}: ${only}, and the block does not show which environment ${whose} uses. ` +
            'Construct every client here with a literal environment.'
        );
      } else if (!serves(spec, client.environment)) {
        report(
          `${spec} on ${client.environment}`,
          `${where}: '${spec}' is not served on '${client.environment}', the environment of ` +
            `${whose}. It is served on ${served.join(', ')} only.`
        );
      }
    }
  }
  return [...problems.values()];
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

    it(`README.md:${block.line} reaches only APIs its clients' environments serve`, {
      skip: block.skip,
    }, () => {
      assert.deepStrictEqual(unservedApis(analysis.reach.get(block)), []);
    });
  }
});

describe('the README checker catches what it exists to catch', () => {
  const NOT_ON_SANDBOX = /'equipment' is not served on 'sandboxapi'/;
  const ENVIRONMENT_NOT_SHOWN =
    /'equipment' is served on api, partnerapi only, and the block does not show/;

  // One compile for every control. `unserved` is the list of patterns the
  // environment check must report, in order; `codes` the compile diagnostics.
  const CONTROLS: Record<string, { code: string; codes?: number[]; unserved?: RegExp[] }> = {
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
    'nothing, for an API that every environment serves': {
      code: "await deere.fields.listAll(accessToken);\nawait client.get('fields', '/x');",
    },
    'an API the default environment does not serve': {
      code: 'await deere.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'the same API through its safe facade': {
      code: 'void deere.safe.equipment;',
      unserved: [NOT_ON_SANDBOX],
    },
    'nothing, once the client is built for an environment that serves it': {
      code:
        "import { Deere, createDeere } from 'deere-sdk';\n" +
        'const sdk = new Deere({ accessToken: "t", environment: "api" });\n' +
        "const other = createDeere({ accessToken: 't', environment: 'partnerapi' });\n" +
        'await sdk.equipment.get();\n' +
        'await other.equipment.get();',
    },
    'a default client beside one built for a serving environment': {
      code:
        "import { Deere, DeereClient } from 'deere-sdk';\n" +
        "export const other = new DeereClient({ accessToken: 't', environment: 'api' });\n" +
        "const sdk = new Deere({ accessToken: 't' });\n" +
        'await sdk.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an environment that appears only in a comment inside the config': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        'const sdk = new Deere({\n' +
        "  accessToken: 't',\n" +
        "  // environment: 'api',\n" +
        '});\n' +
        'await sdk.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'nothing, when the environment is written `as const` and a default client is only named in a type':
      {
        code:
          "import { Deere } from 'deere-sdk';\n" +
          "const sdk = new Deere({ accessToken: 't', environment: 'api' as const });\n" +
          'export type Ambient = typeof deere;\n' +
          'await sdk.equipment.get();',
      },
    'nothing, when a client is declared first and constructed afterwards': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        'let sdk: Deere;\n' +
        "sdk = new Deere({ accessToken: 't', environment: 'api' });\n" +
        'await sdk.equipment.get();',
    },
    'a client that arrives through a promise, beside one built for a serving environment': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        'declare function connect(): Promise<Deere>;\n' +
        "const prod = new Deere({ accessToken: 't', environment: 'api' });\n" +
        'const sdk = await connect();\n' +
        'await prod.equipment.get();\n' +
        'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client kept on another object': {
      code:
        "declare const context: { sdk: import('deere-sdk').Deere };\n" +
        'await context.sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client destructured from another object': {
      code:
        "declare const context: { sdk: import('deere-sdk').Deere };\n" +
        'const { sdk } = context;\n' +
        'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'an API picked off the client by a generic key': {
      code:
        "async function pick<K extends 'equipment'>(key: K) {\n" +
        '  return deere[key];\n' +
        '}\n' +
        "await (await pick('equipment')).get();",
      unserved: [NOT_ON_SANDBOX, ENVIRONMENT_NOT_SHOWN],
    },
    'a client read out of untyped data': {
      code:
        "const sdk: import('deere-sdk').Deere = JSON.parse('{}');\n" + 'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'an API reached through `this` in a subclass': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        'export class Mine extends Deere {\n' +
        '  machines() {\n' +
        '    return this.equipment.get();\n' +
        '  }\n' +
        '}',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'nothing, for an API class constructed on a client built for a serving environment': {
      code:
        "import { DeereClient, EquipmentApi } from 'deere-sdk';\n" +
        "const api = new EquipmentApi(new DeereClient({ accessToken: 't', environment: 'api' }));\n" +
        'await api.get();',
    },
    'an API reached through a subclass of the generated class': {
      code:
        "import { EquipmentApi } from 'deere-sdk';\n" +
        'class Machines extends EquipmentApi {}\n' +
        'await new Machines(client).get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an API used inside a generic function, where only the constraint names it': {
      code:
        "export function run<K extends 'equipment'>(key: K) {\n" +
        '  return deere[key].get();\n' +
        '}',
      unserved: [NOT_ON_SANDBOX],
    },
    'a client method invoked through call, where the spec is not the first argument': {
      code: "await client.get.call(client, 'equipment', '/equipment');",
      unserved: [/client\.get: this client method is not called directly/],
    },
    'a client reassigned to one built for another environment': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        "let sdk = new Deere({ accessToken: 't', environment: 'api' });\n" +
        "sdk = new Deere({ accessToken: 't' });\n" +
        'await sdk.equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an API taken off the client by destructuring': {
      code: 'const { equipment } = deere;\nawait equipment.get();',
      unserved: [NOT_ON_SANDBOX],
    },
    'an API reached with bracket access': {
      code: "await deere['equipment'].get();",
      unserved: [NOT_ON_SANDBOX],
    },
    'an API reached through a subclass of the client': {
      code:
        "import { Deere } from 'deere-sdk';\n" +
        'class Mine extends Deere {}\n' +
        "const sdk: Deere = new Mine({ accessToken: 't' });\n" +
        'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client that may be undefined': {
      code:
        "declare const maybe: import('deere-sdk').Deere | undefined;\n" +
        'await maybe?.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client from a helper the check knows nothing about': {
      code:
        "import type { Deere } from 'deere-sdk';\n" +
        'declare function make(config: { accessToken: string }, tier: string): Deere;\n' +
        "const sdk = make({ accessToken: 't' }, 'apicert');\n" +
        'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client passed in as a parameter': {
      code:
        "import type { Deere } from 'deere-sdk';\n" +
        'export const list = (sdk: Deere) => sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a client whose environment is not a literal': {
      code:
        "import { Deere, type Environment } from 'deere-sdk';\n" +
        'declare const environment: Environment;\n' +
        "const sdk = new Deere({ accessToken: 't', environment });\n" +
        'await sdk.equipment.get();',
      unserved: [ENVIRONMENT_NOT_SHOWN],
    },
    'a spec name passed straight to the client, but not a URL passed to fetchUrl': {
      code:
        "await client.get('equipment', '/equipment');\n" +
        "await deere.client.get('equipment', '/equipment');\n" +
        "await client.fetchUrl('GET', 'https://api.deere.com/platform/organizations');",
      unserved: [NOT_ON_SANDBOX],
    },
    'a spec name held in a variable': {
      code: "const spec = 'equipment';\nawait client.get(spec, '/equipment');",
      unserved: [NOT_ON_SANDBOX],
    },
    'a spec name that could be any spec': {
      code: "declare const spec: import('deere-sdk').SpecName;\n" + "await client.get(spec, '/x');",
      unserved: [/the spec name is not one literal/],
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

      const unserved = unservedApis(analysis.reach.get(block));
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
