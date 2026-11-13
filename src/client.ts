/**
 * John Deere API Client
 *
 * Unofficial TypeScript SDK for John Deere Operations Center API.
 *
 * URL resolution flow (v2.0):
 *
 *   User code
 *     │
 *     ▼
 *   deere.equipmentMeasurement.post(params)
 *     │
 *     ▼
 *   this.client.post('equipment-measurement', '/orgs/.../measurements', data, options)
 *     │
 *     ▼
 *   DeereClient.post()
 *     ├─ resolveRequestUrl(spec, path, this.environment)
 *     │    ├─ API_SERVERS[spec] lookup
 *     │    ├─ templated   → urlTemplate.replace('{environment}', env)
 *     │    ├─ static      → urlByEnvironment[env]  (throws UnsupportedEnvironmentError if missing)
 *     │    └─ unavailable → throws NoServerConfigError
 *     └─ requestUrl('POST', url, body, options)
 *          └─ fetch(url, ...) with retry + timeout
 *
 * A caller who already holds an absolute URL bypasses the resolver with
 * fetchUrl() or followLink(). Whichever way a URL arrives, requestUrl()
 * attaches the Bearer token only when it is an https URL on *.deere.com.
 *
 * URL data lives in src/api-servers.generated.ts, built from OpenAPI specs at
 * build time by scripts/generate-api-servers.ts. Never hand-edit that file.
 */

import {
  DEFAULT_ENVIRONMENT,
  type Environment,
  KNOWN_ENVIRONMENTS,
  type SpecName,
} from './api-servers.generated.js';
import { resolveRequestUrl } from './environment-resolver.js';

// Re-export Environment and SpecName for consumer convenience.
export type { Environment, SpecName };

/**
 * Legacy v1 environment names (kept for error-message migration hints only).
 * v1 consumers passing 'production'/'sandbox'/etc. get a thrown error at
 * construction time pointing them at the v2 raw subdomain name.
 */
const V1_LEGACY_ENV_NAMES: Record<string, Environment> = {
  production: 'api',
  sandbox: 'sandboxapi',
  partner: 'partnerapi',
  cert: 'apicert',
  qa: 'apiqa.tal',
};

export interface DeereClientConfig {
  /** OAuth access token */
  accessToken: string;
  /**
   * API environment — uses raw JD subdomain names. Defaults to 'sandboxapi'.
   *
   * Valid values: 'api' | 'sandboxapi' | 'partnerapi' | 'apicert' | 'apiqa.tal'
   *             | 'partnerapicert' | 'partnerapiqa' | 'sandboxapiqa' | 'apidev.tal'
   *
   * Migration from v1: 'production' → 'api', 'sandbox' → 'sandboxapi',
   * 'partner' → 'partnerapi', 'cert' → 'apicert', 'qa' → 'apiqa.tal'.
   */
  environment?: Environment;
  /**
   * Custom fetch implementation. It must honour `init.signal`: that signal is
   * how a timeout or a cancellation interrupts a request in flight.
   */
  fetch?: typeof fetch;
  /**
   * Default headers to include in all requests. An `Authorization` entry here
   * is ignored: the token comes from `accessToken`, or for a single request
   * from that request's `options.headers`.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * How long each attempt may wait for a response to start, in milliseconds.
   * Defaults to 30000. Reading the response body is not limited by it.
   * `Infinity` turns it off.
   */
  timeout?: number;
  /** Maximum number of retry attempts for failed requests. Defaults to 3. Set to 0 to disable retries. */
  maxRetries?: number;
  /**
   * Whether a POST or PATCH is retried like any other request. Defaults to
   * `true`; the default becomes `false` in 4.0.
   *
   * A POST or PATCH that ends in a server error, a network error or a timeout
   * may still have been carried out, so sending it again can do the work
   * twice. With `false`, those two methods are retried only after a 429, on
   * the understanding that a rate limiter turns a request away before it is
   * handled (that is how rate limiting works in practice, not something HTTP
   * promises). GET, PUT and DELETE are retried either way: HTTP defines
   * repeating them as having the same effect.
   *
   * With `false`, a method passed to `fetchUrl` that RFC 9110 does not define
   * as idempotent is treated as POST and PATCH are.
   */
  retryNonIdempotent?: boolean;
  /**
   * Enable HATEOAS link traversal. When true, the client fetches parent resources
   * and follows HAL links instead of constructing URLs directly.
   * Required for John Deere production API certification.
   * @default false
   */
  hateoas?: boolean;
  /** Log HATEOAS resolution details to console for debugging. @default false */
  hateoasDebug?: boolean;
}

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff. Defaults to 1000 */
  baseDelay: number;
  /** Maximum delay in milliseconds. Defaults to 30000 */
  maxDelay: number;
}

