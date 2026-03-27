/**
 * OperatorsApi
 *
 * Auto-generated SDK wrapper for John Deere operators API.
 * @generated from operators.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/operators.js';

export class OperatorsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Retrieve all Operators for a given org
   * @description This endpoint will return list of operators in the system for
   * the provided organization ID
   * @generated from GET /organizations/{orgId}/operators
   */
  async list(
    orgId: string,
    params?: { embed?: string; recordFilter?: string; lastModifiedTime?: unknown },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['GetResponseDetails']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.lastModifiedTime !== undefined)
      query.set('lastModifiedTime', String(params.lastModifiedTime));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/operators${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['GetResponseDetails']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/operators
   */
  async listAll(
    orgId: string,
    params?: { embed?: string; recordFilter?: string; lastModifiedTime?: unknown },
    options?: RequestOptions
  ): Promise<components['schemas']['GetResponseDetails'][]> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    if (params?.lastModifiedTime !== undefined)
      query.set('lastModifiedTime', String(params.lastModifiedTime));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/operators${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['GetResponseDetails']>(path, options);
  }

  /**
   * Create an Operator
   * @description This endpoint will create a new Operator in the system for the
   * provided organization ID
   * @generated from POST /organizations/{orgId}/operators
   */
  async create(
    orgId: string,
    data: components['schemas']['PostOperator'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/operators`;
    await this.client.post(path, data, options);
  }

  /**
   * Delete all Operators for a given org
   * @description This endpoint will delete every operator in the system for the
   * provided organization ID
   * @generated from DELETE /organizations/{orgId}/operators
   */
  async delete(orgId: string, options?: RequestOptions): Promise<void> {
    const path = `/organizations/${orgId}/operators`;
    await this.client.delete(path, options);
  }

  /**
   * Retrieve a specific Operator in an org by Operator ID
   * @description This endpoint will return a specific operator in the system in
   * an org for the provided Operator ID to the data of an operator in the
   * request body
   * @generated from GET /organizations/{orgId}/operators/{id}
   */
  async get(
    orgId: string,
    id: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['GetResponseOperatorDetails']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/operators/${id}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['GetResponseOperatorDetails']>(path, options);
  }

  /**
   * Update a specific Operator in an org by Operator ID
   * @description This endpoint will update a specific operator in the system in
   * an org for the provided Operator ID to the data of an operator in the
   * request body
   * @generated from PUT /organizations/{orgId}/operators/{id}
   */
  async update(
    orgId: string,
    id: string,
    data: components['schemas']['PutOperator'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/operators/${id}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete a specific Operator in an org by Operator ID
   * @description This endpoint will delete a specific operator in the system in
   * an org for the provided Operator ID
   * @generated from DELETE /organizations/{orgId}/operators/{id}
   */
  async deleteOperators(
    orgId: string,
    id: string,
    params?: { orgid?: string },
    options?: RequestOptions
  ): Promise<void> {
    const query = new URLSearchParams();
    if (params?.orgid !== undefined) query.set('orgid', String(params.orgid));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/operators/${id}${queryString ? `?${queryString}` : ''}`;
    await this.client.delete(path, options);
  }
}

// Re-export types for convenience
export type { components as OperatorsTypes } from '../types/generated/operators.js';
