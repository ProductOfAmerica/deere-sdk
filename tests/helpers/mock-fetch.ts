/**
 * Mock fetch utilities for testing
 */

type MockResponseInit = {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
};

/**
 * Create a mock fetch that returns a JSON response
 */
export function mockJsonResponse<T>(data: T, init?: MockResponseInit): typeof fetch {
  return async () =>
    new Response(JSON.stringify(data), {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
}

/**
 * Create a mock fetch that returns an error response
 */
export function mockErrorResponse(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): typeof fetch {
  return async () =>
    new Response(body ? JSON.stringify(body) : null, {
      status,
      statusText: getStatusText(status),
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
}

/**
 * Create a mock fetch that fails N times then succeeds
 */
export function mockFailThenSucceed<T>(
  failures: number,
  failStatus: number,
  successData: T,
  onAttempt?: (attempt: number) => void,
): { fetch: typeof fetch; getAttempts: () => number } {
  let attempts = 0;

  const mockFetch: typeof fetch = async () => {
    attempts++;
    onAttempt?.(attempts);

    if (attempts <= failures) {
      return new Response(null, {
        status: failStatus,
        statusText: getStatusText(failStatus),
      });
    }

    return new Response(JSON.stringify(successData), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { fetch: mockFetch, getAttempts: () => attempts };
}

/**
 * Create a mock fetch that tracks all requests made
 */
export function mockWithSpy<T>(
  data: T,
  init?: MockResponseInit,
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const mockFetch: typeof fetch = async (input, reqInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input.toString(),
      init: reqInit ?? {},
    });

    return new Response(JSON.stringify(data), {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  };

  return { fetch: mockFetch, calls };
}

/**
 * Create a mock fetch that throws a network error
 */
export function mockNetworkError(message = 'fetch failed'): typeof fetch {
  return async () => {
    throw new TypeError(message);
  };
}

/**
 * Create a mock fetch that times out (never resolves until aborted)
 */
export function mockTimeout(): typeof fetch {
  return async (_url, init) => {
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
}

/**
 * Create a mock fetch for paginated responses
 */
export function mockPaginatedResponse<T>(
  pages: T[][],
  baseUrl = 'https://api.example.com',
): typeof fetch {
  let pageIndex = 0;

  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const currentPage = pages[pageIndex];
    const hasNextPage = pageIndex < pages.length - 1;

    const response = {
      values: currentPage,
      links: hasNextPage
        ? [{ rel: 'nextPage', uri: `${baseUrl}/page/${pageIndex + 2}` }]
        : [],
    };

    pageIndex++;

    return new Response(JSON.stringify(response), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return statusTexts[status] ?? 'Unknown';
}
