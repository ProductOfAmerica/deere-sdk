/**
 * BoundariesApi
 *
 * Auto-generated SDK wrapper for John Deere boundaries API.
 * @generated from boundaries.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/boundaries.js';

export class BoundariesApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * View Boundaries in an Org
   * @description View boundaries in an organization. fields: View the field
   * associated with these boundaries. owningOrganizations: View the
   * organization that owns the field.
   * @generated from GET /organizations/{orgId}/boundaries
   */
  async list(
    orgId: string,
    params?: { embed?: string; recordFilter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['BoundaryOrgId']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['BoundaryOrgId']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/boundaries
   */
  async listAll(
    orgId: string,
    params?: { embed?: string; recordFilter?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['BoundaryOrgId'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['BoundaryOrgId']>(path, options);
  }

  /**
   * View the Boundaries of a Field
   * @description View the boundaries of a specified field.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/boundaries
   */
  async listBoundaries(
    orgId: string,
    fieldId: string,
    params?: { embed?: string; recordFilter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['BoundaryOrgId']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['BoundaryOrgId']>>(
      path,
      options
    );
  }

  /**
   * Create a Boundary
   * @description Create a boundary with a geometry collection for a field.
   * @generated from POST /organizations/{orgId}/fields/{fieldId}/boundaries
   */
  async create(
    orgId: string,
    fieldId: string,
    data: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<components['schemas']['PostBoundary']> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries`;
    return this.client.post<components['schemas']['PostBoundary']>(path, data, options);
  }

  /**
   * Generate a Boundary from a FieldOperation
   * @description Given a , this endpoint will generate and return a boundary
   * that surrounds the area worked by that field operation. Any gaps in that
   * field operation will be treated as interior rings. This endpoint returns
   * the generated boundary, giving you the opportunity to change the boundary
   * name, clean up any unwanted interiors, etc. before back into Operations
   * Center. There are two cases where this API will return an HTTP 400 - Bad
   * Request: If the field already has an active boundary. In this case, please
   * use the existing boundary - it is likely more accurate than a generated
   * boundary. If the field has been merged. In this case, a FieldOperation may
   * only cover one part of the merged field, resulting in an inaccurate
   * boundary.
   * @generated from GET /fieldOperations/{operationId}/boundary
   */
  async get(
    operationId: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['BoundaryOrgId2']>> {
    const path = `/fieldOperations/${operationId}/boundary`;
    return this.client.get<PaginatedResponse<components['schemas']['BoundaryOrgId2']>>(
      path,
      options
    );
  }

  /**
   * Get a specific boundary
   * @description This endpoint will retrieve a specific boundary.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async getBoundaries(
    orgId: string,
    fieldId: string,
    boundaryId: string,
    options?: RequestOptions
  ): Promise<components['schemas']['PostBoundaryGet']> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    return this.client.get<components['schemas']['PostBoundaryGet']>(path, options);
  }

  /**
   * Update a boundary
   * @description This endpoint will update a boundary. The shape of the object
   * must include name, active, irrigated, sourceType, and multipolygons. All
   * these fields can be updated, however a license is required to set
   * sourceType to a value other than "External". If the boundary is set to
   * active, it will mark all other boundaries in this field inactive.
   * @generated from PUT /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async update(
    orgId: string,
    fieldId: string,
    boundaryId: string,
    data: components['schemas']['PutBoundary'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a boundary
   * @description This endpoint will delete a boundary.
   * @generated from DELETE /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async delete(
    orgId: string,
    fieldId: string,
    boundaryId: string,
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    await this.client.delete(path, options);
  }
}

// Re-export types for convenience
export type { components as BoundariesTypes } from '../types/generated/boundaries.js';
