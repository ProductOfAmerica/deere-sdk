/**
 * ConnectionManagementApi
 *
 * Auto-generated SDK wrapper for John Deere connection-management API.
 * @generated from connection-management.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/connection-management.js';

export class ConnectionManagementApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Get list of connections
   * @description Retrieve all of the connections for a CSC based on the client
   * in the token
   * @generated from GET /connections
   */
  async list(
    params?: { createdAfter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ConnectionsResponse']>> {
    const query = new URLSearchParams();
    if (params?.createdAfter !== undefined) query.set('createdAfter', String(params.createdAfter));
    const queryString = query.toString();
    const path = `/connections${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ConnectionsResponse']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /connections
   */
  async listAll(
    params?: { createdAfter?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['ConnectionsResponse'][]> {
    const query = new URLSearchParams();
    if (params?.createdAfter !== undefined) query.set('createdAfter', String(params.createdAfter));
    const queryString = query.toString();
    const path = `/connections${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['ConnectionsResponse']>(path, options);
  }

  /**
   * Delete connection by connection ID
   * @description Remove specific connection by ID
   * @generated from DELETE /connections/{connectionId}
   */
  async delete(connectionId: string, options?: RequestOptions): Promise<void> {
    const path = `/connections/${connectionId}`;
    await this.client.delete(path, options);
  }

  /**
   * Delete all partner connections by Org Id
   * @description Remove all connections between the calling application and the
   * org. This includes all partner connections.
   * @generated from DELETE /organizations/{orgId}/connections
   */
  async deleteConnections(orgId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/connections`;
    await this.client.delete(path, options);
  }
}

// Re-export types for convenience
export type { components as ConnectionManagementTypes } from '../types/generated/connection-management.js';
