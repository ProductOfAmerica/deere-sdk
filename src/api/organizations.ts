/**
 * OrganizationsApi
 *
 * Auto-generated SDK wrapper for John Deere organizations API.
 * @generated from organizations.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/organizations.js';

export class OrganizationsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Orgs
   * @description This request will return a list of organizations.
   * @generated from GET /organizations
   */
  async list(params?: { userName?: string; orgId?: string; orgName?: string }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['Organization']>> {
    const query = new URLSearchParams();
    if (params?.userName !== undefined) query.set('userName', String(params.userName));
    if (params?.orgId !== undefined) query.set('orgId', String(params.orgId));
    if (params?.orgName !== undefined) query.set('orgName', String(params.orgName));
    const queryString = query.toString();
    const path = `/organizations${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['Organization']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations
   */
  async listAll(params?: { userName?: string; orgId?: string; orgName?: string }, options?: RequestOptions): Promise<components['schemas']['Organization'][]> {
    const query = new URLSearchParams();
    if (params?.userName !== undefined) query.set('userName', String(params.userName));
    if (params?.orgId !== undefined) query.set('orgId', String(params.orgId));
    if (params?.orgName !== undefined) query.set('orgName', String(params.orgName));
    const queryString = query.toString();
    const path = `/organizations${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['Organization']>(path, options);
  }

  /**
   * View an Organization
   * @description This request will return information about an organization, such as its name, type, and whether or not you are a member of the organization. It contains links to the following resources:
   * @generated from GET /organizations/{orgId}
   */
  async get(orgId: string, options?: RequestOptions): Promise<components['schemas']['OrganizationView']> {
    const path = `/organizations/${orgId}`;
    return this.client.get<components['schemas']['OrganizationView']>(path, options);
  }

  /**
   * View User Orgs
   * @description This request will return a list of organizations. The response will ONLY contain organizations in which the user is a staff member (member=true). This response will NOT contain partner organizations in which the user is not a staff member (member=false).
   * @generated from GET /users/{userName}/organizations
   */
  async listOrganizations(userName: string, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['OrganizationViewGet']>> {
    const path = `/users/${userName}/organizations`;
    return this.client.get<PaginatedResponse<components['schemas']['OrganizationViewGet']>>(path, options);
  }

  /**
   * List Organization Users
   * @description Returns a list of users belonging to the specified organization.
   * @generated from GET /organizations/{orgId}/users
   */
  async listUsers(orgId: string, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['OrganizationUser']>> {
    const path = `/organizations/${orgId}/users`;
    return this.client.get<PaginatedResponse<components['schemas']['OrganizationUser']>>(path, options);
  }
}

// Re-export types for convenience
export type { components as OrganizationsTypes } from '../types/generated/organizations.js';
