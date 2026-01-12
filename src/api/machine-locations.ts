/**
 * MachineLocationsApi
 *
 * Auto-generated SDK wrapper for John Deere machine-locations API.
 * @generated from machine-locations.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/machine-locations.js';

export class MachineLocationsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Machine Location History
   * @description The machine location service allows the client to view a list of location reports for a machine.A location report will include the machine's longitude, latitude, and altitude.For each location report, the response will link to the <strong>/machines</strong> resource.
   * @generated from GET /machines/{principalId}/locationHistory
   */
  async get(principalId: string, params?: { lastKnown?: boolean; startDate?: string; endDate?: string }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['ReportedLocation']>> {
    const query = new URLSearchParams();
    if (params?.lastKnown !== undefined) query.set('lastKnown', String(params.lastKnown));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/machines/${principalId}/locationHistory${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ReportedLocation']>>(path, options);
  }
}

// Re-export types for convenience
export type { components as MachineLocationsTypes } from '../types/generated/machine-locations.js';
