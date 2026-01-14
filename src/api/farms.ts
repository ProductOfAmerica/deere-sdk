/**
 * FarmsApi
 *
 * Auto-generated SDK wrapper for John Deere farms API.
 * @generated from farms.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/farms.js';

export class FarmsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * View Farms in an Org
   * @description Retrieve all of the farms for an organization
   * @generated from GET /organizations/{orgId}/farms
   */
  async list(
    orgId: string,
    params?: { embed?: string; recordFilter?: 'available' | 'archived' | 'all' },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['GetFarms']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/farms${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['GetFarms']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/farms
   */
  async listAll(
    orgId: string,
    params?: { embed?: string; recordFilter?: 'available' | 'archived' | 'all' },
    options?: RequestOptions
  ): Promise<components['schemas']['GetFarms'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/farms${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['GetFarms']>(path, options);
  }

  /**
   * Create Farm
   * @description Create a farm for a given organization
   * @generated from POST /organizations/{orgId}/farms
   */
  async create(
    orgId: string,
    data: components['schemas']['PostFarm'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/farms`;
    await this.client.post(path, data, options);
  }

  /**
   * View a Farm
   * @description Get farm by organization and farmId
   * @generated from GET /organizations/{orgId}/farms/{farmId}
   */
  async get(
    orgId: string,
    farmId: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['GetFarm']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/farms/${farmId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['GetFarm']>(path, options);
  }

  /**
   * Update a Farm
   * @description Update farm by Id
   * @generated from PUT /organizations/{orgId}/farms/{farmId}
   */
  async update(
    orgId: string,
    farmId: string,
    data: components['schemas']['PostFarm'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/farms/${farmId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a Farm
   * @description Delete a farm by Id
   * @generated from DELETE /organizations/{orgId}/farms/{farmId}
   */
  async delete(orgId: string, farmId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/farms/${farmId}`;
    await this.client.delete(path, options);
  }

  /**
   * View Clients that Own a Farm
   * @description Get clients by organization and farmId
   * @generated from GET /organizations/{orgId}/farms/{farmId}/clients
   */
  async listClients(
    orgId: string,
    farmId: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Clients']>> {
    const path = `/organizations/${orgId}/farms/${farmId}/clients`;
    return this.client.get<PaginatedResponse<components['schemas']['Clients']>>(path, options);
  }

  /**
   * View a Farm's Field
   * @description View details on the field to which a specified farm belongs. The response will link to the following resources: boundaries: View the boundaries of this field. clients: View the clients associated with this field. farms: View the farms belonging to this field. owningOrganization: View the organization that owns the field. activeBoundary: View the active boundary of this field.
   * @generated from GET /organizations/{orgID}/farms/{id}/fields
   */
  async listFields(
    orgID: string,
    id: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FieldResponse2']>> {
    const path = `/organizations/${orgID}/farms/${id}/fields`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldResponse2']>>(
      path,
      options
    );
  }
}

// Re-export types for convenience
export type { components as FarmsTypes } from '../types/generated/farms.js';