export interface RequestOptions {
  /** Additional headers for this request */
  headers?: Record<string, string>;
  /**
   * Cancels the call. Once it aborts, the call rejects with the signal's
   * `reason` (an `AbortError`, unless `abort()` was given something else),
   * as `fetch` does. A cancelled request is not retried, a wait before a
   * retry ends at once, and no further page or link is requested. The
   * timeout applies whether or not a signal is given.
   */
  signal?: AbortSignal;
  /** The client's `timeout`, for this call only. `Infinity` turns it off. */
  timeout?: number;
}

export interface PaginatedResponse<T> {
  values: T[];
  total?: number;
  links?: Link[];
}

export interface Link {
  '@type'?: string;
  rel: string;
  uri: string;
}

// Error classes live in ./errors.ts to avoid a circular import with
// environment-resolver.ts. Imported here for internal use (throws, instanceof
// checks) and re-exported for backward compatibility with any consumer that
// imports them from 'deere-sdk' main entry.
import {
  AuthError,
  CLIENT_ERROR_STATUS,
  DeereError,
  HateoasError,
  RateLimitError,
} from './errors.js';

export { AuthError, DeereError, HateoasError, RateLimitError };

const DEERE_ACCEPT_HEADER = 'application/vnd.deere.axiom.v3+json';

/**
 * Hostnames the access token may be sent to. See isTrustedUrl, which is what
 * callers should use: the hostname alone is not the whole test.
 *
 * Matches: deere.com, api.deere.com, foo.bar.deere.com, etc.
 * Does not match: untrusted.example, deere.com.untrusted.example, localhost.
 */
const TRUSTED_HOSTS = /^([a-z0-9-]+\.)*deere\.com$/i;

/**
 * Whether a request to this URL may carry the access token, and whether a
 * link naming it may be followed on a caller's behalf. https is required as
 * well as the host: over http the token would cross the network in the clear.
 */
function isTrustedUrl(url: URL): boolean {
  return url.protocol === 'https:' && TRUSTED_HOSTS.test(url.hostname);
}

/**
 * Why the client must not follow a link it found in a response body, as a
 * clause that completes "the link ...", or undefined when it may follow it.
 *
 * This is for links the client follows on its own: a HATEOAS rel, a nextPage.
 * Nobody chose those URLs, so one that leaves https deere.com is refused
 * outright. Requesting it without the token is not enough: the request still
 * reaches that host, with the caller's own headers and, for a POST or PUT, the
 * body, and whatever comes back would be returned as John Deere's data. A URL
 * the caller passes to fetchUrl() or followLink() is theirs to request.
 */
function untrustedLinkProblem(uri: string): string | undefined {
  let target: URL;
  try {
    target = new URL(uri);
  } catch {
    return 'is not an absolute URL';
  }
  if (isTrustedUrl(target)) return undefined;
  return `points to '${target.hostname}' (${target.origin}), which is not an https URL on deere.com`;
}

/**
 * Header names are case-insensitive on the wire, but they are object keys
 * here. `Authorization` and `authorization` are separate keys that fetch sends
 * as a single header with both values joined, so every check on this header
 * has to ignore case.
 */
function isAuthorizationHeader(name: string): boolean {
  return name.toLowerCase() === 'authorization';
}

/** HTTP status codes that are safe to retry */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * The methods HTTP defines as idempotent (RFC 9110, section 9.2.2): sending
 * one twice has the effect of sending it once. Whether any other method is
 * sent again after a failure is up to the `retryNonIdempotent` option. That
 * is POST and PATCH among the five the SDK uses, and it is also any method
 * this list does not know, since fetchUrl takes whatever the caller writes.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE']);

