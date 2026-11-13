/**
 * Generated files contain only the kinds of code the generators write.
 *
 * scripts/lib/emit.ts keeps text from a spec from becoming code at each place
 * it is emitted. This is the second line of defence, and it does not rely on
 * that list of places: it reads the committed output and fails if a generated
 * file holds anything of a kind no generator emits. That covers what injected
 * text has to become in order to run: a static block or other class member, a
 * statement in a types file, a computed value in a generated table, a default
 * value on a parameter, or a statement or call in a method body other than the
 * handful every generated method is built from.
 *
 * What it does not see: types (which cannot run), comments, and the values of
 * string and template literals. A generated file that passes can still name
 * the wrong path or query key; its methods can only build a request and hand
 * it to the client.
 *
 * It runs with the rest of the suite, which CI runs. No release waits for CI:
 * the sync commits and tags, and the release workflow publishes, without
 * running the suite, so as things stand this guards the repository, not a
 * release.
 *
 * Files are parsed, not type-checked, with the TypeScript compiler API. That
 * API is what ties this repo to TypeScript 6; see "Testing conventions" in
 * CLAUDE.md, which lists this file among the ones to port.
 */

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const SRC = join(process.cwd(), 'src');

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('generated.ts', source, ts.ScriptTarget.ES2022, true);
}

function kindOf(node: ts.Node): string {
  return ts.SyntaxKind[node.kind];
}

/** Source text of a node on one line, for messages and for comparing callees. */
function textOf(node: ts.Node): string {
  return node.getText().replace(/\s+/g, '');
}

/**
 * Syntax errors, as problems. The parser recovers from them and still returns
 * a tree, and a recovered tree is not one these checks were written against.
 */
