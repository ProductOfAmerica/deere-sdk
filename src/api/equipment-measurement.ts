/**
 * EquipmentMeasurementApi
 *
 * Auto-generated SDK wrapper for John Deere equipment-measurement API.
 * @generated from equipment-measurement.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/equipment-measurement.js';

export class EquipmentMeasurementApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Contribute measurements for a given equipment (NEW)
   * @description This resource allows the client to provide metadata for a third-party managed piece of equipment in Operations Center. <br><br> <b>Getting Started</b><br>The process of contributing equipment measurement data to John Deere can be broken down into three primary steps. <ol> <li> Determine the Equipment’s make, type, and model IDs</li> <li> Create the Equipment. Please see the <a  href='/dev-docs/equipment' target='_blank'>Equipment API</a> for more information on creating equipment.</li> <li> Contribute Measurements</li> </ol>
   * @generated from POST /organizations/{organizationId}/equipment/{principalId}/measurements
   */
  async create(
    organizationId: string,
    principalId: string,
    data: components['schemas']['EquipmentMeasurementsNew'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/equipment/${principalId}/measurements`;
    await this.client.post(path, data, options);
  }
}

// Re-export types for convenience
export type { components as EquipmentMeasurementTypes } from '../types/generated/equipment-measurement.js';
