/**
 * FieldsApi
 *
 * Auto-generated SDK wrapper for John Deere fields API.
 * @generated from fields.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/fields.js';

export class FieldsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Retrieve all of the Fields for an Organization
   * @generated from GET /organizations/{orgId}/fields
   */
  async list(
    orgId: string,
    params?: {
      clientName?: string;
      farmName?: string;
      fieldName?: string;
      embed?: string[];
      recordFilter?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FieldsResponse']>> {
    const query = new URLSearchParams();
    if (params?.clientName !== undefined) query.set('clientName', String(params.clientName));
    if (params?.farmName !== undefined) query.set('farmName', String(params.farmName));
    if (params?.fieldName !== undefined) query.set('fieldName', String(params.fieldName));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldsResponse']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields
   */
  async listAll(
    orgId: string,
    params?: {
      clientName?: string;
      farmName?: string;
      fieldName?: string;
      embed?: string[];
      recordFilter?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
    },
    options?: RequestOptions
  ): Promise<components['schemas']['FieldsResponse'][]> {
    const query = new URLSearchParams();
    if (params?.clientName !== undefined) query.set('clientName', String(params.clientName));
    if (params?.farmName !== undefined) query.set('farmName', String(params.farmName));
    if (params?.fieldName !== undefined) query.set('fieldName', String(params.fieldName));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['FieldsResponse']>(path, options);
  }

  /**
   * Create field for an Organization
   * @description This API is used to create a new field resource within the target organization. In order to do this, the authenticated user must have Locations Level 3 permission within the target organization. The client and farm names in the request body may be either new or existing names.
   * @generated from POST /organizations/{orgId}/fields
   */
  async create(
    orgId: string,
    data: components['schemas']['CreateUpdateField'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/fields`;
    await this.client.post(path, data, options);
  }

  /**
   * Get field by organization and fieldId
   * @generated from GET /organizations/{orgId}/fields/{fieldId}
   */
  async get(
    orgId: string,
    fieldId: string,
    params?: { embed?: string[] },
    options?: RequestOptions
  ): Promise<components['schemas']['FieldResponse']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['FieldResponse']>(path, options);
  }

  /**
   * Update field
   * @description Update the field name, the archived status, or the associated client or farm. If the client and/or farm does not exist, it will be created.
   * @generated from PUT /organizations/{orgId}/fields/{fieldId}
   */
  async update(
    orgId: string,
    fieldId: string,
    data: components['schemas']['CreateUpdateField'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete Field by organization and fieldId
   * @generated from DELETE /organizations/{orgId}/fields/{fieldId}
   */
  async delete(orgId: string, fieldId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}`;
    await this.client.delete(path, options);
  }

  /**
   * Get Farm by organization and fieldId
   * @description This api is designed to get farms within an organization and for provided fieldId
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/farms
   */
  async listFarms(
    orgId: string,
    fieldId: string,
    params?: { embed?: string[] },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['GetFarms']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/farms${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['GetFarms']>>(path, options);
  }

  /**
   * View Clients that Own a Field
   * @description View details about the client that owns the field. The response will link to the following resources:<br/> <ul><li><b>fields:</b> View the field the client belongs to.</li> <li><b>farms:</b> View the farms belonging to the client.</li> <li><b>owningOrganization:</b> View the org that owns the field.</li></ul>
   * @generated from GET /organizations/{orgID}/fields/{id}/clients
   */
  async listClients(
    orgID: string,
    id: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FieldResponse']>> {
    const path = `/organizations/${orgID}/fields/${id}/clients`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldResponse']>>(
      path,
      options
    );
  }
}

// Re-export types for convenience
export type { components as FieldsTypes } from '../types/generated/fields.js';