/**
 * The longest delay a timer can be set for. Asked for a longer one, `Infinity`
 * included, Node sets it for 1 ms, which would time out every attempt at once.
 */
const MAX_TIMER_DELAY = 2 ** 31 - 1;

import { HATEOAS_MAP } from './hateoas-map.js';
import { pathSegments, segmentsMatchPattern } from './path-pattern.js';

class LinkCache {
  private cache = new Map<string, Link[]>();

  set(parentPath: string, links: Link[]): void {
    this.cache.set(parentPath, links);
  }

  findRel(parentPath: string, rel: string): string | undefined {
    const links = this.cache.get(parentPath);
    if (!links) return undefined;
    return links.find((l) => l.rel === rel)?.uri;
  }

  has(parentPath: string): boolean {
    return this.cache.has(parentPath);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * John Deere API Client
 *
 * @example
 * ```typescript
 * const client = new DeereClient({
 *   accessToken: 'your-token',
 *   environment: 'sandboxapi',  // v2: raw JD subdomain, not 'sandbox'
 *   maxRetries: 3, // Retries with exponential backoff (default: 3)
 * });
 *
 * // v2: first arg is the spec name (generated classes do this for you)
 * const orgs = await client.get('organizations', '/organizations');
 * ```
 *
 * @remarks
 * The client automatically retries failed requests with exponential backoff and jitter
 * for transient errors (429, 500, 502, 503, 504) and network failures.
 * Rate limit responses (429) respect the Retry-After header when provided.
 * Set `maxRetries: 0` to disable automatic retries.
 */
export class DeereClient {
  private readonly environment: Environment;
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly retryConfig: RetryConfig;
  private readonly retryNonIdempotent: boolean;
  private readonly hateoas: boolean;
  private readonly hateoasDebug: boolean;
  private readonly linkCache = new LinkCache();

  constructor(config: DeereClientConfig) {
    this.accessToken = config.accessToken;
    this.environment = this.validateEnvironment(config.environment);
    this.fetchFn = config.fetch ?? fetch;
    this.timeout = config.timeout ?? 30000;
    this.hateoas = config.hateoas ?? false;
    this.hateoasDebug = config.hateoasDebug ?? false;
    // Authorization is left out of the defaults: a header set for every
    // request would also reach every host the client contacts. See buildHeaders.
    const configuredHeaders = Object.entries(config.defaultHeaders ?? {}).filter(
      ([name]) => !isAuthorizationHeader(name)
    );
    this.defaultHeaders = {
      Accept: DEERE_ACCEPT_HEADER,
      'Content-Type': DEERE_ACCEPT_HEADER,
      ...Object.fromEntries(configuredHeaders),
    };
    this.retryConfig = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: 1000,
      maxDelay: 30000,
    };
    // 4.0 makes this default false. tests/retry.test.ts fails at that major
    // until it is changed here.
    this.retryNonIdempotent = config.retryNonIdempotent ?? true;
  }

  /**
   * Validates the environment string from config. Throws at construction
   * time with a migration hint if the user passed a v1 friendly name or an
   * unknown string — catches errors immediately instead of at first request.
   */
  private validateEnvironment(raw: string | undefined): Environment {
    const env = raw ?? DEFAULT_ENVIRONMENT;
    if (KNOWN_ENVIRONMENTS.includes(env as Environment)) {
      return env as Environment;
    }
    const v2Replacement = V1_LEGACY_ENV_NAMES[env];
    const migrationHint = v2Replacement
      ? `\n\nv2.0 replaced v1 friendly environment names with raw JD subdomains. ` +
        `Use '${v2Replacement}' instead of '${env}'. See CHANGELOG.md for the full table.`
      : '';
    throw new Error(
      `Invalid environment '${env}'. Valid values: ${KNOWN_ENVIRONMENTS.join(', ')}.` +
        migrationHint
    );
  }

  /**
   * GET request, spec-aware. Generated API classes call this with their own
   * `spec` as the first argument — consumers don't normally call it directly.
   */
  async get<T = unknown>(specName: SpecName, path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(specName, 'GET', path, undefined, options);
  }

  /**
   * POST request, spec-aware.
   */
  async post<T = unknown>(
    specName: SpecName,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(specName, 'POST', path, body, options);
  }

  /**
   * PUT request, spec-aware.
   */
  async put<T = unknown>(
    specName: SpecName,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(specName, 'PUT', path, body, options);
  }

  /**
   * DELETE request, spec-aware.
   */
  async delete<T = unknown>(
    specName: SpecName,
    path: string,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(specName, 'DELETE', path, undefined, options);
  }

  /**
   * PATCH request, spec-aware.
   */
  async patch<T = unknown>(
    specName: SpecName,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.request<T>(specName, 'PATCH', path, body, options);
  }

  /**
   * Fetch an absolute URL directly. Escape hatch for HATEOAS next-page links,
   * HAL link traversal, and power users with pre-resolved URLs.
   *
   * **Security**: the Bearer token is attached only to an https URL on
   * `*.deere.com`. Any other URL is still requested, with no Authorization
   * header. To send auth elsewhere, set `Authorization` in `options.headers`.
   * The same rule covers every request this client makes; see buildHeaders.
   */
  async fetchUrl<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return this.requestUrl<T>(method, url, body, options);
  }