function syntaxProblems(source: string): string[] {
  const { diagnostics = [] } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return diagnostics.map(
    (diagnostic) => `syntax error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
  );
}

function isTypeOnlyImport(node: ts.Statement): boolean {
  return (
    ts.isImportDeclaration(node) && node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
  );
}

/** Problems in a file that should declare types and nothing else. */
function typesFileProblems(source: string): string[] {
  const problems = syntaxProblems(source);
  for (const statement of parse(source).statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    problems.push(`top-level ${kindOf(statement)}`);
  }
  return problems;
}

/** The calls a generated method makes, by callee. Anything else is a problem. */
const CLIENT_CALL = /^this\.client\.(get|post|put|patch|delete|getAll)$/;
const OTHER_CALLS = new Set(['query.set', 'query.toString', 'String']);

/**
 * The local variables a generated body declares, each with the one shape it
 * may have. Callees are matched by their text, so this list is what makes that
 * sound: a body free to declare its own `String` or `query` could make an
 * allowed call that runs something else.
 */
const LOCALS = new Map<string, (initializer: ts.Expression) => boolean>([
  ['query', (initializer) => textOf(initializer) === 'newURLSearchParams()'],
  ['queryString', (initializer) => textOf(initializer) === 'query.toString()'],
  [
    'path',
    // A plain string is accepted too: it is what a formatter rule against
    // templates without substitutions would turn the generated one into.
    (initializer) =>
      ts.isTemplateExpression(initializer) ||
      ts.isNoSubstitutionTemplateLiteral(initializer) ||
      ts.isStringLiteral(initializer),
  ],
]);

/** Names a parameter must not take, for the same reason: a body calls or declares them. */
const NAMES_A_BODY_RELIES_ON = new Set([
  'String',
  'URLSearchParams',
  'encodePathParam',
  ...LOCALS.keys(),
]);

/**
 * The one import of a value a generated wrapper has, compared as text so that
 * no second binding and no other module can come in under the same allowance.
 */
const ENCODER_IMPORT = "import{encodePathParam}from'../path-pattern.js';";

/**
 * The one thing a path template holds besides encoded parameters: the query
 * string, when the method has query parameters. As the generator writes it,
 * with whitespace removed.
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: generated source, compared as text
const QUERY_SUFFIX = "queryString?`?${queryString}`:''";

/**
 * Problems in one generated method body. Every generated body is built from
 * the same few statements (an optional URLSearchParams block, a `path`, one
 * call on the client), so each statement, declaration, node kind and callee is
 * listed here and everything not listed is reported. Type arguments and
 * annotations are never visited: they are reached through no property this
 * walks.
 *
 * `parameters` are the method's own parameter names: with `path`, the only
 * things a body may hand to the client.
 */
function bodyProblems(method: string, body: ts.Block, parameters: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const declared = new Set<string>();
  const report = (node: ts.Node, what = kindOf(node)) => {
    problems.push(`${method}: ${what} (${textOf(node).slice(0, 60)})`);
  };

  const checkDeclarations = (list: ts.VariableDeclarationList): void => {
    // Compared against all the block-scope flags, not tested for the const
    // bit alone: `await using` sets that bit as well.
    const isConst = (list.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const;
    for (const declaration of list.declarations) {
      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '';
      const hasItsShape = LOCALS.get(name);
      const initializer = declaration.initializer;
      if (!isConst || !hasItsShape || !initializer || !hasItsShape(initializer)) {
        report(declaration, 'declaration');
      } else if (declared.has(name)) {
        report(declaration, 'second declaration');
      } else {
        declared.add(name);
        check(initializer);
        // Not about injection: this is the generator's own obligation. A value
        // placed in the path any other way could change which resource is
        // addressed, so the two things a path is built from are listed, and a
        // parameter reaching it through `String(id)` or a conditional is
        // reported like any other.
        if (name === 'path' && ts.isTemplateExpression(initializer)) {
          for (const span of initializer.templateSpans) {
            const isEncoded =
              ts.isCallExpression(span.expression) &&
              textOf(span.expression.expression) === 'encodePathParam';
            if (!isEncoded && textOf(span.expression) !== QUERY_SUFFIX) {
              report(span.expression, 'value written into the path without encodePathParam');
            }
          }
        }
      }
    }
  };

  const isClientCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) && CLIENT_CALL.test(textOf(node.expression));

  /**
   * The request a body ends with: `this.client.<verb>(this.spec, path, ...)`
   * followed by `data, options` or just `options`, all parameters of the
   * method. Every position is pinned. The rule about what a path template
   * holds means nothing if a method can pass one of its own parameters as the
   * path and skip the template, and the encoder, altogether.
   */
  const checkRequest = (call: ts.CallExpression): void => {
    const callee = textOf(call.expression);
    const [spec, path, ...rest] = call.arguments;
    if (!spec || textOf(spec) !== 'this.spec') {
      report(spec ?? call, `first argument to ${callee}`);
    }
    const isTheDeclaredPath =
      path !== undefined && ts.isIdentifier(path) && path.text === 'path' && declared.has('path');
    if (!isTheDeclaredPath) report(path ?? call, `path argument to ${callee}`);

    const tail = rest.map((argument) => (ts.isIdentifier(argument) ? argument.text : '?'));
    const isTheTail = tail.join() === 'options' || tail.join() === 'data,options';
    if (!isTheTail || !tail.every((name) => parameters.has(name))) {
      report(call, `arguments after the path to ${callee}`);
    }
  };

  // Statements appear directly in the body, never nested in a block of their
  // own. The request is the last of them and the only one: a second call on
  // the client, anywhere, would be a request the method was not generated for.
  const checkStatement = (node: ts.Statement, isLast: boolean): void => {
    if (ts.isVariableStatement(node)) {
      checkDeclarations(node.declarationList);
    } else if (ts.isIfStatement(node)) {
      check(node.expression);
      if (ts.isExpressionStatement(node.thenStatement)) check(node.thenStatement.expression);
      else report(node.thenStatement, 'if with a block');
      if (node.elseStatement) report(node.elseStatement, 'else branch');
    } else if (ts.isExpressionStatement(node) || ts.isReturnStatement(node)) {
      // `await` appears in one place, in front of the request when nothing is
      // returned. Anywhere else it is reported: it calls `then` on its operand.
      const expression =
        ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression)
          ? node.expression.expression
          : node.expression;
      if (!expression) return;
      if (isClientCall(expression) && isLast) checkRequest(expression);
      else check(expression);
    } else {
      report(node);
    }
  };

  const check = (node: ts.Expression): void => {
    if (ts.isCallExpression(node)) {
      const callee = textOf(node.expression);
      if (CLIENT_CALL.test(callee)) {
        report(node, 'call on the client that is not what the last statement returns or awaits');
      } else if (OTHER_CALLS.has(callee)) {
        node.arguments.forEach(check);
      } else if (callee === 'encodePathParam') {
        // encodePathParam('orgId', orgId): the parameter's name as a literal,
        // for the error message, then that same parameter of this method.
        const [label, value] = node.arguments;
        const isItsOwnParameter =
          node.arguments.length === 2 &&
          ts.isStringLiteral(label) &&
          ts.isIdentifier(value) &&
          value.text === label.text &&
          parameters.has(value.text);
        if (!isItsOwnParameter) report(node, 'encodePathParam call');
      } else {
        report(node, `call to ${callee}`);
      }
    } else if (ts.isNewExpression(node)) {
      if (textOf(node) !== 'newURLSearchParams()') report(node, 'new expression');
    } else if (ts.isPropertyAccessExpression(node)) {
      check(node.expression);
    } else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        report(node, `operator ${node.operatorToken.getText()}`);
      }
      check(node.left);
      check(node.right);
    } else if (ts.isConditionalExpression(node)) {
      check(node.condition);
      check(node.whenTrue);
      check(node.whenFalse);
    } else if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) check(span.expression);
    } else if (
      !ts.isIdentifier(node) &&
      !ts.isStringLiteral(node) &&
      !ts.isNoSubstitutionTemplateLiteral(node) &&
      node.kind !== ts.SyntaxKind.ThisKeyword
    ) {
      report(node);
    }
  };

  body.statements.forEach((statement, index) => {
    checkStatement(statement, index === body.statements.length - 1);
  });
  return problems;
}

/** Problems with a parameter list: a default value runs whenever it is used. */
function parameterProblems(owner: string, parameters: readonly ts.ParameterDeclaration[]) {
  const problems: string[] = [];
  for (const parameter of parameters) {
    if (ts.getDecorators(parameter)?.length) {
      problems.push(`${owner}: decorator on a parameter`);
    }
    if (!ts.isIdentifier(parameter.name)) {
      problems.push(`${owner}: destructured parameter ${textOf(parameter.name).slice(0, 60)}`);
    } else if (parameter.initializer) {
      problems.push(`${owner}: default value on parameter ${parameter.name.text}`);
    } else if (NAMES_A_BODY_RELIES_ON.has(parameter.name.text)) {
      problems.push(`${owner}: parameter named ${parameter.name.text}, which a body relies on`);
    }
  }
  return problems;
}

/** Problems in a generated `src/api/<spec>.ts` wrapper class. */
function apiFileProblems(source: string): string[] {
  const problems = syntaxProblems(source);
  const classes: ts.ClassDeclaration[] = [];

  for (const statement of parse(source).statements) {
    if (isTypeOnlyImport(statement) || textOf(statement) === ENCODER_IMPORT) continue;
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
    if (ts.isClassDeclaration(statement)) {
      classes.push(statement);
      continue;
    }
    problems.push(`top-level ${kindOf(statement)} (${textOf(statement).slice(0, 80)})`);
  }

  if (classes.length !== 1) problems.push(`${classes.length} classes, expected 1`);

  for (const declaration of classes) {
    // A class's name is in scope inside its own methods, so one called
    // `String` would take over that call. Generated classes all end in `Api`.
    const className = declaration.name?.text ?? '';
    if (!/^[A-Z][A-Za-z0-9]*Api$/.test(className)) {
      problems.push(`class named ${JSON.stringify(className)}`);
    }
    if (declaration.heritageClauses?.length) problems.push('class has an extends or implements');
    if (ts.getDecorators(declaration)?.length) problems.push('class has a decorator');

    for (const member of declaration.members) {
      if (ts.canHaveDecorators(member) && ts.getDecorators(member)?.length) {
        problems.push(`decorator on a ${kindOf(member)}`);
      }
      const modifiers = ts.canHaveModifiers(member)
        ? (ts.getModifiers(member) ?? []).map(kindOf).join(' ')
        : '';

      if (ts.isConstructorDeclaration(member)) {
        if (member.body?.statements.length) problems.push('constructor has a body');
        problems.push(...parameterProblems('constructor', member.parameters));
      } else if (ts.isPropertyDeclaration(member)) {
        const isSpec = ts.isIdentifier(member.name) && member.name.text === 'spec';
        const isLiteral =
          member.initializer !== undefined && ts.isStringLiteral(member.initializer);
        if (!isSpec || !isLiteral || modifiers !== 'PrivateKeyword ReadonlyKeyword') {
          problems.push(`property ${textOf(member).slice(0, 60)}`);
        }
      } else if (ts.isMethodDeclaration(member)) {
        if (!ts.isIdentifier(member.name)) {
          problems.push(`method with a ${kindOf(member.name)} name`);
          continue;
        }
        const name = member.name.text;
        if (modifiers !== 'AsyncKeyword')
          problems.push(`method ${name} is declared "${modifiers}"`);
        problems.push(...parameterProblems(name, member.parameters));
        const parameterNames = new Set(
          member.parameters.map((parameter) => parameter.name.getText())
        );
        if (member.body) problems.push(...bodyProblems(name, member.body, parameterNames));
      } else {
        problems.push(`class member ${kindOf(member)}`);
      }
    }
  }
  return problems;
}

/** Whether an expression is built from string, array and object literals only. */
function isLiteralTree(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node)) return true;
  if (ts.isAsExpression(node)) return isLiteralTree(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isLiteralTree);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        // In an object literal this key sets the prototype instead of a property.
        property.name.text !== '__proto__' &&
        isLiteralTree(property.initializer)
    );
  }
  return false;
}

/** Problems in a generated lookup table: types plus constants that are plain data. */
function tableFileProblems(source: string): string[] {
  const problems = syntaxProblems(source);
  for (const statement of parse(source).statements) {
    if (isTypeOnlyImport(statement)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !isLiteralTree(declaration.initializer)) {
          problems.push(`${declaration.name.getText()} is not plain data`);
        }
      }
      continue;
    }
    problems.push(`top-level ${kindOf(statement)}`);
  }
  return problems;
}

function generatedFiles(directory: string): string[] {
  return readdirSync(join(SRC, directory))
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .sort();
}

/** Fails with the list of problems and what the two possible causes are. */
function assertNoProblems(file: string, problems: string[]): void {
  assert.strictEqual(
    problems.length,
    0,
    `${file} contains code of a kind no generator is known to emit:\n  ${problems.join('\n  ')}\n` +
      `If a generator now writes this on purpose, allow it in tests/generated-structure.test.ts. ` +
      `If not, text from a spec has become code: see scripts/lib/emit.ts.`
  );
}

describe('committed generated files', () => {
  const apiFiles = generatedFiles('api');
  const typeFiles = generatedFiles(join('types', 'generated'));

  it('are present to be checked', () => {
    assert.ok(apiFiles.length > 0, 'no files under src/api');
    assert.deepStrictEqual(typeFiles, apiFiles, 'src/api and src/types/generated should pair up');
  });

  for (const file of apiFiles) {
    it(`src/api/${file} is one wrapper class whose methods only build a request`, () => {
      assertNoProblems(file, apiFileProblems(readFileSync(join(SRC, 'api', file), 'utf8')));
    });
  }

  for (const file of typeFiles) {
    it(`src/types/generated/${file} declares types and nothing else`, () => {
      const source = readFileSync(join(SRC, 'types', 'generated', file), 'utf8');
      assertNoProblems(file, typesFileProblems(source));
    });
  }

  for (const file of ['api-servers.generated.ts', 'hateoas-map.ts']) {
    it(`src/${file} is types and plain data`, () => {
      assertNoProblems(file, tableFileProblems(readFileSync(join(SRC, file), 'utf8')));
    });
  }
});

// Each check is shown the thing it exists to catch. Without these, a check
// that accepted everything would pass the suite above just the same.
describe('the structure checks catch what an injection would have to produce', () => {
  const wrapper = (members: string, before = '') => `
    import type { DeereClient } from '../client.js';
    ${before}
    export class DemoApi {
      private readonly spec: SpecName = 'demo';
      constructor(private readonly client: DeereClient) {}
      ${members}
    }
    export type { components as DemoTypes } from '../types/generated/demo.js';
  `;
  const method = (body: string, parameters = 'id: string, options?: RequestOptions') =>
    wrapper(`async get(${parameters}): Promise<unknown> { ${body} }`);

  const encoderImport = "import { encodePathParam } from '../path-pattern.js';";

  it('accepts wrappers shaped like the generated ones', () => {
    const withQuery = wrapper(
      `
      async list(orgId: string, params?: { count?: number }, options?: RequestOptions): Promise<X> {
        const query = new URLSearchParams();
        if (params?.count !== undefined) query.set('count', String(params.count));
        const queryString = query.toString();
        const path = \`/organizations/\${encodePathParam('orgId', orgId)}/things\${queryString ? \`?\${queryString}\` : ''}\`;
        return this.client.get<PaginatedResponse<components['schemas']['Thing']>>(
          this.spec,
          path,
          options
        );
      }
      async create(data: components['schemas']['Thing'], options?: RequestOptions): Promise<void> {
        const path = \`/things\`;
        await this.client.post(this.spec, path, data, options);
      }
    `,
      encoderImport
    );
    assert.deepStrictEqual(apiFileProblems(withQuery), []);
  });

  // What a well-formed body ends with. `call` alone is for a control that
  // declares its own `path`.
  const call = 'return this.client.get(this.spec, path, options);';
  const request = `const path = \`/a\`; ${call}`;
  const optionsParameter = 'options?: RequestOptions';

  // Each control is reported, and for the reason it is named for: every
  // problem found has to match its pattern. A control that some other check
  // happened to catch would therefore fail, instead of quietly proving nothing.
  const apiControls: Record<string, [source: string, reason: RegExp]> = {
    // The shape a summary containing a comment terminator took before
    // jsDocText: the text after the terminator became a class member.
    'a static block': [
      wrapper('/** Get a thing */ static { globalThis.x = 1; } /* */ async get() {}'),
      /^class member ClassStaticBlockDeclaration$/,
    ],
    'a property other than spec': [
      wrapper('private leak = globalThis.x;'),
      /^property privateleak/,
    ],
    'a static property, even one named spec': [
      wrapper('').replace('private readonly spec', 'static readonly spec'),
      /^property staticreadonlyspec/,
    ],
    'a computed method name': [
      wrapper('async [globalThis.x()]() {}'),
      /^method with a ComputedPropertyName name$/,
    ],
    'a getter': [wrapper('get leak() { return 1; }'), /^class member GetAccessor$/],
    'a method that is not async': [wrapper('static get() {}'), /is declared "StaticKeyword"$/],
    'a constructor that does something': [
      wrapper('').replace('{}', '{ globalThis.x = 1; }'),
      /^constructor has a body$/,
    ],
    'a default value on a constructor parameter': [
      wrapper('').replace('client: DeereClient', 'client: DeereClient = globalThis.x()'),
      /^constructor: default value on parameter client$/,
    ],
    'a statement beside the class': [
      wrapper('', 'globalThis.x = 1;'),
      /^top-level ExpressionStatement/,
    ],
    'an import that loads a module': [
      wrapper('', "import { x } from 'elsewhere';"),
      /^top-level ImportDeclaration \(import\{x\}from'elsewhere';\)$/,
    ],
    // The encoder's import is allowed as that exact statement, so neither a
    // second binding nor another module can come in under it.
    'the encoder imported along with something else': [
      wrapper('', "import { encodePathParam, other } from '../path-pattern.js';"),
      /^top-level ImportDeclaration \(import\{encodePathParam,other\}/,
    ],
    'the encoder imported from another module': [
      wrapper('', "import { encodePathParam } from 'elsewhere';"),
      /^top-level ImportDeclaration \(import\{encodePathParam\}from'elsewhere';\)$/,
    ],
    'a second class': [`${wrapper('')}\nclass ExtraApi {}`, /^2 classes, expected 1$/],
    'a class that takes over a name the bodies call': [
      wrapper('').replace('DemoApi', 'String'),
      /^class named "String"$/,
    ],
    // A stray closing brace after everything else. The parser reports it and
    // builds no node for it, so only the syntax check can be what catches this.
    'source that does not parse': [`${method(request)}\n}`, /^syntax error: /],

    // Method bodies. The first is the shape an enum value took when it closed
    // its quotes and the parameter list: two well-formed async methods.
    'an assignment in a method body': [
      wrapper(`
        async list(params?: { mode?: 'a' }, options?: RequestOptions): Promise<void> { globalThis.x = options; }
        async y(params?: { z?: 'b' }, options?: RequestOptions): Promise<void> {}
      `),
      /^list: operator = /,
    ],
    'a call to anything but the client': [method(`fetch(id); ${request}`), /^get: call to fetch /],
    'a call to a client method the generators do not use': [
      method("return this.client.fetchUrl('GET', id);"),
      /^get: call to this\.client\.fetchUrl /,
    ],
    'a literal handed to the client as the path': [
      method("return this.client.delete(this.spec, '/organizations/1', options);"),
      /^get: path argument to this\.client\.delete /,
    ],
    // Well-formed in every other respect, and it would send the caller's
    // value as the whole path, past the template and the encoder.
    'a parameter handed to the client as the path': [
      method('return this.client.get(this.spec, id, options);'),
      /^get: path argument to this\.client\.get \(id\)$/,
    ],
    'a path the body never declared': [
      method(call),
      /^get: path argument to this\.client\.get \(path\)$/,
    ],
    'something other than the spec as the first argument': [
      method(`const path = \`/a\`; return this.client.get(id, path, options);`),
      /^get: first argument to this\.client\.get \(id\)$/,
    ],
    // The request is the last statement and there is one. Each of these is a
    // well-formed request in every respect but where it stands.
    'a second request ahead of the last one': [
      method(`const path = \`/a\`; await this.client.delete(this.spec, path, options); ${call}`),
      /^get: call on the client that is not what the last statement returns or awaits /,
    ],
    'a request made only when a condition holds': [
      method(
        `const path = \`/a\`; if (id !== undefined) this.client.delete(this.spec, path, options); ${call}`
      ),
      /^get: call on the client that is not what the last statement returns or awaits /,
    ],
    'a request wrapped in another call': [
      method(`const path = \`/a\`; return String(this.client.get(this.spec, path, options));`),
      /^get: call on the client that is not what the last statement returns or awaits /,
    ],
    'a function written in a body': [
      method(`query.set('a', String(() => id)); ${request}`),
      /^get: ArrowFunction /,
    ],
    'a new expression other than URLSearchParams': [
      method(`new Proxy(id, id); ${request}`),
      /^get: new expression /,
    ],
    'a tagged template': [
      method(`query.set('a', String(evil\`x\`)); ${request}`),
      /^get: TaggedTemplateExpression /,
    ],
    'an element access': [
      method(`query.set('a', String(globalThis['x'])); ${request}`),
      /^get: ElementAccessExpression /,
    ],
    'a loop': [method(`for (;;) {} ${request}`), /^get: ForStatement /],
    'a block of its own': [method(`{ query.toString(); } ${request}`), /^get: Block /],
    'an if with a block': [
      method(`if (id !== undefined) { query.toString(); } ${request}`),
      /^get: if with a block /,
    ],
    'an else branch': [
      method(`if (id !== undefined) query.toString(); else query.toString(); ${request}`),
      /^get: else branch /,
    ],

    // The generator's own obligation: every value placed in a path goes
    // through the encoder, called on the parameter it is named for.
    'a value written into the path without the encoder': [
      method(`const path = \`/a/\${id}\`; ${call}`),
      /^get: value written into the path without encodePathParam \(id\)$/,
    ],
    // Each of these is made only of things a body may otherwise contain, so
    // nothing but the rule about what a path holds can be what reports them.
    'a value that reaches the path through String()': [
      method(`const path = \`/a/\${String(id)}\`; ${call}`),
      /^get: value written into the path without encodePathParam \(String\(id\)\)$/,
    ],
    'a value that reaches the path through a property': [
      method(`const path = \`/a/\${options.x}\`; ${call}`),
      /^get: value written into the path without encodePathParam \(options\.x\)$/,
    ],
    'a value that reaches the path inside the query suffix': [
      method(
        `const queryString = query.toString(); const path = \`/a\${queryString ? \`?\${queryString}/\${id}\` : ''}\`; ${call}`
      ),
      /^get: value written into the path without encodePathParam \(queryString\?/,
    ],
    'the encoder called on something that is not the parameter it names': [
      method(`const path = \`/a/\${encodePathParam('id', options)}\`; ${call}`),
      /^get: encodePathParam call /,
    ],
    'the encoder called on something that is not a parameter at all': [
      method(`const path = \`/a/\${encodePathParam('globalThis', globalThis)}\`; ${call}`),
      /^get: encodePathParam call /,
    ],

    // Callees are matched by name, so a body must not be able to rebind one.
    'a local that takes over a name the body calls': [
      method(`const String = globalThis.eval; String(id); ${request}`),
      /^get: declaration \(String=globalThis\.eval\)$/,
    ],
    'a known local given a different value': [
      method(`const query = globalThis.Reflect; query.set(globalThis, id); ${request}`),
      /^get: declaration \(query=globalThis\.Reflect\)$/,
    ],
    'a known local declared twice': [
      method(`const path = \`/a\`; const path = \`/b\`; ${call}`),
      /^get: second declaration /,
    ],
    'a known local declared with let': [
      method(`let path = \`/a\`; ${request}`),
      /^get: declaration \(path=/,
    ],
    // Its flags include the const bit, and disposing it would be a call.
    'a known local declared with await using': [
      method(`await using query = new URLSearchParams(); ${request}`),
      /^get: declaration \(query=newURLSearchParams\(\)\)$/,
    ],
    'an await anywhere but in front of the request': [
      method(`query.set('a', String(await id)); ${request}`),
      /^get: AwaitExpression /,
    ],
    // After the path come the body, if the method takes one, and the options:
    // by those names, in that order, and as the method's own parameters.
    'a global handed to the client after the path': [
      method(`const path = \`/a\`; return this.client.post(this.spec, path, process, options);`),
      /^get: arguments after the path to this\.client\.post /,
    ],
    'a body the method does not take handed to the client': [
      method(`const path = \`/a\`; return this.client.post(this.spec, path, data, options);`),
      /^get: arguments after the path to this\.client\.post /,
    ],
    'a path parameter handed to the client as the options': [
      method(`const path = \`/a\`; return this.client.get(this.spec, path, id);`),
      /^get: arguments after the path to this\.client\.get /,
    ],
    'a request that leaves the options out': [
      method(`const path = \`/a\`; return this.client.get(this.spec, path);`),
      /^get: arguments after the path to this\.client\.get /,
    ],
    'a parameter that takes over a name the body calls': [
      method(request, `id: string, String: any, ${optionsParameter}`),
      /^get: parameter named String, which a body relies on$/,
    ],
    'a default value on a method parameter': [
      method(request, `id: string = globalThis.x(), ${optionsParameter}`),
      /^get: default value on parameter id$/,
    ],
    'a destructured method parameter': [
      method('', '{ a = globalThis.x() }: any'),
      /^get: destructured parameter /,
    ],
    'a decorator on a parameter': [
      method(request, `@dec id: string, ${optionsParameter}`),
      /^get: decorator on a parameter$/,
    ],
  };
  for (const [name, [source, reason]] of Object.entries(apiControls)) {
    it(`reports ${name}`, () => {
      const problems = apiFileProblems(source);
      assert.ok(problems.length > 0, 'nothing was reported');
      for (const problem of problems) assert.match(problem, reason);
    });
  }

  it('accepts a types file and reports a statement in one', () => {
    const types =
      'export interface paths { "/a": never }\nexport type webhooks = Record<string, never>;';
    assert.deepStrictEqual(typesFileProblems(types), []);
    assert.notDeepStrictEqual(typesFileProblems(`${types}\nexport const x = globalThis.x;`), []);
    assert.notDeepStrictEqual(typesFileProblems(`${types}\nglobalThis.x = 1;`), []);
  });

  it('accepts a table of plain data and reports anything computed in one', () => {
    const table = (value: string) => `
      export type SpecName = 'demo';
      export const KNOWN = ['api', 'sandboxapi'] as const;
      export const TABLE = { demo: { kind: 'templated', urls: [${value}] }, 'a-b': {} };
    `;
    assert.deepStrictEqual(tableFileProblems(table("'https://api.deere.com'")), []);
    for (const computed of ['globalThis.x()', "(globalThis.x = 1, 'y')", '...other', '`t`', '1']) {
      assert.notDeepStrictEqual(tableFileProblems(table(computed)), [], computed);
    }
    assert.notDeepStrictEqual(tableFileProblems('export const T = { [globalThis.x()]: {} };'), []);
    assert.notDeepStrictEqual(tableFileProblems('export const T = { get a() { return 1; } };'), []);
    assert.notDeepStrictEqual(tableFileProblems("export const T = { __proto__: { a: 'b' } };"), []);
    assert.notDeepStrictEqual(tableFileProblems("export const T = { '__proto__': {} };"), []);
  });
});
