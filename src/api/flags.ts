/**
 * FlagsApi
 *
 * Auto-generated SDK wrapper for John Deere flags API.
 * @generated from flags.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/flags.js';

export class FlagsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List a flag by org id and Flag id
   * @description This endpoint will return a flag for a given org and Flag id.
   * @generated from GET /organizations/{orgId}/flags/{flagId}
   */
  async get(orgId: string, flagId: string, params?: { embed?: string; startTime?: string; endTime?: string; categoryIDs?: string; categoryNames?: string; recordFilter?: string; flagScopes?: string; shapeTypes?: string; simple?: boolean; metadataOnly?: boolean }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined) query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.flagScopes !== undefined) query.set('flagScopes', String(params.flagScopes));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flags/${flagId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Update flag by id
   * @description This resource will update flag by Organization and Flag Id.
   * @generated from PUT /organizations/{orgId}/flags/{flagId}
   */
  async update(orgId: string, flagId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/flags/${flagId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a flag for a given org
   * @description This resource will delete a single flag based on its Id and org id
   * @generated from DELETE /organizations/{orgId}/flags/{flagId}
   */
  async delete(orgId: string, flagId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/flags/${flagId}`;
    await this.client.delete(path, options);
  }

  /**
   * View flags list
   * @description This resource will return a Flags list for Organization.
   * @generated from GET /organizations/{orgId}/flags
   */
  async getFlags(orgId: string, params?: { embed?: string; startTime?: string; endTime?: string; categoryIDs?: string; categoryNames?: string; recordFilter?: string; flagScopes?: string; shapeTypes?: string; simple?: boolean; metadataOnly?: boolean }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined) query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.flagScopes !== undefined) query.set('flagScopes', String(params.flagScopes));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Create a flag
   * @description This resource will create a flag in the given organization.
   * @generated from POST /organizations/{orgId}/flags
   */
  async create(orgId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/flags`;
    await this.client.post(path, data, options);
  }

  /**
   * List flags for the field
   * @description This resource will return a list of flag objects associated with the field.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/flags
   */
  async list(orgId: string, fieldId: string, params?: { embed?: string; startTime?: string; endTime?: string; categoryIDs?: string; categoryNames?: string; recordFilter?: string; shapeTypes?: string; simple?: boolean; metadataOnly?: boolean }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined) query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/flags
   */
  async listAll(orgId: string, fieldId: string, params?: { embed?: string; startTime?: string; endTime?: string; categoryIDs?: string; categoryNames?: string; recordFilter?: string; shapeTypes?: string; simple?: boolean; metadataOnly?: boolean }, options?: RequestOptions): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined) query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(path, options);
  }
}

// Re-export types for convenience
export type { components as FlagsTypes } from '../types/generated/flags.js';
