/**
 * MapLayersApi
 *
 * Auto-generated SDK wrapper for John Deere map-layers API.
 * @generated from map-layers.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/map-layers.js';

export class MapLayersApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Map Layer Summaries
   * @description This resource will list all Map Layer Summaries for a specified field.<br/>
   * @generated from GET /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async list(orgId: string, id: string, params?: { includePartialSummaries?: boolean; embed?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.includePartialSummaries !== undefined) query.set('includePartialSummaries', String(params.includePartialSummaries));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async listAll(orgId: string, id: string, params?: { includePartialSummaries?: boolean; embed?: string }, options?: RequestOptions): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.includePartialSummaries !== undefined) query.set('includePartialSummaries', String(params.includePartialSummaries));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(path, options);
  }

  /**
   * Create a map layer summary
   * @description Creates a new Map Layer Summary resource.
   * @generated from POST /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async create(orgId: string, id: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries`;
    await this.client.post(path, data, options);
  }

  /**
   * View a Map Layer Summary
   * @description Returns a specific Map Layer Summary resource.
   * @generated from GET /mapLayerSummaries/{id}
   */
  async get(id: string, options?: RequestOptions): Promise<components['schemas']['PostContributedMapLayerSummary']> {
    const path = `/mapLayerSummaries/${id}`;
    return this.client.get<components['schemas']['PostContributedMapLayerSummary']>(path, options);
  }

  /**
   * Delete a Map Layer Summary
   * @description Deletes a Map Layer Summary and its underlying Map Layer and File Resource resources.
   * @generated from DELETE /mapLayerSummaries/{id}
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    const path = `/mapLayerSummaries/${id}`;
    await this.client.delete(path, options);
  }
}

// Re-export types for convenience
export type { components as MapLayersTypes } from '../types/generated/map-layers.js';