  /**
   * Follow a HAL link from a response. Accepts a Link object or a raw URL
   * string.
   */
  async followLink<T = unknown>(link: Link | string, options?: RequestOptions): Promise<T> {
    const uri = typeof link === 'string' ? link : link.uri;
    return this.fetchUrl<T>('GET', uri, undefined, options);
  }

  /**
   * Paginate through all results following nextPage links. First page is
   * resolved via the spec's URL config; subsequent pages use the absolute
   * URLs returned by the API in `response.links`.
   */
  async *paginate<T>(
    specName: SpecName,
    path: string,
    options?: RequestOptions
  ): AsyncGenerator<T[], void, unknown> {
    // First page: resolve via the spec (templated or static lookup).
    let url: string | undefined = this.hateoas
      ? await this.resolveHateoasUrl(specName, path, options)
      : resolveRequestUrl(specName, path, this.environment);

    while (url) {
      const response: PaginatedResponse<T> = await this.requestUrl<PaginatedResponse<T>>(
        'GET',
        url,
        undefined,
        options
      );

      if (response.values && response.values.length > 0) {
        yield response.values;
      }

      // Find nextPage link. Always absolute in JD's HAL responses.
      const nextPageLink: Link | undefined = response.links?.find(
        (l: Link) => l.rel === 'nextPage'
      );
      url = nextPageLink?.uri;

      // `options` was given for the first page. Every later URL comes from a
      // response, so it is checked before those headers are sent to it.
      const problem = url ? untrustedLinkProblem(url) : undefined;
      if (problem) {
        throw new DeereError(
          `Pagination stopped: the nextPage link ${problem}. The link was not followed.`,
          CLIENT_ERROR_STATUS,
          'UntrustedLink'
        );
      }
    }
  }

  /**
   * Get all items from a paginated endpoint, spec-aware.
   */
  async getAll<T>(specName: SpecName, path: string, options?: RequestOptions): Promise<T[]> {
    const items: T[] = [];
    for await (const page of this.paginate<T>(specName, path, options)) {
      items.push(...page);
    }
    return items;
  }

  private async request<T>(
    specName: SpecName,
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const url = this.hateoas
      ? await this.resolveHateoasUrl(specName, path, options)
      : resolveRequestUrl(specName, path, this.environment);
    return this.requestUrl<T>(method, url, body, options);
  }

