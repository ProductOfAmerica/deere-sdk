/**
 * John Deere TypeScript SDK
 *
 * Unofficial SDK for John Deere Operations Center API.
 *
 * @example
 * ```typescript
 * import { Deere } from 'deere-sdk';
 *
 * const deere = new Deere({
 *   accessToken: 'your-token',
 *   environment: 'sandbox', // or 'production'
 * });
 *
 * // List all organizations
 * const orgs = await deere.organizations.listAll();
 * console.log(orgs);
 *
 * // Get fields for an organization
 * const fields = await deere.fields.listAll(orgs[0].id);
 *
 * // Get field boundary
 * const boundary = await deere.fields.getActiveBoundary(orgs[0].id, fields[0].id);
 *
 * // Get harvest data
 * const harvests = await deere.fieldOperations.getHarvestData(orgs[0].id, fields[0].id);
 * ```
 *
 * @packageDocumentation
 */

// API modules
export * from './api/index.js';
export type {
  DeereClientConfig,
  Environment,
  Link,
  PaginatedResponse,
  RequestOptions,
} from './client.js';
// Low-level client
export {
  AuthError,
  createClient,
  DeereClient,
  DeereError,
  RateLimitError,
} from './client.js';
// Main SDK class
export { createDeere, Deere } from './deere.js';

// OpenAPI Types (for advanced usage)
export * as Types from './types/index.js';
