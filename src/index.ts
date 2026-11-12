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
 *   environment: 'sandboxapi', // or 'api' for production
 * });
 *
 * // List all organizations
 * const orgs = await deere.organizations.listAll();
 * const orgId = orgs[0]?.id;
 * if (!orgId) throw new Error('No organization available for this token');
 *
 * // Get fields for an organization
 * const fields = await deere.fields.listAll(orgId);
 * const fieldId = fields[0]?.id;
 * if (!fieldId) throw new Error('This organization has no fields');
 *
 * // Get a field's operations with their measurement data
 * const ops = await deere.safe.fieldOperations.listAllWithMeasurements(orgId, fieldId);
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
  SpecName,
} from './client.js';
// Low-level client
export {
  AuthError,
  createClient,
  DeereClient,
  DeereError,
  HateoasError,
  RateLimitError,
} from './client.js';
// Main SDK class
export { createDeere, Deere } from './deere.js';
// URL-resolver errors, thrown per call before any HTTP request
export { NoServerConfigError, UnsupportedEnvironmentError } from './environment-resolver.js';

// Safe facades that force query params the raw API leaves optional.
// See scripts/embed-contracts.yaml and src/safe/ for context.
export {
  type FieldOperationIdWithMeasurements,
  type FieldOperationWithMeasurements,
  SafeEquipmentApi,
  SafeFacades,
  SafeFieldOperationsApi,
  SafeProductsApi,
} from './safe/index.js';

// OpenAPI Types (for advanced usage)
export * as Types from './types/index.js';
