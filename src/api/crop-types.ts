/**
 * CropTypesApi
 *
 * Auto-generated SDK wrapper for John Deere crop-types API.
 * @generated from crop-types.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/crop-types.js';

export class CropTypesApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Retrieve all crop types
   * @description This endpoint will return list of available crop types in the
   * system.
   * @generated from GET /cropTypes
   */
  async list(
    params?: { recordFilter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['CropType']>> {
    const query = new URLSearchParams();
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/cropTypes${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['CropType']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /cropTypes
   */
  async listAll(
    params?: { recordFilter?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['CropType'][]> {
    const query = new URLSearchParams();
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/cropTypes${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['CropType']>(path, options);
  }

  /**
   * View a specific cropType
   * @description This endpoint will return details of specific cropType.
   * @generated from GET /cropTypes/{name}
   */
  async get(name: string, options?: RequestOptions): Promise<components['schemas']['CropType2']> {
    const path = `/cropTypes/${name}`;
    return this.client.get<components['schemas']['CropType2']>(path, options);
  }

  /**
   * View a specific cropType
   * @description This endpoint will return details of specific cropType.
   * @generated from GET /cropTypes/{id}
   */
  async getCroptypes(
    id: string,
    options?: RequestOptions
  ): Promise<components['schemas']['CropType3']> {
    const path = `/cropTypes/${id}`;
    return this.client.get<components['schemas']['CropType3']>(path, options);
  }

  /**
   * Retrieve all crop types for a specific organization
   * @description This endpoint will return a list of all crop types for a
   * specific organization.
   * @generated from GET /organizations/{organizationId}/cropTypes
   */
  async listCroptypes(
    organizationId: string,
    params?: { recordFilter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['CropType4']>> {
    const query = new URLSearchParams();
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/cropTypes${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['CropType4']>>(path, options);
  }
}

// Re-export types for convenience
export type { components as CropTypesTypes } from '../types/generated/crop-types.js';
