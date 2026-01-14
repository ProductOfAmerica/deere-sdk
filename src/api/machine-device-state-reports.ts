/**
 * MachineDeviceStateReportsApi
 *
 * Auto-generated SDK wrapper for John Deere machine-device-state-reports API.
 * @generated from machine-device-state-reports.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/machine-device-state-reports.js';

export class MachineDeviceStateReportsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Terminal Device State Reports
   * @description A device state report is generated from a terminal at a specified time. The report contains the following information: Engine State Power State Model State RSSI Value (signal strength of the terminal) Local Information GPS State/Error WIFI Info/Error GSM/WIFI Antenna Type Wifi SSID BatteryVoltage LastBootType LastBootTimestamp VehiclePowerState This report is specific to, and identified by, the terminal, regardless of which machine it is connected to. Device state report information is collected from the machine terminal. A device state report is created for each machine call-in. Each requested DSR (one report for a single terminal request, and two or more for a multiple terminal request) links to Machine: Request a Device State Report from the specified machine. If the terminal is not linked to a machine, this link will not appear. Terminal: Request a Device State Report from the specified terminal.
   * @generated from GET /machines/{principalId}/deviceStateReports
   */
  async get(
    principalId: string,
    params?: { lastKnown?: boolean; startDate?: string; endDate?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['DeviceStateReport']>> {
    const query = new URLSearchParams();
    if (params?.lastKnown !== undefined) query.set('lastKnown', String(params.lastKnown));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/machines/${principalId}/deviceStateReports${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['DeviceStateReport']>>(
      path,
      options
    );
  }
}

// Re-export types for convenience
export type { components as MachineDeviceStateReportsTypes } from '../types/generated/machine-device-state-reports.js';
