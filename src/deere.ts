/**
 * John Deere SDK
 *
 * High-level SDK that combines all API resources.
 * @generated
 */

import {
  AempApi,
  AssetsApi,
  BoundariesApi,
  ClientsApi,
  ConnectionManagementApi,
  CropTypesApi,
  EquipmentApi,
  EquipmentMeasurementApi,
  FarmsApi,
  FieldOperationsApi,
  FieldsApi,
  FilesApi,
  FlagsApi,
  GuidanceLinesApi,
  HarvestIdApi,
  MachineAlertsApi,
  MachineDeviceStateReportsApi,
  MachineEngineHoursApi,
  MachineHoursOfOperationApi,
  MachineLocationsApi,
  MapLayersApi,
  NotificationsApi,
  OperatorsApi,
  OrganizationsApi,
  PartnershipsApi,
  ProductsApi,
  UsersApi,
  WebhookApi,
} from './api/index.js';
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
