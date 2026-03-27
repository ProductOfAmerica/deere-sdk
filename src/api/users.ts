/**
 * UsersApi
 *
 * Auto-generated SDK wrapper for John Deere users API.
 * @generated from users.yaml
 */

import type { DeereClient, RequestOptions } from '../client.js';
import type { components } from '../types/generated/users.js';

export class UsersApi {
  constructor(private readonly client: DeereClient) {}

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
    return this.client.get<components['schemas']['UsersValue']>(path, options);
  }
}

// Re-export types for convenience
export type { components as UsersTypes } from '../types/generated/users.js';
