/**
 * SafeEquipmentApi — hand-written facade over the generated EquipmentApi.
 *
 * John Deere's equipment API has six methods that accept an optional `embed`
 * query parameter. JD documents narrow enum values for each (`devices`,
 * `equipment`, `icon`, `pairingDetails`, `offsets`, `capabilities`, `make`,
 * `type`, `isgType`, `equipmentModels`, `recordMetadata`) and the description
 * on the parameter explicitly notes that `pairingDetails` "is only supported
 * along with 'devices' or 'equipment' embeds" — strong signal that JD's API
 * silently strips response fields when the embed is missing, same pattern as
 * `fieldOperations.measurementTypes`.
 *
 * Unlike field-operations, we don't yet have wire traces confirming exactly
 * which response fields each embed value populates, so the narrowed return
 * types DON'T add spec patches. Instead, this facade offers forcing functions
 * at the TYPE level: every `*WithEmbed` method requires the caller to pass a
 * non-undefined `embed` value. Consumers can no longer call the safe variant
 * and forget the embed. Once field-mcp probes capture the real response
 * shapes, a follow-up can tighten the return types via spec patches (same
 * mechanism as v2.1.0 used for measurementTypes).
 *
 * See scripts/embed-contracts.yaml for the contract registry that would house
 * those future patches.
 */

import type { EquipmentApi } from '../api/equipment.js';
import type { PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/equipment.js';

// Helper types: take the raw method's params, drop `embed`, then re-add it
// as a REQUIRED field. The resulting safe method refuses to compile if the
// caller forgets `embed`.
type RequireEmbed<P> = P extends { embed?: infer E }
  ? Omit<P, 'embed'> & { embed: NonNullable<E> }
  : never;

type RawGetParams = NonNullable<Parameters<EquipmentApi['get']>[0]>;
type SafeGetParams = RequireEmbed<RawGetParams>;

type RawGetEquipmentParams = NonNullable<Parameters<EquipmentApi['getEquipment']>[1]>;
type SafeGetEquipmentParams = RequireEmbed<RawGetEquipmentParams>;

type RawListEquipmentmodelsParams = NonNullable<Parameters<EquipmentApi['listEquipmentmodels']>[0]>;
type SafeListEquipmentmodelsParams = RequireEmbed<RawListEquipmentmodelsParams>;

type RawListEquipmentisgtypesParams = NonNullable<
  Parameters<EquipmentApi['listEquipmentisgtypes']>[0]
>;
type SafeListEquipmentisgtypesParams = RequireEmbed<RawListEquipmentisgtypesParams>;

type RawGetEquipmentisgtypesParams = NonNullable<
  Parameters<EquipmentApi['getEquipmentisgtypes']>[1]
>;
type SafeGetEquipmentisgtypesParams = RequireEmbed<RawGetEquipmentisgtypesParams>;

type RawGetEquipmentisgtypes2Params = NonNullable<
  Parameters<EquipmentApi['getEquipmentisgtypes2']>[2]
>;
type SafeGetEquipmentisgtypes2Params = RequireEmbed<RawGetEquipmentisgtypes2Params>;

export class SafeEquipmentApi {
  constructor(private readonly raw: EquipmentApi) {}

  /**
   * Get paginated equipment list, with a required `embed` parameter.
   * Wraps `deere.equipment.get`. Forces the caller to pick an embed value
   * (`devices`, `equipment`, `icon`, or `pairingDetails`) that controls
   * which optional response fields JD populates. See JD's spec note:
   * "embed 'pairingDetails' is only supported along with 'devices' or
   * 'equipment' embeds."
   *
   * Return type is the raw `PaginatedResponse<equipmentForList>` — fields
   * added by the embed remain optional on the type because we don't yet
   * have wire traces to confirm their shape. Once field-mcp probes them, a
   * follow-up can tighten via spec patches.
   */
  async getWithEmbed(
    params: SafeGetParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipmentForList']>> {
    return this.raw.get(params, options);
  }

  /**
   * Get a single equipment by ID, with a required `embed` parameter.
   * Wraps `deere.equipment.getEquipment`. Embed values: `devices`,
   * `equipment`, `pairingDetails`, `icon`, `offsets`, `capabilities`.
   */
  async getEquipmentWithEmbed(
    id: string,
    params: SafeGetEquipmentParams,
    options?: RequestOptions
  ): Promise<components['schemas']['equipment']> {
    return this.raw.getEquipment(id, params, options);
  }

  /**
   * List equipment models with a required `embed` parameter. Wraps
   * `deere.equipment.listEquipmentmodels`. Embed values: `make`, `type`,
   * `isgType`.
   */
  async listEquipmentmodelsWithEmbed(
    params: SafeListEquipmentmodelsParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-model']>> {
    return this.raw.listEquipmentmodels(params, options);
  }

  /**
   * List equipment ISG types with a required `embed` parameter. Wraps
   * `deere.equipment.listEquipmentisgtypes`. Embed values: `equipmentModels`,
   * `recordMetadata`.
   */
  async listEquipmentisgtypesWithEmbed(
    params: SafeListEquipmentisgtypesParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-isg-type']>> {
    return this.raw.listEquipmentisgtypes(params, options);
  }

  /**
   * Get equipment ISG types by make ID, with a required `embed` parameter.
   * Wraps `deere.equipment.getEquipmentisgtypes`.
   */
  async getEquipmentisgtypesWithEmbed(
    equipmentMakeId: string,
    params: SafeGetEquipmentisgtypesParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-isg-type']>> {
    return this.raw.getEquipmentisgtypes(equipmentMakeId, params, options);
  }

  /**
   * Get a single equipment ISG type by make ID and ISG type ID, with a
   * required `embed` parameter. Wraps `deere.equipment.getEquipmentisgtypes2`.
   */
  async getEquipmentisgtypes2WithEmbed(
    equipmentMakeId: string,
    equipmentISGTypeId: string,
    params: SafeGetEquipmentisgtypes2Params,
    options?: RequestOptions
  ): Promise<components['schemas']['equipment-isg-type']> {
    return this.raw.getEquipmentisgtypes2(equipmentMakeId, equipmentISGTypeId, params, options);
  }
}
