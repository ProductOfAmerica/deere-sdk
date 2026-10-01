/**
 * UsersApi
 *
 * Auto-generated SDK wrapper for John Deere users API.
 * @generated from users.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/users.js';

export class UsersApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'users';

  constructor(private readonly client: DeereClient) {}

  /**
   * View User Info Using Literal Value
   * @description This endpoint returns information about the user, such as
   * first and last name, the account name, etc. This call can be used by a
   * logged-in user to view their own information. The response also contains
   * links to the following resources: organizations: View a list of
   * organizations to which the user belongs. files: View a list of files
   * belonging to the user.
   * @generated from GET /users/@currentUser
   */
  async getCurrentUser(
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['UsersValue']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/users/@currentUser${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['UsersValue']>(this.spec, path, options);
  }

  /**
   * View User Orgs
   * @description This request will return a list of organizations. The response
   * will ONLY contain organizations in which the user is a staff member
   * (member=true). This response will NOT contain partner organizations in
   * which the user is not a staff member (member=false).
   * @generated from GET /users/{userName}/organizations
   */
  async listOrganizations(
    userName: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['OrganizationViewGet']>> {
    const path = `/users/${userName}/organizations`;
    return this.client.get<PaginatedResponse<components['schemas']['OrganizationViewGet']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * View User Info
   * @description This endpoint returns information about the user, such as
   * first and last name, the account name, etc. This call can be used by a
   * logged-in user to view their own information. The response also contains
   * links to the following resources: organizations: View a list of
   * organizations to which the user belongs. files: View a list of files
   * belonging to the user.
   * @generated from GET /users/{username}
   */
  async get(
    username: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['UsersValue']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/users/${username}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['UsersValue']>(this.spec, path, options);
  }
}

// Re-export types for convenience
export type { components as UsersTypes } from '../types/generated/users.js';
