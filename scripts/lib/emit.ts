/**
 * Putting text from an OpenAPI spec into generated TypeScript.
 *
 * The specs come from John Deere's portal, and the daily sync commits and
 * publishes what the generators emit without a person reading it. So text from
 * a spec must never be able to end the literal, comment or identifier it is
 * written into: what follows would be code in the published package. Before
 * this module the generators interpolated spec text as it came, and a summary
 * containing a comment terminator became a class member that ran when the
 * generated module was loaded.
 *
 * Two defences, by what the text becomes:
 *
 *   - Text that stays data (descriptions, parameter names, enum values, schema
 *     names, URLs) may legitimately contain anything, so it is escaped:
 *     `tsStringLiteral` and `jsDocText`.
 *   - Text that becomes syntax (path keys, path parameter names, environment
 *     names) cannot be escaped, so it is checked against a grammar and the run
 *     stops when it does not fit: the `assert*` functions. Every value in the
 *     committed specs fits (measured when this was written), so a failure means
 *     upstream published something new and a person should look at it.
 *
 * A new emit site that writes text from a spec uses these, and never builds
 * the quotes or the comment itself.
 */

/**
 * A single-quoted TypeScript string literal whose value is exactly `value`.
 *
 * JSON.stringify does the escaping, since a JSON string is also a valid
 * JavaScript one. Only the quote style is changed afterwards, so the output
 * for ordinary values is the same text the generators have always emitted and
 * regenerating produces no diff.
 */
export function tsStringLiteral(value: string): string {
  const json = JSON.stringify(value).slice(1, -1);
  // One pass over escape pairs and bare single quotes. Handling pairs as units
  // is what keeps `\\"` (a backslash, then a quote) from being misread.
  const body = json.replace(/\\(.)|'/g, (match, escaped: string | undefined) => {
    if (match === "'") return "\\'";
    return escaped === '"' ? '"' : match;
  });
  return `'${body}'`;
}

/**
 * `text` made safe to place inside a block comment: it can no longer close
 * the comment. Everything else is left alone.
 */
export function jsDocText(text: string): string {
  return text.replaceAll('*/', '*\\/');
}

/**
 * `$` is a legal identifier character and is left out on purpose. No spec
 * uses it, and generate-sdk puts parameter names into a String.replace
 * replacement, where `$$` and `$&` are patterns: `{$$}` was emitted as `${$}`.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Words that cannot name a parameter of the async methods the generator emits
 * (generated files are modules, so strict-mode rules apply).
 */
const RESERVED_WORDS = new Set(
  (
    'arguments await break case catch class const continue debugger default delete do else enum ' +
    'eval export extends false finally for function if implements import in instanceof interface ' +
    'let new null package private protected public return static super switch this throw true ' +
    'try typeof var void while with yield'
  ).split(' ')
);

const LITERAL_PATH_SEGMENT = /^[A-Za-z0-9_.@-]+$/;

/** Lowercase labels joined by dots or hyphens: what a hostname label can hold. */
const ENVIRONMENT_NAME = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

/** The same hosts src/client.ts trusts with the access token. */
const DEERE_HOST = /^([a-z0-9-]+\.)*deere\.com$/i;

/** What to do when the refused value turns out to be legitimate. */
const widen = (grammarName: string) =>
  `If John Deere really publishes this, widen ${grammarName} in scripts/lib/emit.ts.`;

function refuse(where: string, what: string, value: string, why: string, remedy: string): never {
  throw new Error(
    `${where}: ${what} ${JSON.stringify(value)} cannot be written into generated code: ${why}. ` +
      `It comes from the upstream spec and would become source text, so the run stops here ` +
      `for a person to look at it. ${remedy}`
  );
}

/** Throws unless `name` can be emitted as a parameter name. */
export function assertIdentifier(name: string, where: string): void {
  if (!IDENTIFIER.test(name)) {
    refuse(where, 'parameter name', name, 'it is not a plain identifier', widen('IDENTIFIER'));
  }
  if (RESERVED_WORDS.has(name)) {
    refuse(
      where,
      'parameter name',
      name,
      'it is a reserved word',
      'If John Deere really publishes this, the generator has to give the parameter another ' +
        'name before it can emit it.'
    );
  }
}

/**
 * Throws unless `path` is a path key the generators can emit: a `/`, then
 * segments that are each either `{parameter}` or made only of letters, digits
 * and `_ . @ -`. A path key is written into a template literal, into object
 * keys and into comments, and its parameter names become identifiers.
 */
export function assertPathKey(path: string, where: string): void {
  if (!path.startsWith('/')) {
    refuse(where, 'path', path, 'it does not start with "/"', widen('assertPathKey'));
  }
  for (const segment of path.slice(1).split('/')) {
    const parameter = /^\{(.*)\}$/.exec(segment);
    if (parameter) {
      assertIdentifier(parameter[1], `${where}, path ${JSON.stringify(path)}`);
    } else if (segment === '.' || segment === '..' || !LITERAL_PATH_SEGMENT.test(segment)) {
      refuse(
        where,
        'path',
        path,
        `segment ${JSON.stringify(segment)} is neither a {parameter} nor made only of letters, digits and _ . @ -`,
        widen('LITERAL_PATH_SEGMENT')
      );
    }
  }
}

/**
 * Throws unless `name` can be an environment: it is substituted into a
 * hostname at run time and written into the `Environment` union here.
 */
export function assertEnvironmentName(name: string, where: string): void {
  if (!ENVIRONMENT_NAME.test(name)) {
    refuse(
      where,
      'environment name',
      name,
      'it is not lowercase letters and digits joined by dots or hyphens',
      widen('ENVIRONMENT_NAME')
    );
  }
}

/**
 * Whether `url` is a base the resolver can append a path to and stay on John
 * Deere: an https URL on deere.com or a subdomain of it, with no credentials,
 * query or fragment. The last two matter because a request URL is built by
 * appending the path to this string: after a `?` or `#` the path would land in
 * the query or the fragment, and every request would go to the base itself.
 */
export function isHttpsDeereBaseUrl(url: string): boolean {
  if (/[?#]/.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    DEERE_HOST.test(parsed.hostname) &&
    parsed.username === '' &&
    parsed.password === ''
  );
}
