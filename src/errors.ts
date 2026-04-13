/**
 * Error hierarchy for deere-sdk.
 *
 * Lives in a separate file from client.ts to avoid a circular import with
 * environment-resolver.ts (which needs DeereError to build its own
 * NoServerConfigError and UnsupportedEnvironmentError).
 *
 * client.ts re-exports everything here for backward compatibility with any
 * consumer that imports these classes from 'deere-sdk' main entry.
 */

export class DeereError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown
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
    body?: unknown
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

export class HateoasError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'HateoasError';
  }
}

/**
 * Sentinel status for client-side errors that were never sent over HTTP.
 * Distinct from HTTP 0 (which requestUrl uses for timeouts), so the retry
 * logic in requestUrl that checks `error.status === 0 && error.statusText ===
 * 'Timeout'` never fires for config/resolver errors.
 */
export const CLIENT_ERROR_STATUS = -1;
