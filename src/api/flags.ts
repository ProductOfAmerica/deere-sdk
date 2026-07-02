/**
 * FlagsApi
 *
 * Auto-generated SDK wrapper for John Deere flags API.
 * @generated from flags.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/flags.js';

export class FlagsApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'flags';

  constructor(private readonly client: DeereClient) {}

  /**
   * List flags for the field
   * @description This resource will return a list of flag objects associated
   * with the field.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/flags
   */
  async list(
    orgId: string,
    fieldId: string,
    params?: {
      embed?: string;
      startTime?: string;
      endTime?: string;
      categoryIDs?: string;
      categoryNames?: string;
      recordFilter?: string;
      shapeTypes?: string;
      simple?: boolean;
      metadataOnly?: boolean;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ValuesFlagId']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined)
      query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ValuesFlagId']>>(
      this.spec,
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/flags
   */
  async listAll(
    orgId: string,
    fieldId: string,
    params?: {
      embed?: string;
      startTime?: string;
      endTime?: string;
      categoryIDs?: string;
      categoryNames?: string;
      recordFilter?: string;
      shapeTypes?: string;
      simple?: boolean;
      metadataOnly?: boolean;
    },
    options?: RequestOptions
  ): Promise<components['schemas']['ValuesFlagId'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined)
      query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['ValuesFlagId']>(this.spec, path, options);
  }

  /**
   * List Flags Category Collection
   * @description This resource will return a Flags Category Collection for
   * Organization.
   * @generated from GET /organizations/{orgId}/flagCategories
   */
  async listFlagCategories(
    orgId: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FlagCategory2']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flagCategories${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FlagCategory2']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Create a custom category
   * @description This resource will create a custom category in the given
   * organization.
   * @generated from POST /organizations/{orgId}/flagCategories
   */
  async createFlagCategories(
    orgId: string,
    data: components['schemas']['PutResponse'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flagCategories`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Get flag category by id
   * @description This resource will return a flag category with the name
   * translated into the specified language. The category can be a reference
   * flagCategory, a master flagCategory created from a referenced flagCategory
   * or a user-defined category.
   * @generated from GET /organizations/{orgId}/flagCategories/{categoryId}
   */
  async getFlagCategories(
    orgId: string,
    categoryId: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['FlagCategory']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flagCategories/${categoryId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['FlagCategory']>(this.spec, path, options);
  }

  /**
   * Update flag category by organization and flag category Id
   * @description This resource will update flag category by Id.
   * @generated from PUT /organizations/{orgId}/flagCategories/{categoryId}
   */
  async updateFlagCategories(
    orgId: string,
    categoryId: string,
    data: components['schemas']['PutResponse'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flagCategories/${categoryId}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Delete a flag category
   * @description This resource will delete a single empty category based on the
   * categoryId and orgId.
   * @generated from DELETE /organizations/{orgId}/flagCategories/{categoryId}
   */
  async deleteFlagCategories(
    orgId: string,
    categoryId: string,
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flagCategories/${categoryId}`;
    await this.client.delete(this.spec, path, options);
  }

  /**
   * List collection of FlagCategoryPreference
   * @description This endpoint will return a collection of
   * FlagCategoryPreference objects associated with the given flag category. The
   * object with the key "default" is created automatically on the 1st access to
   * the flagCategory object by a client. The default preference object shall be
   * initialized with default values: prefKey: "default" hexColor: "#FFFFFF"
   * @generated from GET /organizations/{orgId}/flagCategories/{categoryId}/flagCategoryPreferences
   */
  async listFlagCategoryPreferences(
    orgId: string,
    categoryId: string,
    params?: { prefKey?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FlagCategoryPreference']>> {
    const query = new URLSearchParams();
    if (params?.prefKey !== undefined) query.set('prefKey', String(params.prefKey));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flagCategories/${categoryId}/flagCategoryPreferences${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FlagCategoryPreference']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * View preferences object for a category
   * @description This resource will return the preferences object for the given
   * flag category and org
   * @generated from GET /organizations/{orgId}/flagCategoryPreferences/{flagCategoryPreferencesId}
   */
  async getFlagCategoryPreferences(
    orgId: string,
    flagCategoryPreferencesId: string,
    options?: RequestOptions
  ): Promise<components['schemas']['FlagCategoryPreference']> {
    const path = `/organizations/${orgId}/flagCategoryPreferences/${flagCategoryPreferencesId}`;
    return this.client.get<components['schemas']['FlagCategoryPreference']>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Update flag category preferences
   * @description This resource will update flag category preferences by Id and
   * Org
   * @generated from PUT /organizations/{orgId}/flagCategoryPreferences/{flagCategoryPreferencesId}
   */
  async updateFlagCategoryPreferences(
    orgId: string,
    flagCategoryPreferencesId: string,
    data: components['schemas']['FlagCategoryPreference'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flagCategoryPreferences/${flagCategoryPreferencesId}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * View flags list
   * @description This resource will return a Flags list for Organization.
   * @generated from GET /organizations/{orgId}/flags
   */
  async getFlags(
    orgId: string,
    params?: {
      embed?: string;
      startTime?: string;
      endTime?: string;
      categoryIDs?: string;
      categoryNames?: string;
      recordFilter?: string;
      flagScopes?: string;
      shapeTypes?: string;
      simple?: boolean;
      metadataOnly?: boolean;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ValuesFlagId']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined)
      query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.flagScopes !== undefined) query.set('flagScopes', String(params.flagScopes));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flags${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ValuesFlagId']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Create a flag
   * @description This resource will create a flag in the given organization.
   * @generated from POST /organizations/{orgId}/flags
   */
  async create(
    orgId: string,
    data: components['schemas']['ValuesFlagIdPut'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flags`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * List a flag by org id and Flag id
   * @description This endpoint will return a flag for a given org and Flag id.
   * @generated from GET /organizations/{orgId}/flags/{flagId}
   */
  async get(
    orgId: string,
    flagId: string,
    params?: {
      embed?: string;
      startTime?: string;
      endTime?: string;
      categoryIDs?: string;
      categoryNames?: string;
      recordFilter?: string;
      flagScopes?: string;
      shapeTypes?: string;
      simple?: boolean;
      metadataOnly?: boolean;
    },
    options?: RequestOptions
  ): Promise<components['schemas']['ValuesFlagId']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.startTime !== undefined) query.set('startTime', String(params.startTime));
    if (params?.endTime !== undefined) query.set('endTime', String(params.endTime));
    if (params?.categoryIDs !== undefined) query.set('categoryIDs', String(params.categoryIDs));
    if (params?.categoryNames !== undefined)
      query.set('categoryNames', String(params.categoryNames));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.flagScopes !== undefined) query.set('flagScopes', String(params.flagScopes));
    if (params?.shapeTypes !== undefined) query.set('shapeTypes', String(params.shapeTypes));
    if (params?.simple !== undefined) query.set('simple', String(params.simple));
    if (params?.metadataOnly !== undefined) query.set('metadataOnly', String(params.metadataOnly));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/flags/${flagId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['ValuesFlagId']>(this.spec, path, options);
  }

  /**
   * Update flag by id
   * @description This resource will update flag by Organization and Flag Id.
   * @generated from PUT /organizations/{orgId}/flags/{flagId}
   */
  async update(
    orgId: string,
    flagId: string,
    data: components['schemas']['ValuesFlagIdPut'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/flags/${flagId}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Delete a flag for a given org
   * @description This resource will delete a single flag based on its Id and
   * org id
   * @generated from DELETE /organizations/{orgId}/flags/{flagId}
   */
  async delete(orgId: string, flagId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/flags/${flagId}`;
    await this.client.delete(this.spec, path, options);
  }
}

// Re-export types for convenience
export type { components as FlagsTypes } from '../types/generated/flags.js';
