/**
 * John Deere API Client
 *
 * Unofficial TypeScript SDK for John Deere Operations Center API.
 * Provides typed access to all John Deere agricultural APIs.
 */

export type Environment = 'production' | 'sandbox' | 'partner' | 'cert' | 'qa';

export interface DeereClientConfig {
  /** OAuth access token */
  accessToken: string;
  /** API environment. Defaults to 'sandbox' */
  environment?: Environment;
  /** Custom base URL (overrides environment) */
  baseUrl?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
  /** Timeout in milliseconds. Defaults to 30000 */
  timeout?: number;
}

export interface RequestOptions {
  /** Additional headers for this request */
  headers?: Record<string, string>;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
  /** Override timeout for this request */
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

export class DeereError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'DeereError';
  }
}

export class RateLimitError extends DeereError {
  constructor(
    message: string,
    status: number,
    statusText: string,
    public readonly retryAfter?: number,
    body?: unknown,
  ) {
    super(message, status, statusText, body);
    this.name = 'RateLimitError';
  }
}

export class AuthError extends DeereError {
  constructor(message: string, status: number, statusText: string, body?: unknown) {
    super(message, status, statusText, body);
    this.name = 'AuthError';
  }
}

const ENVIRONMENT_URLS: Record<Environment, string> = {
  production: 'https://api.deere.com/platform',
  sandbox: 'https://sandboxapi.deere.com/platform',
  partner: 'https://partnerapi.deere.com/platform',
  cert: 'https://apicert.deere.com/platform',
  qa: 'https://apiqa.tal.deere.com/platform',
};

const DEERE_ACCEPT_HEADER = 'application/vnd.deere.axiom.v3+json';

/**
 * John Deere API Client
 *
 * @example
 * ```typescript
 * const client = new DeereClient({
 *   accessToken: 'your-token',
 *   environment: 'sandbox',
 * });
 *
 * const orgs = await client.get('/organizations');
 * ```
 */
export class DeereClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;

  constructor(config: DeereClientConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl ?? ENVIRONMENT_URLS[config.environment ?? 'sandbox'];
    this.fetchFn = config.fetch ?? fetch;
    this.timeout = config.timeout ?? 30000;
    this.defaultHeaders = {
      Accept: DEERE_ACCEPT_HEADER,
      'Content-Type': DEERE_ACCEPT_HEADER,
      ...config.defaultHeaders,
    };
  }

  /**
   * Make a GET request to the John Deere API
   */
  async get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * Make a POST request to the John Deere API
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  /**
   * Make a PUT request to the John Deere API
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  /**
   * Make a DELETE request to the John Deere API
   */
  async delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /**
   * Make a PATCH request to the John Deere API
   */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  /**
   * Follow a HAL link from a response
   */
  async followLink<T = unknown>(link: Link | string, options?: RequestOptions): Promise<T> {
    const uri = typeof link === 'string' ? link : link.uri;
    // If it's a full URL, use it directly; otherwise treat as path
    const url = uri.startsWith('http') ? uri : `${this.baseUrl}${uri}`;
    return this.requestUrl<T>('GET', url, undefined, options);
  }

  /**
   * Paginate through all results following nextPage links
   */
  async *paginate<T>(
    path: string,
    options?: RequestOptions,
  ): AsyncGenerator<T[], void, unknown> {
    let url: string | undefined = `${this.baseUrl}${path}`;

    while (url) {
      const response: PaginatedResponse<T> = await this.requestUrl<PaginatedResponse<T>>('GET', url, undefined, options);

      if (response.values && response.values.length > 0) {
        yield response.values;
      }

      // Find nextPage link
      const nextPageLink: Link | undefined = response.links?.find((l: Link) => l.rel === 'nextPage');
      url = nextPageLink?.uri;
    }
  }

  /**
   * Get all items from a paginated endpoint
   */
  async getAll<T>(path: string, options?: RequestOptions): Promise<T[]> {
    const items: T[] = [];
    for await (const page of this.paginate<T>(path, options)) {
      items.push(...page);
    }
    return items;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    return this.requestUrl<T>(method, url, body, options);
  }

  private async requestUrl<T>(
    method: string,
    url: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const timeout = options?.timeout ?? this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers: {
          ...this.defaultHeaders,
          Authorization: `Bearer ${this.accessToken}`,
          ...options?.headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: options?.signal ?? controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleError(response);
      }

      // Handle empty responses
      const contentLength = response.headers.get('content-length');
      if (contentLength === '0' || response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json') || contentType?.includes('application/vnd.deere')) {
        return (await response.json()) as T;
      }

      return (await response.text()) as unknown as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof DeereError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new DeereError('Request timeout', 0, 'Timeout');
      }

      throw error;
    }
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
      const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10);
      throw new RateLimitError(
        message,
        response.status,
        response.statusText,
        isNaN(retryAfter) ? undefined : retryAfter,
        body,
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
