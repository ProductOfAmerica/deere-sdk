/**
 * John Deere SDK
 *
 * High-level SDK that combines all API resources.
 * @generated
 */

import { AempApi } from './api/aemp.js';
import { AssetsApi } from './api/assets.js';
import { BoundariesApi } from './api/boundaries.js';
import { ClientsApi } from './api/clients.js';
import { ConnectionManagementApi } from './api/connection-management.js';
import { CropTypesApi } from './api/crop-types.js';
import { EquipmentApi } from './api/equipment.js';
import { EquipmentMeasurementApi } from './api/equipment-measurement.js';
import { FarmsApi } from './api/farms.js';
import { FieldOperationsApi } from './api/field-operations-api.js';
import { FieldsApi } from './api/fields.js';
import { FilesApi } from './api/files.js';
import { FlagsApi } from './api/flags.js';
import { GuidanceLinesApi } from './api/guidance-lines.js';
import { HarvestIdApi } from './api/harvest-id.js';
import { MachineAlertsApi } from './api/machine-alerts.js';
import { MachineDeviceStateReportsApi } from './api/machine-device-state-reports.js';
import { MachineEngineHoursApi } from './api/machine-engine-hours.js';
import { MachineHoursOfOperationApi } from './api/machine-hours-of-operation.js';
import { MachineLocationsApi } from './api/machine-locations.js';
import { MapLayersApi } from './api/map-layers.js';
import { NotificationsApi } from './api/notifications.js';
import { OperatorsApi } from './api/operators.js';
import { OrganizationsApi } from './api/organizations.js';
import { PartnershipsApi } from './api/partnerships.js';
import { ProductsApi } from './api/products.js';
import { UsersApi } from './api/users.js';
import { WebhookApi } from './api/webhook.js';
import { DeereClient, type DeereClientConfig } from './client.js';

/**
 * John Deere SDK
 *
 * Provides typed access to all John Deere Operations Center APIs.
 *
 * @example
 * ```typescript
 * import { Deere } from 'deere-sdk';
 *
 * const deere = new Deere({
 *   accessToken: 'your-token',
 *   environment: 'sandbox',
 * });
 *
 * const orgs = await deere.organizations.listAll();
 * const farms = await deere.farms.listAll(orgs[0].id);
 * const fields = await deere.fields.listAll(orgs[0].id);
 * ```
 */
export class Deere {
  /** Raw HTTP client for custom requests */
  readonly client: DeereClient;

  /** aemp API */
  readonly aemp: AempApi;

  /** assets API */
  readonly assets: AssetsApi;

  /** boundaries API */
  readonly boundaries: BoundariesApi;

  /** clients API */
  readonly clients: ClientsApi;

  /** connection management API */
  readonly connectionManagement: ConnectionManagementApi;

  /** crop types API */
  readonly cropTypes: CropTypesApi;

  /** equipment measurement API */
  readonly equipmentMeasurement: EquipmentMeasurementApi;

  /** equipment API */
  readonly equipment: EquipmentApi;

  /** farms API */
  readonly farms: FarmsApi;

  /** field operations api API */
  readonly fieldOperations: FieldOperationsApi;

  /** fields API */
  readonly fields: FieldsApi;

  /** files API */
  readonly files: FilesApi;

  /** flags API */
  readonly flags: FlagsApi;

  /** guidance lines API */
  readonly guidanceLines: GuidanceLinesApi;

  /** harvest id API */
  readonly harvestId: HarvestIdApi;

  /** machine alerts API */
  readonly machineAlerts: MachineAlertsApi;

  /** machine device state reports API */
  readonly machineDeviceStateReports: MachineDeviceStateReportsApi;

  /** machine engine hours API */
  readonly machineEngineHours: MachineEngineHoursApi;

  /** machine hours of operation API */
  readonly machineHoursOfOperation: MachineHoursOfOperationApi;

  /** machine locations API */
  readonly machineLocations: MachineLocationsApi;

  /** map layers API */
  readonly mapLayers: MapLayersApi;

  /** notifications API */
  readonly notifications: NotificationsApi;

  /** operators API */
  readonly operators: OperatorsApi;

  /** organizations API */
  readonly organizations: OrganizationsApi;

  /** partnerships API */
  readonly partnerships: PartnershipsApi;

  /** products API */
  readonly products: ProductsApi;

  /** users API */
  readonly users: UsersApi;

  /** webhook API */
  readonly webhook: WebhookApi;

  constructor(config: DeereClientConfig) {
    this.client = new DeereClient(config);
    this.aemp = new AempApi(this.client);
    this.assets = new AssetsApi(this.client);
    this.boundaries = new BoundariesApi(this.client);
    this.clients = new ClientsApi(this.client);
    this.connectionManagement = new ConnectionManagementApi(this.client);
    this.cropTypes = new CropTypesApi(this.client);
    this.equipmentMeasurement = new EquipmentMeasurementApi(this.client);
    this.equipment = new EquipmentApi(this.client);
    this.farms = new FarmsApi(this.client);
    this.fieldOperations = new FieldOperationsApi(this.client);
    this.fields = new FieldsApi(this.client);
    this.files = new FilesApi(this.client);
    this.flags = new FlagsApi(this.client);
    this.guidanceLines = new GuidanceLinesApi(this.client);
    this.harvestId = new HarvestIdApi(this.client);
    this.machineAlerts = new MachineAlertsApi(this.client);
    this.machineDeviceStateReports = new MachineDeviceStateReportsApi(this.client);
    this.machineEngineHours = new MachineEngineHoursApi(this.client);
    this.machineHoursOfOperation = new MachineHoursOfOperationApi(this.client);
    this.machineLocations = new MachineLocationsApi(this.client);
    this.mapLayers = new MapLayersApi(this.client);
    this.notifications = new NotificationsApi(this.client);
    this.operators = new OperatorsApi(this.client);
    this.organizations = new OrganizationsApi(this.client);
    this.partnerships = new PartnershipsApi(this.client);
    this.products = new ProductsApi(this.client);
    this.users = new UsersApi(this.client);
    this.webhook = new WebhookApi(this.client);
  }
}

/**
 * Create a John Deere SDK instance
 */
export function createDeere(config: DeereClientConfig): Deere {
  return new Deere(config);
}
