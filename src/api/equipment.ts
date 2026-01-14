/**
 * EquipmentApi
 *
 * Auto-generated SDK wrapper for John Deere equipment API.
 * @generated from equipment.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/equipment.js';

export class EquipmentApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Get equipment
   * @description This resource allows the client to view the list of a user's equipment. It can be called with a filter for specific organizations, machine or implement types, but can also be called without a filter to provide a list of all equipment accessible by the user across each organization the user has access to. Equipment will only be returned from organizations the user has access to and are connected to the calling application. If the client requests multiple organizations in the filter, and a user or the client does not have access to that organization, the entire response will be a 403 Forbidden. Please see the OAuth 2 documentation for more details on obtaining a user token and connecting the user’s organizations to your application..
   * @generated from GET /equipment
   */
  async get(
    params?: {
      ids?: number[];
      serialNumbers?: string[];
      organizationIds?: number[];
      principalIds?: number[];
      capableOf?: 'Connectivity' | '!Connectivity';
      categories?: 'Machine' | 'Implement';
      organizationRoleType?: 'Controlling' | 'NonControlling';
      archived?: boolean;
      embed?: 'devices' | 'equipment' | 'icon' | 'pairingDetails';
      pageOffset?: number;
      itemLimit?: number;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipmentForList']>> {
    const query = new URLSearchParams();
    if (params?.ids !== undefined) query.set('ids', String(params.ids));
    if (params?.serialNumbers !== undefined)
      query.set('serialNumbers', String(params.serialNumbers));
    if (params?.organizationIds !== undefined)
      query.set('organizationIds', String(params.organizationIds));
    if (params?.principalIds !== undefined) query.set('principalIds', String(params.principalIds));
    if (params?.capableOf !== undefined) query.set('capableOf', String(params.capableOf));
    if (params?.categories !== undefined) query.set('categories', String(params.categories));
    if (params?.organizationRoleType !== undefined)
      query.set('organizationRole.type', String(params.organizationRoleType));
    if (params?.archived !== undefined) query.set('archived', String(params.archived));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.pageOffset !== undefined) query.set('pageOffset', String(params.pageOffset));
    if (params?.itemLimit !== undefined) query.set('itemLimit', String(params.itemLimit));
    const queryString = query.toString();
    const path = `/equipment${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['equipmentForList']>>(
      path,
      options
    );
  }

  /**
   * Create equipment
   * @description This resource allows the client to create a piece of equipment within a user’s organization. Getting Started The process of contributing equipment to John Deere can be broken down into three primary steps. Determine the Equipment’s model IDs Create the Equipment Contribute Measurements. Please see the for more information on uploading measurements for the created equipment. Determining the Equipment’s model Call the GET /equipmentMakes API endpoint to get a list of all equipment makes and a respective “id” of the equipment make you require. Call the GET /equipmentMakes/{id}/equipmentISGTypes endpoint to get a list of associated equipment ISG types for that specific equipment make and obtain a respective “id” for a specific ISG type you require. Call the GET /equipmentMakes/{id}/equipmentISGTypes/{id}/equipmentModels to obtain the final “id” of the equipment model you require. Alternatively, you may call the GET /equipmentModels endpoint if you know the model name you are searching for. For example /equipmentModels?equipmentModelName=9RX*&embed=make,isgType which will include all models with search string results and include make and isgType “id” as well as model “id”. Creating the Equipment Make a POST request to the /organizations/{orgId}/equipment API to create the piece of equipment in the user’s org. In this request you will provide the type of the equipment, a serialNumber (optional), name (displayed to the user in Operations Center), and the equipment model IDs. type: Machine or Implement serialNumber: A string identifier that is 30 characters or fewer. Must be unique within an organization. name: The name displayed in Operation Center, 30 characters or fewer. Must be unique within an organization. model: The id for the Model of the vehicle, found from the API in the previous step of this document. A successful POST will result in a 201 Created response. The “location” header in the response will contain the URI to the new equipment, with the final segment being the organization specific machine ID (ie “https://equipmentapi.deere.com/isg/equipment/12345” is a link to the machine 12345). If you attempt to create a machine with a serialNumber that already exists in that organization, you get a response code 400 Bad Request. The body will include the error information.
   * @generated from POST /organizations/{organizationId}/equipment
   */
  async create(
    organizationId: string,
    data: components['schemas']['createEquipment'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/equipment`;
    await this.client.post(path, data, options);
  }

  /**
   * View equipment details by Id
   * @description This resource allows the client to view the details of one piece of equipment.
   * @generated from GET /equipment/{id}
   */
  async getEquipment(
    id: string,
    params?: {
      embed?: 'devices' | 'equipment' | 'pairingDetails' | 'icon' | 'offsets' | 'capabilities';
    },
    options?: RequestOptions
  ): Promise<components['schemas']['equipment']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/equipment/${id}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['equipment']>(path, options);
  }

  /**
   * Update equipment
   * @description This resource allows the client to update a piece of equipment within a user’s organization. Clients will only be able to update a piece of equipment that was contributed via the POST /equipment API. John Deere controlled equipment can only be managed via the Equipment application in Operations Center.
   * @generated from PUT /equipment/{id}
   */
  async update(id: string, data: Record<string, unknown>, options?: RequestOptions): Promise<void> {
    const path = `/equipment/${id}`;
    await this.client.put(path, data, options);
  }

  /**
   * Delete equipment
   * @description This resource allows the client to delete a piece of equipment within a user’s organization. Clients will only be able to delete a piece of equipment that was contributed via the POST /equipment API. John Deere controlled equipment can only be managed via the Equipment application in Operations Center.
   * @generated from DELETE /equipment/{id}
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    const path = `/equipment/${id}`;
    await this.client.delete(path, options);
  }

  /**
   * Get equipment makes
   * @description This resource allows the client to view equipment makes and their associated IDs and names.
   * @generated from GET /equipmentMakes
   */
  async list(
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-make']>> {
    const path = `/equipmentMakes`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-make']>>(
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /equipmentMakes
   */
  async listAll(options?: RequestOptions): Promise<components['schemas']['equipment-make'][]> {
    const path = `/equipmentMakes`;
    return this.client.getAll<components['schemas']['equipment-make']>(path, options);
  }

  /**
   * View equipment by make Id
   * @description This resource allows the client to view equipment makes by an equipment make ID.
   * @generated from GET /equipmentMakes/{equipmentMakeId}
   */
  async getEquipmentmakes(
    equipmentMakeId: string,
    options?: RequestOptions
  ): Promise<components['schemas']['equipment-make']> {
    const path = `/equipmentMakes/${equipmentMakeId}`;
    return this.client.get<components['schemas']['equipment-make']>(path, options);
  }

  /**
   * Get equipment types by make id
   * @description This resource allows the client to view equipment types by providing an equipment make ID.
   * @generated from GET /equipmentMakes/{equipmentMakeId}/equipmentTypes
   */
  async getEquipmenttypes(
    equipmentMakeId: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-type']>> {
    const path = `/equipmentMakes/${equipmentMakeId}/equipmentTypes`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-type']>>(
      path,
      options
    );
  }

  /**
   * Get equipment types
   * @description This resource allows the client to view equipment types and their associated IDs and names.
   * @generated from GET /equipmentTypes
   */
  async listEquipmenttypes(
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-type']>> {
    const path = `/equipmentTypes`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-type']>>(
      path,
      options
    );
  }

  /**
   * Get equipment models
   * @description This resource allows the client to view equipment models in our reference database and their associated IDs and names.
   * @generated from GET /equipmentModels
   */
  async listEquipmentmodels(
    params?: {
      embed?: 'make' | 'type' | 'isgType';
      equipmentModelName?: 'string or partial string with * wildcard search';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-model']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.equipmentModelName !== undefined)
      query.set('equipmentModelName', String(params.equipmentModelName));
    const queryString = query.toString();
    const path = `/equipmentModels${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-model']>>(
      path,
      options
    );
  }

  /**
   * Get equipment ISG types
   * @description This operation retrieves a list of Equipment ISG Types based on the supplied query parameters.
   * @generated from GET /equipmentISGTypes
   */
  async listEquipmentisgtypes(
    params?: {
      category?: 'machine' | 'implement';
      deprecated?: 'false' | 'true' | 'all';
      embed?: 'equipmentModels' | 'recordMetadata';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-isg-type']>> {
    const query = new URLSearchParams();
    if (params?.category !== undefined) query.set('category', String(params.category));
    if (params?.deprecated !== undefined) query.set('deprecated', String(params.deprecated));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/equipmentISGTypes${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-isg-type']>>(
      path,
      options
    );
  }

  /**
   * Get equipment ISG types by make id
   * @description This operation retrieves a list of Equipment ISG Types for given makeId.
   * @generated from GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes
   */
  async getEquipmentisgtypes(
    equipmentMakeId: string,
    params?: {
      deprecated?: 'false' | 'true' | 'all';
      embed?: 'equipmentModels' | 'recordMetadata';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-isg-type']>> {
    const query = new URLSearchParams();
    if (params?.deprecated !== undefined) query.set('deprecated', String(params.deprecated));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/equipmentMakes/${equipmentMakeId}/equipmentISGTypes${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-isg-type']>>(
      path,
      options
    );
  }

  /**
   * Get equipment ISG type by make id and ISG type id
   * @description This operation retrieves a single Equipment ISG Type for given makeId and isgTypeId..
   * @generated from GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes/{equipmentISGTypeId}
   */
  async getEquipmentisgtypes2(
    equipmentMakeId: string,
    equipmentISGTypeId: string,
    params?: { embed?: 'equipmentModels' | 'recordMetadata' },
    options?: RequestOptions
  ): Promise<components['schemas']['equipment-isg-type']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/equipmentMakes/${equipmentMakeId}/equipmentISGTypes/${equipmentISGTypeId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['equipment-isg-type']>(path, options);
  }

  /**
   * Get equipment models by make id and ISG type id
   * @description This operation retrieves a list of Equipment Models based on given makeId and ISGtypeId.
   * @generated from GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes/{equipmentISGTypeId}/equipmentModels
   */
  async getEquipmentmodels(
    equipmentMakeId: string,
    equipmentISGTypeId: string,
    params?: { deprecated?: 'false' | 'true' | 'all'; organizationIds?: number[] },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['equipment-model']>> {
    const query = new URLSearchParams();
    if (params?.deprecated !== undefined) query.set('deprecated', String(params.deprecated));
    if (params?.organizationIds !== undefined)
      query.set('organizationIds', String(params.organizationIds));
    const queryString = query.toString();
    const path = `/equipmentMakes/${equipmentMakeId}/equipmentISGTypes/${equipmentISGTypeId}/equipmentModels${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['equipment-model']>>(
      path,
      options
    );
  }

  /**
   * Get equipment model by make id, ISG type id and model id
   * @description This operation retrieves a single Equipment Model based on given makeId, isgTypeId and modelId.
   * @generated from GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes/{equipmentISGTypeId}/equipmentModels/{equipmentModelId}
   */
  async getEquipmentmodels2(
    equipmentMakeId: string,
    equipmentISGTypeId: string,
    equipmentModelId: string,
    options?: RequestOptions
  ): Promise<components['schemas']['equipment-model']> {
    const path = `/equipmentMakes/${equipmentMakeId}/equipmentISGTypes/${equipmentISGTypeId}/equipmentModels/${equipmentModelId}`;
    return this.client.get<components['schemas']['equipment-model']>(path, options);
  }
}

// Re-export types for convenience
export type { components as EquipmentTypes } from '../types/generated/equipment.js';
