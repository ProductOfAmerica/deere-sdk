/**
 * Field Operations API
 *
 * Typed wrapper for John Deere Field Operations endpoints.
 * Includes harvest, planting, and application data.
 */

import type { DeereClient, Link, PaginatedResponse, RequestOptions } from '../client.js';

export type FieldOperationType = 'seeded' | 'harvested' | 'applied' | 'tillage' | 'unknown';

export interface FieldOperation {
  '@type'?: string;
  id: string;
  operationType: FieldOperationType;
  startDate: string;
  endDate?: string;
  area?: { value: number; unit: string };
  products?: OperationProduct[];
  machine?: OperationMachine;
  links?: Link[];
}

export interface OperationProduct {
  '@type'?: string;
  name?: string;
  rate?: { value: number; unit: string };
  totalApplied?: { value: number; unit: string };
}

export interface OperationMachine {
  '@type'?: string;
  name?: string;
  id?: string;
  machineType?: string;
}

export interface FieldOperationsListParams {
  /** Filter by operation type: seeded, harvested, applied, tillage */
  operationType?: FieldOperationType;
  /** Start date filter (ISO 8601) */
  startDate?: string;
  /** End date filter (ISO 8601) */
  endDate?: string;
  /** Embed additional resources */
  embed?: string;
}

export class FieldOperationsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List field operations for an organization
   */
  async list(
    orgId: string,
    params?: FieldOperationsListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<FieldOperation>> {
    const query = new URLSearchParams();
    if (params?.operationType) query.set('operationType', params.operationType);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const path = queryString
      ? `/organizations/${orgId}/fieldOperations?${queryString}`
      : `/organizations/${orgId}/fieldOperations`;

    return this.client.get<PaginatedResponse<FieldOperation>>(path, options);
  }

  /**
   * List field operations for a specific field
   */
  async listForField(
    orgId: string,
    fieldId: string,
    params?: FieldOperationsListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<FieldOperation>> {
    const query = new URLSearchParams();
    if (params?.operationType) query.set('operationType', params.operationType);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const path = queryString
      ? `/organizations/${orgId}/fields/${fieldId}/fieldOperations?${queryString}`
      : `/organizations/${orgId}/fields/${fieldId}/fieldOperations`;

    return this.client.get<PaginatedResponse<FieldOperation>>(path, options);
  }

  /**
   * Get all field operations for an organization (follows pagination)
   */
  async listAll(
    orgId: string,
    params?: FieldOperationsListParams,
    options?: RequestOptions
  ): Promise<FieldOperation[]> {
    const query = new URLSearchParams();
    if (params?.operationType) query.set('operationType', params.operationType);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const path = queryString
      ? `/organizations/${orgId}/fieldOperations?${queryString}`
      : `/organizations/${orgId}/fieldOperations`;

    return this.client.getAll<FieldOperation>(path, options);
  }

  /**
   * Get a specific field operation
   */
  async get(orgId: string, operationId: string, options?: RequestOptions): Promise<FieldOperation> {
    return this.client.get<FieldOperation>(
      `/organizations/${orgId}/fieldOperations/${operationId}`,
      options
    );
  }

  // Convenience methods for common operation types

  /**
   * Get harvest data for a field
   */
  async getHarvestData(
    orgId: string,
    fieldId?: string,
    params?: Omit<FieldOperationsListParams, 'operationType'>,
    options?: RequestOptions
  ): Promise<FieldOperation[]> {
    const query = new URLSearchParams();
    query.set('operationType', 'harvested');
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const basePath = fieldId
      ? `/organizations/${orgId}/fields/${fieldId}/fieldOperations`
      : `/organizations/${orgId}/fieldOperations`;
    const path = `${basePath}?${queryString}`;

    return this.client.getAll<FieldOperation>(path, options);
  }

  /**
   * Get planting data for a field
   */
  async getPlantingData(
    orgId: string,
    fieldId?: string,
    params?: Omit<FieldOperationsListParams, 'operationType'>,
    options?: RequestOptions
  ): Promise<FieldOperation[]> {
    const query = new URLSearchParams();
    query.set('operationType', 'seeded');
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const basePath = fieldId
      ? `/organizations/${orgId}/fields/${fieldId}/fieldOperations`
      : `/organizations/${orgId}/fieldOperations`;
    const path = `${basePath}?${queryString}`;

    return this.client.getAll<FieldOperation>(path, options);
  }

  /**
   * Get application data for a field (fertilizer, herbicide, etc.)
   */
  async getApplicationData(
    orgId: string,
    fieldId?: string,
    params?: Omit<FieldOperationsListParams, 'operationType'>,
    options?: RequestOptions
  ): Promise<FieldOperation[]> {
    const query = new URLSearchParams();
    query.set('operationType', 'applied');
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.embed) query.set('embed', params.embed);

    const queryString = query.toString();
    const basePath = fieldId
      ? `/organizations/${orgId}/fields/${fieldId}/fieldOperations`
      : `/organizations/${orgId}/fieldOperations`;
    const path = `${basePath}?${queryString}`;

    return this.client.getAll<FieldOperation>(path, options);
  }
}
