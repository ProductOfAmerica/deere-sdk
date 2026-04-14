/**
 * SafeFieldOperationsApi — hand-written facade over the generated
 * FieldOperationsApi.
 *
 * The raw FieldOperationsApi.listAll() takes an optional embed param. John
 * Deere's API silently omits the measurementTypes array on returned
 * FieldOperation objects unless the request passes ?embed=measurementTypes,
 * and JD's OpenAPI spec never encodes that invariant. Three separate times in
 * FieldMCP, developers called listAll without the embed param and shipped
 * placeholder zeros to production because the downstream normalizer couldn't
 * distinguish "missing data" from "real zero." The safe wrapper makes the
 * forcing function syntactic: you can't call listAllWithMeasurements without
 * the embed param, because the wrapper adds it for you.
 *
 * See scripts/embed-contracts.yaml for the contract registry that makes the
 * narrowed type (measurementTypes non-optional) honest at the type level.
 */

import type { FieldOperationsApi } from '../api/field-operations-api.js';
import { DeereError } from '../errors.js';
import type { components } from '../types/generated/field-operations-api.js';

type RawFieldOperation = components['schemas']['FieldOperation'];
type FieldOperationMeasurement = components['schemas']['FieldOperationMeasurement'];

/**
 * A FieldOperation guaranteed to carry its measurementTypes array.
 *
 * The raw `FieldOperation` type marks `measurementTypes` as optional because
 * JD's API populates it only when `?embed=measurementTypes` is passed.
 * `SafeFieldOperationsApi.listAllWithMeasurements()` forces the embed param
 * AND verifies every returned operation actually carries the array (throwing
 * `DeereError` on contract violation), so the narrowed type is honest, not
 * a cast over a possible `undefined`.
 *
 * An empty `measurementTypes: []` is valid (operation exists but has no
 * recorded measurements yet). `undefined` is a contract violation and throws.
 */
export type FieldOperationWithMeasurements = RawFieldOperation & {
  measurementTypes: FieldOperationMeasurement[];
};

type RawListAllParams = NonNullable<Parameters<FieldOperationsApi['listAll']>[2]>;
type SafeListAllParams = Omit<RawListAllParams, 'embed'>;

export class SafeFieldOperationsApi {
  constructor(private readonly raw: FieldOperationsApi) {}

  /**
   * List all field operations on a field with measurement data embedded.
   *
   * Forces `embed=measurementTypes` on the outgoing request, so yield, area,
   * moisture, application rate, and seeding population are guaranteed present
   * where JD has recorded them. Empty `measurementTypes: []` is a valid
   * response (JD has no measurements for that operation yet). `undefined`
   * `measurementTypes` on any returned operation is treated as a contract
   * violation and throws `DeereError` naming the offending operation id.
   *
   * Prefer this over `deere.fieldOperations.listAll` when your code reads
   * yield, rate, or any other field under `measurementTypes`. The raw method
   * silently returns FieldOperation objects with `measurementTypes` omitted
   * unless the caller remembers to pass the embed param, and has caused
   * production bugs in FieldMCP three separate times.
   *
   * @param orgId  The John Deere organization id.
   * @param fieldId  The field id within that organization.
   * @param params  Optional filter params (cropSeason, fieldOperationType,
   *                date range, workPlanIds). Any `embed` value in params is
   *                ignored — the wrapper always overrides with
   *                `embed: 'measurementTypes'`.
   * @throws {DeereError} If JD returns any operation without a
   *                     `measurementTypes` array despite the embed param
   *                     being passed. This indicates JD's wire format has
   *                     drifted from the documented contract.
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

    // Runtime contract verification. The narrowed return type asserts
    // `measurementTypes` is non-optional. The registry patch + fixture contract
    // tests anchor that assertion to JD's documented behavior, but wire drift
    // happens. If an operation comes back without the field despite embed
    // being passed, surface it loudly — matches the SDK's "no silent
    // fallbacks" posture in CLAUDE.md.
    for (const op of result) {
      if (op.measurementTypes === undefined) {
        throw new DeereError(
          `deere-sdk contract violation: field operation ${op.id ?? '(unknown id)'} ` +
            `(type=${op.fieldOperationType ?? 'unknown'}) has no measurementTypes array ` +
            `despite embed=measurementTypes being passed. JD's wire format ` +
            `may have drifted from the documented contract. Capture a fresh ` +
            `fixture and update scripts/embed-contracts.yaml if needed.`,
          0,
          'CONTRACT_VIOLATION'
        );
      }
    }

    return result as FieldOperationWithMeasurements[];
  }
}
