/**
 * Runtime URL resolver for spec-aware requests.
 *
 * Pure, deterministic, and side-effect-free. Every DeereClient request goes
 * through `resolveRequestUrl` to turn a (spec, path, environment) tuple into
 * a full URL — or throw a clear, actionable error before any HTTP call.
 *
 * Design note: no heuristics, no silent fallbacks. If the spec's static map
 * doesn't cover the current environment, we throw. Sandbox vs prod is a
 * trust boundary — falling back silently could delete customer data.
 */

import { API_SERVERS, type Environment, type SpecName } from './api-servers.generated.js';
import { CLIENT_ERROR_STATUS, DeereError } from './errors.js';

/**
 * Thrown when a spec has no server configuration (missing/malformed
 * servers block, or generator classified it as 'unavailable').
 */
export class NoServerConfigError extends DeereError {
  constructor(specName: string, reason?: string) {
    super(
      `Spec '${specName}' has no server configuration.${
        reason
          ? ` ${reason}`
          : " Its OpenAPI file is missing a 'servers' block or has a malformed URL."
      }`,
      CLIENT_ERROR_STATUS,
      'NoServerConfig'
    );
    this.name = 'NoServerConfigError';
  }
}

/**
 * Thrown when a spec is available but does not support the requested
 * environment. The error message lists supported envs + concrete alternatives.
 */
export class UnsupportedEnvironmentError extends DeereError {
  constructor(specName: string, environment: string, supported: readonly string[]) {
    const supportedList = supported.length > 0 ? supported.join(', ') : '(none)';
    super(
      `The '${specName}' API does not support environment '${environment}'.\n\n` +
        `Supported environments for this spec: ${supportedList}.\n\n` +
        `This usually means the underlying JD backend has a different tier ` +
        `structure than the platform APIs (the ISG proxy uses qual/cert/prod ` +
        `tiers, with no sandbox or dev tier). For testing, try environment ` +
        `'apiqa.tal' (qual tier). For production, use 'api' (prod tier).`,
      CLIENT_ERROR_STATUS,
      'UnsupportedEnvironment'
    );
    this.name = 'UnsupportedEnvironmentError';
  }
}

/**
 * Resolves a request URL for the given spec and environment.
 *
 * @param specName  Name of the OpenAPI spec (e.g. 'equipment', 'organizations').
 * @param path      Relative path starting with '/' or '?' (generated code always emits this).
 * @param environment  Environment from the DeereClient config.
 * @returns The full URL ready for `fetch`.
 * @throws NoServerConfigError if the spec isn't in API_SERVERS or is unavailable.
 * @throws UnsupportedEnvironmentError if the spec is static and the env isn't in its map.
 * @throws Error if the path doesn't start with '/' or '?' (developer error guard).
 */
export function resolveRequestUrl(
  specName: SpecName | string,
  path: string,
  environment: Environment
): string {
  // Defensive invariant: generated code always emits paths with a leading '/'.
  // This guard catches manual callers passing `client.get('spec', 'relative')`
  // by mistake, turning a silent 404 on `host+relative` into a clear error.
  if (path && !path.startsWith('/') && !path.startsWith('?')) {
    throw new Error(
      `Invalid path '${path}': must start with '/' (e.g., '/organizations') ` +
        `or '?' for query-only paths.`
    );
  }

  const config = API_SERVERS[specName as SpecName];
  if (!config) {
    throw new NoServerConfigError(specName);
  }

  if (config.kind === 'unavailable') {
    throw new NoServerConfigError(specName, config.reason);
  }

  if (config.kind === 'templated') {
    const baseUrl = config.urlTemplate.replace('{environment}', environment);
    return `${baseUrl}${path}`;
  }

  // kind === 'static' — partial map, throw on unsupported env
  const baseUrl = config.urlByEnvironment[environment];
  if (!baseUrl) {
    throw new UnsupportedEnvironmentError(
      specName,
      environment,
      Object.keys(config.urlByEnvironment)
    );
  }
  return `${baseUrl}${path}`;
}
