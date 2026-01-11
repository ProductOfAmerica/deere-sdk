/**
 * John Deere SDK
 *
 * High-level SDK that combines all API resources.
 * @generated
 */

import { DeereClient, type DeereClientConfig } from './client.js';
import { AssetsApi } from './api/assets.js';
import { BoundariesApi } from './api/boundaries.js';
import { ClientsApi } from './api/clients.js';
import { ConnectionManagementApi } from './api/connection-management.js';
import { CropTypesApi } from './api/crop-types.js';
import { EquipmentApi } from './api/equipment.js';
import { FarmsApi } from './api/farms.js';
import { FieldOperationsApi } from './api/field-operations-api.js';
import { FieldsApi } from './api/fields.js';
import { FilesApi } from './api/files.js';
import { FlagsApi } from './api/flags.js';
import { GuidanceLinesApi } from './api/guidance-lines.js';
import { MapLayersApi } from './api/map-layers.js';
import { OperatorsApi } from './api/operators.js';
import { OrganizationsApi } from './api/organizations.js';
import { ProductsApi } from './api/products.js';
import { UsersApi } from './api/users.js';
import { WebhookApi } from './api/webhook.js';

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
 * // List organizations
 * const orgs = await deere.organizations.listAll();
 *
 * // Get fields for an organization
 * const fields = await deere.fields.listAll(orgs[0].id);
 *
 * // Get farms
 * const farms = await deere.farms.listAll(orgs[0].id);
 *
 * // Get harvest data
 * const harvests = await deere.fieldOperationsApi.listAll(orgId);
 * ```
 */
export class Deere {
  /** Raw HTTP client for custom requests */
  readonly client: DeereClient;

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

  /** map layers API */
  readonly mapLayers: MapLayersApi;

  /** operators API */
  readonly operators: OperatorsApi;

  /** organizations API */
  readonly organizations: OrganizationsApi;

  /** products API */
  readonly products: ProductsApi;

  /** users API */
  readonly users: UsersApi;

  /** webhook API */
  readonly webhook: WebhookApi;

  constructor(config: DeereClientConfig) {
    this.client = new DeereClient(config);
    this.assets = new AssetsApi(this.client);
    this.boundaries = new BoundariesApi(this.client);
    this.clients = new ClientsApi(this.client);
    this.connectionManagement = new ConnectionManagementApi(this.client);
    this.cropTypes = new CropTypesApi(this.client);
    this.equipment = new EquipmentApi(this.client);
    this.farms = new FarmsApi(this.client);
    this.fieldOperations = new FieldOperationsApi(this.client);
    this.fields = new FieldsApi(this.client);
    this.files = new FilesApi(this.client);
    this.flags = new FlagsApi(this.client);
    this.guidanceLines = new GuidanceLinesApi(this.client);
    this.mapLayers = new MapLayersApi(this.client);
    this.operators = new OperatorsApi(this.client);
    this.organizations = new OrganizationsApi(this.client);
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
