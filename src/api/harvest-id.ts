/**
 * HarvestIdApi
 *
 * Auto-generated SDK wrapper for John Deere harvest-id API.
 * @generated from harvest-id.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/harvest-id.js';

export class HarvestIdApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'harvest-id';

  constructor(private readonly client: DeereClient) {}

  /**
   * Retrieve all Cotton HID modules for a given org
   * @description This endpoint will return list of HID Cotton modules in the
   * system for the provided organization ID (filtered by user-level access).
   * @generated from GET /organizations/{orgId}/harvestIdentificationModules
   */
  async list(
    orgId: string,
    params?: { embed?: string; startDate?: string; endDate?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['HIDCottonModule']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/harvestIdentificationModules${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['HIDCottonModule']>>(
      this.spec,
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/harvestIdentificationModules
   */
  async listAll(
    orgId: string,
    params?: { embed?: string; startDate?: string; endDate?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['HIDCottonModule'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/harvestIdentificationModules${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['HIDCottonModule']>(this.spec, path, options);
  }

  /**
   * Retrieve a specific HID module by serial number
   * @description This endpoint will retrieve a specific HID module by serial
   * number.
   * @generated from GET /organizations/{orgId}/harvestIdentificationModules/{serialNumber}
   */
  async get(
    orgId: string,
    serialNumber: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['HIDCottonModule']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/harvestIdentificationModules/${serialNumber}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['HIDCottonModule']>(this.spec, path, options);
  }
}

// Re-export types for convenience
export type { components as HarvestIdTypes } from '../types/generated/harvest-id.js';