  private async requestUrl<T>(
    method: string,
    url: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    // Parsed before the loop, outside its try. `new URL` throws a TypeError on
    // an unparseable URL, and inside the try that would be taken for a network
    // failure and retried with backoff.
    const headers = this.buildHeaders(new URL(url), options?.headers);
    const timeout = options?.timeout ?? this.timeout;
    const callerSignal = options?.signal;
    // Whether this request may be sent again after a failure that could have
    // left it carried out: a server error, a dropped connection, a timeout.
    // The method is compared in upper case because fetchUrl passes it on as
    // the caller wrote it.
    const repeatable = this.retryNonIdempotent || IDEMPOTENT_METHODS.has(method.toUpperCase());

    for (let attempt = 0; ; attempt++) {
      const mayRetry = attempt < this.retryConfig.maxRetries;
      const mayRepeat = mayRetry && repeatable;

      // A listener is never called for a signal that has already aborted, so
      // that case is looked for here, ahead of every attempt.
      callerSignal?.throwIfAborted();

      // fetch is given this attempt's own signal and no other. Two things abort
      // it, the timeout and the caller, and `timedOut` records which: the two
      // are handled differently and the error fetch rejects with does not say.
      // Passing the caller's signal straight to fetch, as this once did, left
      // such a request with no timeout at all, and had a cancellation retried
      // and then reported as a timeout.
      const controller = new AbortController();
      let timedOut = false;
      // A timeout longer than a timer can hold gets no timer, so `Infinity`
      // means what it says: no timeout.
      const timeoutId =
        timeout > MAX_TIMER_DELAY
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeout);
      const onCallerAbort = () => controller.abort(callerSignal?.reason);
      callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

      let retryDelay: number;
      try {
        const response = await this.fetchFn(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        // The timeout is for the wait until a response starts. Reading the
        // body is not limited by it, though the caller can still cancel that.
        clearTimeout(timeoutId);

        if (response.ok) {
          // Handle empty responses
          const contentLength = response.headers.get('content-length');
          if (contentLength === '0' || response.status === 204) {
            return undefined as T;
          }

          const contentType = response.headers.get('content-type');
          if (
            contentType?.includes('application/json') ||
            contentType?.includes('application/vnd.deere')
          ) {
            return (await response.json()) as T;
          }

          return (await response.text()) as unknown as T;
        }

        // Any request may be sent again after a 429, on the understanding that
        // a rate limiter turns a request away before it is handled. The other
        // retryable statuses are server errors, where no such thing is known.
        const retryIt =
          response.status === 429 ? mayRetry : mayRepeat && this.isRetryable(response.status);
        if (!retryIt) {
          // Always throws. Awaited here so that reading the error body is
          // still inside the try, where the caller can cancel it.
          return await this.handleError(response);
        }

        // Extract retry-after for rate limits
        const retryAfter =
          response.status === 429
            ? Number.parseInt(response.headers.get('retry-after') ?? '', 10)
            : undefined;
        retryDelay = this.calculateRetryDelay(
          attempt,
          Number.isNaN(retryAfter as number) ? undefined : retryAfter
        );
      } catch (error) {
        // The caller cancelled. Whatever was thrown, they get the reason they
        // aborted with, as fetch gives it, and nothing is tried again.
        if (callerSignal?.aborted) throw callerSignal.reason;

        // An error response, already turned into the error to report. Checked
        // before the network rule below, which goes by the message's wording.
        if (error instanceof DeereError) throw error;

        if (timedOut) {
          if (!mayRepeat) throw new DeereError('Request timeout', 0, 'Timeout');
        } else if (!mayRepeat || !this.isNetworkError(error)) {
          throw error;
        }
        retryDelay = this.calculateRetryDelay(attempt);
      } finally {
        clearTimeout(timeoutId);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }

      await this.sleep(retryDelay, callerSignal);
    }
  }

  /**
   * The headers for one request. This is the only place the access token is
   * attached, so every request is decided by where it is going, whether the
   * URL came from the resolver, from a link in a response, or from a caller.
   * Before this lived here, only fetchUrl() checked, and a link discovered in
   * HATEOAS mode was sent the token whatever host it named.
   *
   * An Authorization header in `callerHeaders` is sent as given, to any host:
   * the caller chose it for this request. It also replaces the token, so the
   * two never travel together.
   */
  private buildHeaders(
    target: URL,
    callerHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders };

