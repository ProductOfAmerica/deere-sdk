/**
 * GuidanceLinesApi
 *
 * Auto-generated SDK wrapper for John Deere guidance-lines API.
 * @generated from guidance-lines.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/guidance-lines.js';

export class GuidanceLinesApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * View guidance lines for a field
   * @description This endpoint will retrieve a list of guidance lines for a field. By default, the call will return only active guidance lines.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/guidanceLines
   */
  async list(orgId: string, fieldId: string, params?: { status?: string; recordFilter?: string; embed?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/guidanceLines${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/guidanceLines
   */
  async listAll(orgId: string, fieldId: string, params?: { status?: string; recordFilter?: string; embed?: string }, options?: RequestOptions): Promise<unknown[]> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/guidanceLines${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<unknown>(path, options);
  }

  /**
   * Create a guidance line
   * @description This endpoint will create a guidance line and associate it to a given field. This operation currently only supports the creation of AB Lines.
   * @generated from POST /organizations/{orgId}/fields/{fieldId}/guidanceLines
   */
  async create(orgId: string, fieldId: string, data: components['schemas']['GuidanceLine'], options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/guidanceLines`;
    await this.client.post(path, data, options);
  }

  /**
   * Retrieve a specific guidance line
   * @description This endpoint will return the subclass of guidance line represented by the specified ID.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/guidanceLines/{guidanceLineId}
   */
  async get(orgId: string, fieldId: string, guidanceLineId: string, params?: { embed?: string }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/guidanceLines/${guidanceLineId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Update a GuidanceLine
   * @description This endpoint will update the GuidanceLines name.
   * @generated from PUT /organizations/{orgId}/fields/{fieldId}/guidanceLines/{guidanceLineId}
   */
  async update(orgId: string, fieldId: string, guidanceLineId: string, data: components['schemas']['GuidanceLinePut'], options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/fields/${fieldId}/guidanceLines/${guidanceLineId}`;
    await this.client.put(path, data, options);
  }
}

// Re-export types for convenience
export type { components as GuidanceLinesTypes } from '../types/generated/guidance-lines.js';
