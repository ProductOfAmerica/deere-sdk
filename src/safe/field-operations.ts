/**
 * SafeFieldOperationsApi — hand-written facade over the generated
 * FieldOperationsApi.
 *
 * The raw FieldOperationsApi has THREE methods that accept the same
 * `embed: 'measurementTypes'` query param with the same silent-zero failure
 * mode:
 *
 *   - list(orgId, fieldId, opts)      — single-page paginated
 *   - listAll(orgId, fieldId, opts)   — auto-paginated
 *   - get(operationId, opts)          — single operation by ID
 *
 * John Deere's API silently omits the measurementTypes array on every
 * returned FieldOperation / FieldOperationId unless the request passes
 * `?embed=measurementTypes`, and JD's OpenAPI spec never encodes that
 * invariant. Three separate times in FieldMCP, developers called listAll
 * without the embed param and shipped placeholder zeros to production because
 * the downstream normalizer couldn't distinguish "missing data" from "real
 * zero."
 *
 * v2.1.0 wrapped listAll only. v2.1.1 completes the family — all three raw
 * methods get `*WithMeasurements` variants that force the embed, narrow the
 * return type to guarantee measurementTypes is present, and runtime-verify
 * the guarantee so JD wire drift fails loudly instead of silently.
 *
 * See scripts/embed-contracts.yaml for the contract registry that makes the
 * narrowed types (measurementTypes non-optional) honest at the type level.
 */

import type { FieldOperationsApi } from '../api/field-operations-api.js';
import type { PaginatedResponse } from '../client.js';
import { DeereError } from '../errors.js';
import type { components } from '../types/generated/field-operations-api.js';

type RawFieldOperation = components['schemas']['FieldOperation'];
type RawFieldOperationId = components['schemas']['FieldOperationId'];
type FieldOperationMeasurement = components['schemas']['FieldOperationMeasurement'];

/**
 * A list-shape FieldOperation guaranteed to carry its measurementTypes array.
 *
 * Returned by `listWithMeasurements` and `listAllWithMeasurements`. Raw
 * `FieldOperation` marks `measurementTypes` optional because JD's API only
 * populates it when `?embed=measurementTypes` is passed; this narrowed type
 * is honest because the safe wrapper forces the embed AND verifies every
 * returned operation actually carries the array (throwing `DeereError` on
 * contract violation).
 *
 * An empty `measurementTypes: []` is valid (operation exists but has no
 * recorded measurements yet). `undefined` is a contract violation and throws.
 */
export type FieldOperationWithMeasurements = RawFieldOperation & {
  measurementTypes: FieldOperationMeasurement[];
};

/**
 * A get-by-id FieldOperationId guaranteed to carry its measurementTypes array.
 *
 * Returned by `getWithMeasurements`. JD treats the list-shape and get-shape
 * as different schemas (`FieldOperation` vs `FieldOperationId`) even though
 * the embedded `measurementTypes` array is structurally identical on both.
 * v2.1.1 added a spec patch for the `FieldOperationId` schema mirroring
 * v2.1.0's patch on `FieldOperation`; this narrowed type reflects that.
 */
export type FieldOperationIdWithMeasurements = RawFieldOperationId & {
  measurementTypes: FieldOperationMeasurement[];
};

type RawListParams = NonNullable<Parameters<FieldOperationsApi['list']>[2]>;
type SafeListParams = Omit<RawListParams, 'embed'>;

type RawListAllParams = NonNullable<Parameters<FieldOperationsApi['listAll']>[2]>;
type SafeListAllParams = Omit<RawListAllParams, 'embed'>;

type RawGetParams = NonNullable<Parameters<FieldOperationsApi['get']>[1]>;
type SafeGetParams = Omit<RawGetParams, 'embed'>;

/** Shared contract-violation thrower. Runtime-validates that every returned
 *  operation carries the measurementTypes array the embed param is supposed
 *  to populate, and throws DeereError naming the offending op on drift. */
