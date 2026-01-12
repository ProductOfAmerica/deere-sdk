/**
 * PartnershipsApi
 *
 * Auto-generated SDK wrapper for John Deere partnerships API.
 * @generated from partnerships.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/partnerships.js';

export class PartnershipsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Partners
   * @description This request allows the client to view a list of partners. Each data point links to the following: <ul><li><b>fromPartnership:</b> View the organization that initiated the partnership.</li> <li><b>toPartnership:</b> View the organization that the partner request was sent to. If the partnership has not been accepted, only the invited users email address will be returned.</li> <li><b>delete:</b> Use this link to delete the partnership.</li> <li><b>permissions:</b> View the permissions assigned within the partnership.</li> <li><b>contactInvitation:</b> The ID specific to the partnership request.</li></ul>
   * @generated from GET /partnerships
   */
  async list(options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['Partnerships']>> {
    const path = `/partnerships`;
    return this.client.get<PaginatedResponse<components['schemas']['Partnerships']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /partnerships
   */
  async listAll(options?: RequestOptions): Promise<components['schemas']['Partnerships'][]> {
    const path = `/partnerships`;
    return this.client.getAll<components['schemas']['Partnerships']>(path, options);
  }

  /**
   * Request a Partnership
   * @description This will send an email request to create a partnership from an organization identified in the request. To discover an organization ID to send the request from, you must first query the <a href="/dev-docs/organizations" target="_blank">/organizations</a> endpoint to discover available organizations for a user.
   * @generated from POST /partnerships
   */
  async create(data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/partnerships`;
    await this.client.post(path, data, options);
  }

  /**
   * Get Partnership Details
   * @description This request allows the client to view partnership details. The response links to the following resources: <ul><li><b>fromPartnership:</b> View the organization that initiated the partnership.</li> <li><b>toPartnership:</b> View the organization that the partner request was sent to. If the partnership has not been accepted, only the invited users email address will be returned.</li> <li><b>delete:</b> Use this link to delete the partnership.</li> <li><b>permissions:</b> View the permissions assigned within the partnership.</li> <li><b>contactInvitation:</b> The ID specific to the partnership request.</li></ul>
   * @generated from GET /partnerships/{token}
   */
  async get(token: string, options?: RequestOptions): Promise<components['schemas']['PartnershipsId']> {
    const path = `/partnerships/${token}`;
    return this.client.get<components['schemas']['PartnershipsId']>(path, options);
  }

  /**
   * Delete a Partnership
   * @description This request lets the client delete a partnership.
   * @generated from DELETE /partnerships/{token}
   */
  async delete(token: string, options?: RequestOptions): Promise<void> {
    const path = `/partnerships/${token}`;
    await this.client.delete(path, options);
  }

  /**
   * View Permissions in a Partnership
   * @description This request allows the client to view all the permissions that one partner has assigned the other. The response will also link to the Assign Permissions resource, which will allow the client to assign permissions to a partner.
   * @generated from GET /partnerships/{token}/permissions
   */
  async listPermissions(token: string, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['Permissions']>> {
    const path = `/partnerships/${token}/permissions`;
    return this.client.get<PaginatedResponse<components['schemas']['Permissions']>>(path, options);
  }

  /**
   * Request/Assign Permissions
   * @description This request allows the client to update a partner permission or request a permission from a partner. To enable file sharing within this partnership, assign or request the relevant permission type.<sup><a href="#additional-type">2</a></sup>
   * @generated from POST /partnerships/{token}/permissions
   */
  async createPermissions(token: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/partnerships/${token}/permissions`;
    await this.client.post(path, data, options);
  }
}

// Re-export types for convenience
export type { components as PartnershipsTypes } from '../types/generated/partnerships.js';
