/**
 * MachineLocationsApi
 *
 * Auto-generated SDK wrapper for John Deere machine-locations API.
 * @generated from machine-locations.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/machine-locations.js';

export class MachineLocationsApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'machine-locations';

  constructor(private readonly client: DeereClient) {}

  /**
   * Machine Location History
   * @description The machine location service allows the client to view a list
   * of location reports for a machine.A location report will include the
   * machine's longitude, latitude, and altitude.For each location report, the
   * response will link to the /machines resource.
   * @generated from GET /machines/{principalId}/locationHistory
   */
  async get(
    principalId: string,
    params?: { lastKnown?: boolean; startDate?: string; endDate?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ReportedLocation']>> {
    const query = new URLSearchParams();
    if (params?.lastKnown !== undefined) query.set('lastKnown', String(params.lastKnown));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/machines/${principalId}/locationHistory${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ReportedLocation']>>(
      this.spec,
      path,
      options
    );
  }
}

// Re-export types for convenience
export type { components as MachineLocationsTypes } from '../types/generated/machine-locations.js';
