/**
 * MachineEngineHoursApi
 *
 * Auto-generated SDK wrapper for John Deere machine-engine-hours API.
 * @generated from machine-engine-hours.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/machine-engine-hours.js';

export class MachineEngineHoursApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Engine Hours
   * @description The engine hours service returns the last reported number of hours that a machine's engine has recorded.Each response includes a timestamp for the report and the source of the report.For each returned engine hours report, the response will include a link to the machine's information.
   * @generated from GET /machines/{principalId}/engineHours
   */
  async list(
    principalId: string,
    params?: { startDate?: string; endDate?: string; lastKnown?: boolean },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['EngineHours_Response']>> {
    const query = new URLSearchParams();
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.lastKnown !== undefined) query.set('lastKnown', String(params.lastKnown));
    const queryString = query.toString();
    const path = `/machines/${principalId}/engineHours${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['EngineHours_Response']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /machines/{principalId}/engineHours
   */
  async listAll(
    principalId: string,
    params?: { startDate?: string; endDate?: string; lastKnown?: boolean },
    options?: RequestOptions
  ): Promise<components['schemas']['EngineHours_Response'][]> {
    const query = new URLSearchParams();
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.lastKnown !== undefined) query.set('lastKnown', String(params.lastKnown));
    const queryString = query.toString();
    const path = `/machines/${principalId}/engineHours${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['EngineHours_Response']>(path, options);
  }
}

// Re-export types for convenience
export type { components as MachineEngineHoursTypes } from '../types/generated/machine-engine-hours.js';
