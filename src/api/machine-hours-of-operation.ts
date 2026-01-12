/**
 * MachineHoursOfOperationApi
 *
 * Auto-generated SDK wrapper for John Deere machine-hours-of-operation API.
 * @generated from machine-hours-of-operation.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/machine-hours-of-operation.js';

export class MachineHoursOfOperationApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Hours of Operation
   * @description The Hours of Operation service allows the user to view the durations for which the engine was on or off during a specified time period. You will also be able to view the last known state of the machine's engine. Each request returns a link to <mark>machine</mark>, which will return a state report for the specified machine.<br/><b>Note</b>: When the terminal is powered off, hours of operation are not recorded.
   * @generated from GET /machines/{principalId}/hoursOfOperation
   */
  async list(
    principalId: string,
    params?: { startDate?: string; endDate?: string; detailedState?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['HoursOfOperation_Response']>> {
    const query = new URLSearchParams();
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.detailedState !== undefined)
      query.set('detailedState', String(params.detailedState));
    const queryString = query.toString();
    const path = `/machines/${principalId}/hoursOfOperation${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['HoursOfOperation_Response']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /machines/{principalId}/hoursOfOperation
   */
  async listAll(
    principalId: string,
    params?: { startDate?: string; endDate?: string; detailedState?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['HoursOfOperation_Response'][]> {
    const query = new URLSearchParams();
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.detailedState !== undefined)
      query.set('detailedState', String(params.detailedState));
    const queryString = query.toString();
    const path = `/machines/${principalId}/hoursOfOperation${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['HoursOfOperation_Response']>(path, options);
  }
}

// Re-export types for convenience
export type { components as MachineHoursOfOperationTypes } from '../types/generated/machine-hours-of-operation.js';
