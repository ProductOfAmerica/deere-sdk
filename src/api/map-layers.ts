/**
 * MapLayersApi
 *
 * Auto-generated SDK wrapper for John Deere map-layers API.
 * @generated from map-layers.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/map-layers.js';

export class MapLayersApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'map-layers';

  constructor(private readonly client: DeereClient) {}

  /**
   * View/Download a File Resource
   * @description This resource allows the client to view or download a File
   * Resource. To view a File Resource's metadata, set the
   * application/vnd.deere.axiom.v3+json Accept Header. To download the File
   * Resource itself, choose a zip or octet-stream Accept Header.
   * @generated from GET /fileResources/{id}
   */
  async getFileResources(id: string, options?: RequestOptions): Promise<unknown> {
    const path = `/fileResources/${id}`;
    return this.client.get<unknown>(this.spec, path, options);
  }

  /**
   * Upload a File Resource
   * @description Uploads a binary File Resource for a given Map Layer. The
   * client must first create a File Resource ID by calling POST
   * /mapLayers/{id}/fileResources API before uploading. Check the status of the
   * upload by requesting the File Resource's targetResource Link.
   * @generated from PUT /fileResources/{id}
   */
  async updateFileResources(id: string, options?: RequestOptions): Promise<void> {
    const path = `/fileResources/${id}`;
    await this.client.put(this.spec, path, options);
  }

  /**
   * Delete a File Resource
   * @description Deletes a file resource.
   * @generated from DELETE /fileResources/{id}
   */
  async deleteFileResources(id: string, options?: RequestOptions): Promise<void> {
    const path = `/fileResources/${id}`;
    await this.client.delete(this.spec, path, options);
  }

  /**
   * View a Map Layer Summary
   * @description Returns a specific Map Layer Summary resource.
   * @generated from GET /mapLayerSummaries/{id}
   */
  async get(
    id: string,
    options?: RequestOptions
  ): Promise<components['schemas']['PostContributedMapLayerSummary']> {
    const path = `/mapLayerSummaries/${id}`;
    return this.client.get<components['schemas']['PostContributedMapLayerSummary']>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Delete a Map Layer Summary
   * @description Deletes a Map Layer Summary and its underlying Map Layer and
   * File Resource resources.
   * @generated from DELETE /mapLayerSummaries/{id}
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    const path = `/mapLayerSummaries/${id}`;
    await this.client.delete(this.spec, path, options);
  }

  /**
   * List Map Layers
   * @description This resource lists all Map Layers for a specific Map Layer
   * Summary. Note: This API does not support eTags.
   * @generated from GET /mapLayerSummaries/{id}/mapLayers
   */
  async listMapLayers(
    id: string,
    params?: { includePartialLayers?: boolean },
    options?: RequestOptions
  ): Promise<PaginatedResponse<unknown>> {
    const query = new URLSearchParams();
    if (params?.includePartialLayers !== undefined)
      query.set('includePartialLayers', String(params.includePartialLayers));
    const queryString = query.toString();
    const path = `/mapLayerSummaries/${id}/mapLayers${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<unknown>>(this.spec, path, options);
  }

  /**
   * Create a Map Layer
   * @description Creates a new Map Layer resource.
   * @generated from POST /mapLayerSummaries/{id}/mapLayers
   */
  async createMapLayers(
    id: string,
    data: components['schemas']['PostResponse_MapLayers'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/mapLayerSummaries/${id}/mapLayers`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * View a Map Layer
   * @description Returns a specific Map Layer resource.
   * @generated from GET /mapLayers/{id}
   */
  async getMapLayers(
    id: string,
    options?: RequestOptions
  ): Promise<components['schemas']['GetResponseDetails']> {
    const path = `/mapLayers/${id}`;
    return this.client.get<components['schemas']['GetResponseDetails']>(this.spec, path, options);
  }

  /**
   * Delete a Map Layer
   * @description Deletes a Map Layer and its underlying File Resource.
   * @generated from DELETE /mapLayers/{id}
   */
  async deleteMapLayers(id: string, options?: RequestOptions): Promise<void> {
    const path = `/mapLayers/${id}`;
    await this.client.delete(this.spec, path, options);
  }

  /**
   * Get a Map Layer File Resource
   * @description This resource will return the File Resource associated to the
   * specified Map Layer. Note: This API does not support eTags.
   * @generated from GET /mapLayers/{id}/fileResources
   */
  async listFileResources(
    id: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<unknown>> {
    const path = `/mapLayers/${id}/fileResources`;
    return this.client.get<PaginatedResponse<unknown>>(this.spec, path, options);
  }

  /**
   * Create a Map Layer File Resource
   * @description This resource will create a new File Resource for a Map Layer.
   * @generated from POST /mapLayers/{id}/fileResources
   */
  async createFileResources(
    id: string,
    data: components['schemas']['RequestDetails'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/mapLayers/${id}/fileResources`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Extract Map Layer Image
   * @description Returns the image file associated with the Map Layer resource.
   * @generated from GET /mapLayers/{mapLayerId}
   */
  async getMapLayersByMapLayerId(mapLayerId: string, options?: RequestOptions): Promise<unknown> {
    const path = `/mapLayers/${mapLayerId}`;
    return this.client.get<unknown>(this.spec, path, options);
  }

  /**
   * List Map Layer Summaries
   * @description This resource will list all Map Layer Summaries for a
   * specified field.
   * @generated from GET /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async list(
    orgId: string,
    id: string,
    params?: { includePartialSummaries?: boolean; embed?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<unknown>> {
    const query = new URLSearchParams();
    if (params?.includePartialSummaries !== undefined)
      query.set('includePartialSummaries', String(params.includePartialSummaries));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<unknown>>(this.spec, path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async listAll(
    orgId: string,
    id: string,
    params?: { includePartialSummaries?: boolean; embed?: string },
    options?: RequestOptions
  ): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.includePartialSummaries !== undefined)
      query.set('includePartialSummaries', String(params.includePartialSummaries));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(this.spec, path, options);
  }

  /**
   * Create a map layer summary
   * @description Creates a new Map Layer Summary resource.
   * @generated from POST /organizations/{orgId}/fields/{id}/mapLayerSummaries
   */
  async create(
    orgId: string,
    id: string,
    data: components['schemas']['PostRequest'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/fields/${id}/mapLayerSummaries`;
    await this.client.post(this.spec, path, data, options);
  }
}

// Re-export types for convenience
export type { components as MapLayersTypes } from '../types/generated/map-layers.js';