function assertMeasurementsPresent<
  T extends { id?: unknown; fieldOperationType?: unknown; measurementTypes?: unknown },
>(op: T, methodName: string): asserts op is T & { measurementTypes: FieldOperationMeasurement[] } {
  if (op.measurementTypes === undefined) {
    throw new DeereError(
      `deere-sdk contract violation in ${methodName}: field operation ${String(op.id ?? '(unknown id)')} ` +
        `(type=${String(op.fieldOperationType ?? 'unknown')}) has no measurementTypes array ` +
        `despite embed=measurementTypes being passed. JD's wire format may have drifted from the ` +
        `documented contract. Capture a fresh fixture and update scripts/embed-contracts.yaml if needed.`,
      0,
      'CONTRACT_VIOLATION'
    );
  }
}

export class SafeFieldOperationsApi {
  constructor(private readonly raw: FieldOperationsApi) {}

  /**
   * List all field operations on a field with measurement data embedded.
   * Auto-paginates through every page and returns a flat array. Prefer this
   * over `list*` when you want every operation.
   *
   * Forces `embed=measurementTypes` on the outgoing request, so yield, area,
   * moisture, application rate, and seeding population are guaranteed present
   * where JD has recorded them. Empty `measurementTypes: []` is a valid
   * response (JD has no measurements for that operation yet). `undefined`
   * `measurementTypes` on any returned operation is treated as a contract
   * violation and throws `DeereError` naming the offending operation id.
   *
   * @throws {DeereError} if any returned operation lacks `measurementTypes`.
   */
  async listAllWithMeasurements(
    orgId: string,
    fieldId: string,
    params?: SafeListAllParams
  ): Promise<FieldOperationWithMeasurements[]> {
    const result = await this.raw.listAll(orgId, fieldId, {
      ...params,
      embed: 'measurementTypes',
    });
    for (const op of result) {
      assertMeasurementsPresent(op, 'listAllWithMeasurements');
    }
    return result as FieldOperationWithMeasurements[];
  }

  /**
   * List ONE page of field operations on a field with measurement data
   * embedded. Returns the raw `PaginatedResponse<>` envelope so callers can
   * walk `.links` and fetch subsequent pages manually. Prefer
   * `listAllWithMeasurements` unless you explicitly need page-at-a-time
   * control.
   *
   * Forces `embed=measurementTypes` on the outgoing request and runtime-
   * verifies every operation on the returned page carries the array.
   *
   * @throws {DeereError} if any returned operation lacks `measurementTypes`.
   */
  async listWithMeasurements(
    orgId: string,
    fieldId: string,
    params?: SafeListParams
  ): Promise<PaginatedResponse<FieldOperationWithMeasurements>> {
    const result = await this.raw.list(orgId, fieldId, {
      ...params,
      embed: 'measurementTypes',
    });
    for (const op of result.values ?? []) {
      assertMeasurementsPresent(op, 'listWithMeasurements');
    }
    return result as PaginatedResponse<FieldOperationWithMeasurements>;
  }

  /**
   * Get a single field operation by ID with measurement data embedded.
   *
   * Forces `embed=measurementTypes` and runtime-verifies the returned
   * operation carries the array. Narrowed return type is
   * `FieldOperationIdWithMeasurements` — JD treats the list-shape and
   * get-shape as separate schemas, so the single-op type is named differently
   * from `FieldOperationWithMeasurements`.
   *
   * @throws {DeereError} if the returned operation lacks `measurementTypes`.
   */
  async getWithMeasurements(
    operationId: string,
    params?: SafeGetParams
  ): Promise<FieldOperationIdWithMeasurements> {
    const result = await this.raw.get(operationId, {
      ...params,
      embed: 'measurementTypes',
    });
    assertMeasurementsPresent(result, 'getWithMeasurements');
    return result as FieldOperationIdWithMeasurements;
  }
}
