/**
 * BoundariesApi
 *
 * Auto-generated SDK wrapper for John Deere boundaries API.
 * @generated from boundaries.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/boundaries.js';

export class BoundariesApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * View Boundaries in an Org
   * @description View boundaries in an organization. <ul> <li><b>fields</b>: View the field associated with these boundaries.</li> <li><b>owningOrganizations</b>: View the organization that owns the field.</li> </ul>
   * @generated from GET /organizations/{orgId}/boundaries
   */
  async list(orgId: string, params?: { embed?: string; recordFilter?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/boundaries
   */
  async listAll(orgId: string, params?: { embed?: string; recordFilter?: string }, options?: RequestOptions): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(path, options);
  }

  /**
   * View the Boundaries of a Field
   * @description View the boundaries of a specified field.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/boundaries
   */
  async listBoundaries(orgId: string, fieldId: string, params?: { embed?: string; recordFilter?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Create a Boundary
   * @description Create a boundary with a geometry collection for a field.
   * @generated from POST /organizations/{orgId}/fields/{fieldId}/boundaries
   */
  async create(orgId: string, fieldId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries`;
    await this.client.post(path, data, options);
  }

  /**
   * Generate a Boundary from a FieldOperation
   * @description Given a <a href='/dev-docs/field-operations#overviews' target='_blank'>field operation</a>, this endpoint will generate and return a boundary that surrounds the area worked by that field operation. Any gaps in that field operation will be treated as interior rings. This endpoint returns the generated boundary, giving you the opportunity to change the boundary name, clean up any unwanted interiors, etc. before <a href='/dev-docs/boundaries#/organizations/{orgId}/fields/{fieldId}/boundaries/post' target='_blank'>POST'ing the generated boundary</a> back into Operations Center. <p>There are two cases where this API will return an HTTP 400 - Bad Request:</p> <ul> <li><b>If the field already has an active boundary.</b> In this case, please use the existing boundary - it is likely more accurate than a generated boundary.</li> <li><b>If the field has been merged.</b> In this case, a FieldOperation may only cover one part of the merged field, resulting in an inaccurate boundary.</li> </ul>
   * @generated from GET /fieldOperations/{operationId}/boundary
   */
  async get(operationId: string, options?: RequestOptions): Promise<unknown> {
    const path = `/fieldOperations/${operationId}/boundary`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Get a specific boundary
   * @description This endpoint will retrieve a specific boundary.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async getBoundaries(orgId: string, fieldId: string, boundaryId: string, options?: RequestOptions): Promise<unknown> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Update a boundary
   * @description This endpoint will update a boundary. The shape of the object must include name, active, irrigated, sourceType, and multipolygons. All these fields can be updated, however a license is required to set sourceType to a value other than "External". If the boundary is set to active, it will mark all other boundaries in this field inactive.
   * @generated from PUT /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async update(orgId: string, fieldId: string, boundaryId: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a boundary
   * @description This endpoint will delete a boundary.
   * @generated from DELETE /organizations/{orgId}/fields/{fieldId}/boundaries/{boundaryId}
   */
  async delete(orgId: string, fieldId: string, boundaryId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/boundaries/${boundaryId}`;
    await this.client.delete(path, options);
  }
}

// Re-export types for convenience
export type { components as BoundariesTypes } from '../types/generated/boundaries.js';
