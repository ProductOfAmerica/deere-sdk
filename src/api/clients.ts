/**
 * ClientsApi
 *
 * Auto-generated SDK wrapper for John Deere clients API.
 * @generated from clients.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/clients.js';

export class ClientsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Clients in an Org
   * @description Retrieve all of the clients for an organization
   * @generated from GET /organizations/{orgId}/clients
   */
  async list(orgId: string, params?: { embed?: string; recordFilter?: string }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['Clients']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/clients${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['Clients']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/clients
   */
  async listAll(orgId: string, params?: { embed?: string; recordFilter?: string }, options?: RequestOptions): Promise<components['schemas']['Clients'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/clients${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['Clients']>(path, options);
  }

  /**
   * Create a Client
   * @description This API is used to create a new client resource within the target organization. In order to do this, the authenticated user must have <b>Locations Level 3</b> permission within the target organization. <br/><br/>Note: All clients are created with an "active" status.
   * @generated from POST /organizations/{orgId}/clients
   */
  async create(orgId: string, data: components['schemas']['ClientPost'], options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/clients`;
    await this.client.post(path, data, options);
  }

  /**
   * View a Client
   * @description View a clients details. For each client, the response will link to the following resources:<br/> <ul><li> <b>fields:</b> View the field the client belongs to.</li> <li><b>farms:</b> View the farm belonging to the client.</li> <li><b>owningOrganization:</b> View the org that owns the client.</li></ul>
   * @generated from GET /organizations/{orgId}/clients/{clientId}
   */
  async get(orgId: string, clientId: string, params?: { embed?: string }, options?: RequestOptions): Promise<components['schemas']['Client']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/clients/${clientId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['Client']>(path, options);
  }

  /**
   * Update a Client
   * @description This API is used to update an existing client resource within the target organization. In order to do this, the authenticated user must have <b>Locations Level 3</b> permission within the target organization.
   * @generated from PUT /organizations/{orgId}/clients/{clientId}
   */
  async update(orgId: string, clientId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/clients/${clientId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a Client
   * @description This API is used to delete a client resource within the target organization. In order to do this, the authenticated user must have <b>Locations Level 3</b> permission within the target organization.
   * @generated from DELETE /organizations/{orgId}/clients/{clientId}
   */
  async delete(orgId: string, clientId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/clients/${clientId}`;
    await this.client.delete(path, options);
  }

  /**
   * View a Client's Farms
   * @description View a list of farms belonging to a specified client. For each farm, the response will link to the following resources: <ul> <li><b>fields:</b> View the fields in this farm</li> <li><b>farms:</b> View the clients that own this farm.</li> <li><b>owningOrganization:</b> View the Organization that owns the farm.</li> </ul>
   * @generated from GET /organizations/{orgId}/clients/{id}/farms
   */
  async listFarms(orgId: string, id: string, params?: { name?: string }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['FarmResponse']>> {
    const query = new URLSearchParams();
    if (params?.name !== undefined) query.set('name', String(params.name));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/clients/${id}/farms${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FarmResponse']>>(path, options);
  }

  /**
   * View a Client's Field
   * @description View the field to which a specific client belongs. For the client, the response links to the following resources: <ul> <li><b>boundaries:</b> View the boundaries that belong to this field.</li> <li><b>clients:</b> View the client that belongs to this field.</li> <li><b>farms:</b> View the farms within this field.</li> <li><b>owningOrganization:</b> View the organization that owns the field.</li> </ul>
   * @generated from GET /organizations/{orgID}/clients/{id}/fields
   */
  async listFields(orgID: string, id: string, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['FieldResponse']>> {
    const path = `/organizations/${orgID}/clients/${id}/fields`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldResponse']>>(path, options);
  }
}

// Re-export types for convenience
export type { components as ClientsTypes } from '../types/generated/clients.js';
