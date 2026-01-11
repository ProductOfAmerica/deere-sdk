/**
 * AssetsApi
 *
 * Auto-generated SDK wrapper for John Deere assets API.
 * @generated from assets.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/assets.js';

export class AssetsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Get all assets
   * @description This endpoint will retrieve all assets for an organization.
   * @generated from GET /organizations/{orgId}/assets
   */
  async list(orgId: string, params?: { embed?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/assets${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/assets
   */
  async listAll(orgId: string, params?: { embed?: string }, options?: RequestOptions): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/assets${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(path, options);
  }

  /**
   * Create a new asset
   * @description This endpoint will create a new asset.
   * @generated from POST /organizations/{orgId}/assets
   */
  async create(orgId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/assets`;
    await this.client.post(path, data, options);
  }

  /**
   * Get a specific asset
   * @description This endpoint will retrieve a specific asset by its unique ID.
   * @generated from GET /assets/{assetId}
   */
  async get(assetId: string, params?: { embed?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/assets/${assetId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Update an asset
   * @description This endpoint will update the asset by its unique id.
   * @generated from PUT /assets/{assetId}
   */
  async update(assetId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/assets/${assetId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete an Asset
   * @description This endpoint will delete an asset by its unique id.
   * @generated from DELETE /assets/{assetId}
   */
  async delete(assetId: string, options?: RequestOptions): Promise<void> {
    const path = `/assets/${assetId}`;
    await this.client.delete(path, options);
  }

  /**
   * Get all locations for an asset
   * @description This endpoint will retrieve all locations for an asset. If you provide startDate and endDate then it will retrieve all the results of the given time range.
   * @generated from GET /assets/{assetId}/locations
   */
  async listLocations(assetId: string, params?: { startDate?: string; endDate?: string; count?: string; pageKey?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.count !== undefined) query.set('count', String(params.count));
    if (params?.pageKey !== undefined) query.set('pageKey', String(params.pageKey));
    const queryString = query.toString();
    const path = `/assets/${assetId}/locations${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Create new asset location
   * @description This endpoint will create a new Asset Location.<br/><br/><b>We provide <a href="#markdown">Markdown support</a> for measurementData name.</b><br/><br/> <b>Please Note:</b> Only <i>links</i> are supported for a measurementData name.<br/><br/>Additionally, Asset Locations do not honor fractional seconds in their <mark>timestamps</mark>. So <mark>2019-01-01T12:34:56.900Z</mark> and <mark>2019-01-01T12:34:56Z</mark> are considered equivalent.
   * @generated from POST /assets/{assetId}/locations
   */
  async createLocations(assetId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/assets/${assetId}/locations`;
    await this.client.post(path, data, options);
  }

  /**
   * Get Asset Catalog List
   * @description This endpoint will retrieve the Asset Catalog List.
   * @generated from GET /assetCatalog
   */
  async getAssetcatalog(options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['AssetCatalogGet']>> {
    const path = `/assetCatalog`;
    return this.client.get<PaginatedResponse<components['schemas']['AssetCatalogGet']>>(path, options);
  }
}

// Re-export types for convenience
export type { components as AssetsTypes } from '../types/generated/assets.js';