    if (!Object.keys(callerHeaders).some(isAuthorizationHeader)) {
      if (isTrustedUrl(target)) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      } else if (this.hateoasDebug) {
        console.warn(
          `[deere-sdk] '${target.hostname}' is not a trusted destination (${target.origin}): ` +
            `the Bearer token is sent only to https URLs on *.deere.com, so it was suppressed. ` +
            `Pass Authorization in options.headers to send one anyway.`
        );
      }
    }

    return Object.assign(headers, callerHeaders);
  }

  /**
   * Clear the HATEOAS link cache. Useful for long-lived clients or testing.
   */
  clearLinkCache(): void {
    this.linkCache.clear();
  }

  /**
   * Pre-fetch parent resources to warm the HATEOAS link cache.
   * Reduces latency for subsequent HATEOAS-resolved requests.
   *
   * @param specName - Spec that owns the paths (e.g. 'organizations')
   * @param paths - Parent resource paths to pre-fetch (defaults to '/organizations')
   */
  async warmLinkCache(specName: SpecName, paths: string[] = ['/organizations']): Promise<void> {
    for (const path of paths) {
      try {
        const url = resolveRequestUrl(specName, path, this.environment);
        const response = await this.requestUrl<{ links?: Link[] }>('GET', url);
        if (response?.links) {
          this.linkCache.set(path, response.links);
        }
      } catch {
        // Best-effort — skip paths that fail
      }
    }
  }

  /**
   * Match a concrete path against the HATEOAS route map.
   * Returns the concrete parent path, rel name, and optional parentSpec
   * (which spec owns the parent resource — used for cross-spec HATEOAS).
   * Returns null if no map entry matches.
   */
  private matchHateoasPattern(
    concretePath: string
  ): { concreteParentPath: string; rel: string; parentSpec?: SpecName } | null {
    const concreteSegments = pathSegments(concretePath);

    for (const [pattern, route] of Object.entries(HATEOAS_MAP)) {
      if (segmentsMatchPattern(concreteSegments, pattern)) {
        // Build the concrete parent path by substituting actual values
        const parentSegments = pathSegments(route.parentPath);
        const concreteParentParts = parentSegments.map((seg, i) =>
          seg.startsWith('{') ? concreteSegments[i] : seg
        );
        const concreteParentPath = `/${concreteParentParts.join('/')}`;

        // parentSpec is optional on the route interface to allow gradual
        // rollout — Phase 6 populates it. Falls back to the caller's spec
        // when absent (same-spec HATEOAS, the common case).
        const routeWithParentSpec = route as typeof route & { parentSpec?: SpecName };
        return {
          concreteParentPath,
          rel: route.rel,
          parentSpec: routeWithParentSpec.parentSpec,
        };
      }
    }

    return null;
  }

  /**
   * Resolve a path via HATEOAS link traversal, spec-aware.
   *
   * Fetches the parent resource (via the parent's own spec host, not the
   * child's — critical for cross-spec flows like equipment.yaml's org-scoped
   * endpoints whose parent `/organizations/{orgId}` lives on the platform
   * host, not equipmentapi.deere.com/isg).
   *
   * `options` are the ones given for the call being resolved. Its signal and
   * timeout govern the parent fetch as well, which is part of that call. Its
   * headers do not: they were chosen for the request the caller asked for,
   * and an Authorization among them would replace the client's token on a
   * request the caller never saw.
   *
   * Throws HateoasError if resolution fails. If the caller has cancelled, it
   * throws their abort reason, unwrapped, in place of that.
   */
  private async resolveHateoasUrl(
    specName: SpecName,
    path: string,
    options?: RequestOptions
  ): Promise<string> {
    // Strip query params for matching, reattach after
    const [basePath, queryString] = path.split('?', 2);
    const match = this.matchHateoasPattern(basePath);

    if (!match) {
      // No map entry — resolve directly via the caller's spec.
      return resolveRequestUrl(specName, path, this.environment);
    }

    const { concreteParentPath, rel, parentSpec } = match;
    // parentSpec is optional; fall back to the caller's spec if the HATEOAS
    // map doesn't record which spec owns the parent (Phase 5 compat — Phase 6
    // regenerates hateoas-map.ts with parentSpec populated).
    const effectiveParentSpec: SpecName = parentSpec ?? specName;

    // Check cache
    let discoveredUrl = this.linkCache.findRel(concreteParentPath, rel);

    if (!discoveredUrl) {
      // Cache miss — fetch parent resource via its OWN spec's host.
      try {
        const parentUrl = resolveRequestUrl(
          effectiveParentSpec,
          concreteParentPath,
          this.environment
        );
        const parentResponse = await this.requestUrl<{ links?: Link[] }>(
          'GET',
          parentUrl,
          undefined,
          { signal: options?.signal, timeout: options?.timeout }
        );

        if (parentResponse?.links) {
          this.linkCache.set(concreteParentPath, parentResponse.links);
          discoveredUrl = this.linkCache.findRel(concreteParentPath, rel);
        }
      } catch (error) {
        // A cancellation is not a failure to resolve the link. The reason is
        // thrown, not `error`: the lookup above can fail before any request,
        // and a caller who cancelled is owed their reason then as well.
        if (options?.signal?.aborted) throw options.signal.reason;
        throw new HateoasError(
          `HATEOAS resolution failed: could not fetch parent resource "${concreteParentPath}"`,
          path,
          error instanceof Error ? error : undefined
        );
      }
    }

    if (!discoveredUrl) {
      const cachedLinks = this.linkCache.has(concreteParentPath);
      throw new HateoasError(
        `HATEOAS resolution failed: parent "${concreteParentPath}" has no link with rel "${rel}"${cachedLinks ? '' : ' (parent returned no links)'}`,
        path
      );
    }

    const problem = untrustedLinkProblem(discoveredUrl);
    if (problem) {
      throw new HateoasError(
        `HATEOAS resolution failed: parent "${concreteParentPath}" has a link with rel "${rel}" that ${problem}. The link was not followed.`,
        path
      );
    }

    // Reattach query params
    const resolvedUrl = queryString ? `${discoveredUrl}?${queryString}` : discoveredUrl;

    if (this.hateoasDebug) {
      console.log(
        `[HATEOAS] ${path} → parent: ${concreteParentPath}, rel: ${rel} → ${resolvedUrl}`
      );
    }

    return resolvedUrl;
  }

  /**
   * Check if an error/status code is retryable
   */
  private isRetryable(status: number): boolean {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  /**
   * Check if an error is a network error (fetch failed)
   */
  private isNetworkError(error: unknown): boolean {
    return (
      error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'))
    );
  }

  /**
   * Calculate delay for retry attempt using exponential backoff with full jitter
   */
  private calculateRetryDelay(attempt: number, retryAfter?: number): number {
    // If server specified Retry-After, respect it (but cap at maxDelay)
    if (retryAfter !== undefined && retryAfter > 0) {
      return Math.min(retryAfter * 1000, this.retryConfig.maxDelay);
    }

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = this.retryConfig.baseDelay * 2 ** attempt;
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelay);

    // Full jitter: random value between 0 and calculated delay
    // This spreads out retry attempts to avoid thundering herd
    return Math.random() * cappedDelay;
  }

  /**
   * Wait before a retry. Rejects with the signal's reason as soon as it
   * aborts, so that cancelling a request does not mean sitting out a backoff
   * of up to `maxDelay` first.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // As in requestUrl: no listener is called for a signal already aborted.
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async handleError(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => undefined);
    }

    const message = this.extractErrorMessage(body) ?? response.statusText;

    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      throw new RateLimitError(
        message,
        response.status,
        response.statusText,
        Number.isNaN(retryAfter) ? undefined : retryAfter,
        body
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(message, response.status, response.statusText, body);
    }

    throw new DeereError(message, response.status, response.statusText, body);
  }

  private extractErrorMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;

    const obj = body as Record<string, unknown>;

    // Try common error message fields
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.error_description === 'string') return obj.error_description;

    // Try nested errors array
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = obj.errors[0] as Record<string, unknown>;
      if (typeof first.message === 'string') return first.message;
    }

    return undefined;
  }
}

/**
 * Create a John Deere API client
 */
export function createClient(config: DeereClientConfig): DeereClient {
  return new DeereClient(config);
}
