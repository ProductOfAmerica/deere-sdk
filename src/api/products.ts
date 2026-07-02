/**
 * ProductsApi
 *
 * Auto-generated SDK wrapper for John Deere products API.
 * @generated from products.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/products.js';

export class ProductsApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'products';

  constructor(private readonly client: DeereClient) {}

  /**
   * List of available active ingredients
   * @description Returns a list of all available active ingredients.
   * @generated from GET /activeIngredients
   */
  async listActiveIngredients(
    params?: { entityType?: 'CHEMICAL' | 'FERTILIZER' },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ActiveIngredient']>> {
    const query = new URLSearchParams();
    if (params?.entityType !== undefined) query.set('entityType', String(params.entityType));
    const queryString = query.toString();
    const path = `/activeIngredients${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ActiveIngredient']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Reference list of all known chemicals
   * @description List of all chemicals from industry data sources, such as
   * CDMS.
   * @generated from GET /chemicals
   */
  async listChemicals(
    params?: {
      searchString?: string;
      chemicalType?:
        | 'ADDITIVE'
        | 'ADJUVANT'
        | 'DEFOLIANT'
        | 'FUNGICIDE'
        | 'GROWTH_REGULATOR'
        | 'HERBICIDE'
        | 'INSECTICIDE'
        | 'NITROGEN_STABILIZER';
      productName?: string;
      brandName?: string;
      registration?: string;
      sourceSystemProductId?: string;
      countryCode?: string;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ReferenceChemical']>> {
    const query = new URLSearchParams();
    if (params?.searchString !== undefined) query.set('searchString', String(params.searchString));
    if (params?.chemicalType !== undefined) query.set('chemicalType', String(params.chemicalType));
    if (params?.productName !== undefined) query.set('productName', String(params.productName));
    if (params?.brandName !== undefined) query.set('brandName', String(params.brandName));
    if (params?.registration !== undefined) query.set('registration', String(params.registration));
    if (params?.sourceSystemProductId !== undefined)
      query.set('sourceSystemProductId', String(params.sourceSystemProductId));
    if (params?.countryCode !== undefined) query.set('countryCode', String(params.countryCode));
    const queryString = query.toString();
    const path = `/chemicals${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ReferenceChemical']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Get a single reference chemical
   * @description Single chemical from industry data sources, such as CDMS.
   * @generated from GET /chemicals/{erid}
   */
  async getChemicals(
    erid: string,
    options?: RequestOptions
  ): Promise<components['schemas']['ReferenceChemical']> {
    const path = `/chemicals/${erid}`;
    return this.client.get<components['schemas']['ReferenceChemical']>(this.spec, path, options);
  }

  /**
   * Adds a single reference chemical to organization
   * @description This endpoint will associate a reference chemical to your
   * organization from the global reference list. The reference chemicals are
   * immutable, however, they can still be archived or made available. If a
   * reference chemical is created as a carrier, it cannot be changed
   * thereafter. The registration of a reference chemical can also be updated.
   * The response headers from the GET endpoints will include the attributes
   * that can be overridden.
   * @generated from POST /chemicals/{erid}/associateToOrg/{organizationId}
   */
  async createAssociateToOrg(
    erid: string,
    organizationId: string,
    data: components['schemas']['PostReferenceChemical'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/chemicals/${erid}/associateToOrg/${organizationId}`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Reference list of documents for an associated chemical
   * @description List of all the documents for a chemical from industry data
   * sources, such as CDMS.
   * @generated from GET /chemicals/{erid}/documents
   */
  async listChemicalsDocuments(
    erid: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Document_Chemicals']>> {
    const path = `/chemicals/${erid}/documents`;
    return this.client.get<PaginatedResponse<components['schemas']['Document_Chemicals']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Sets organizational attributes such as isCarrier, archived, registration, etc
   * @description This endpoint will set attribute overrides while importing a
   * reference chemical to your organization. The reference chemicals are
   * immutable, however, they can still be archived or made available. Once set
   * to true, the carrier attribute cannot be set to false. The registration of
   * a reference chemical can be updated. The response headers from the GET
   * endpoints will include the attributes that can be overridden.
   * @generated from PATCH /chemicals/{erid}/setOverridesForOrg/{organizationId}
   */
  async patchSetOverridesForOrg(
    erid: string,
    organizationId: string,
    data: components['schemas']['CommonReferenceChemical'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/chemicals/${erid}/setOverridesForOrg/${organizationId}`;
    await this.client.patch(this.spec, path, data, options);
  }

  /**
   * Document details w/ pdf file
   * @description Document details for a product with embedded pdf file
   * (gzip+base64).
   * @generated from GET /documents/{erid}
   */
  async getDocuments(
    erid: string,
    options?: RequestOptions
  ): Promise<components['schemas']['DocumentWithPdfFile']> {
    const path = `/documents/${erid}`;
    return this.client.get<components['schemas']['DocumentWithPdfFile']>(this.spec, path, options);
  }

  /**
   * Reference list of all known fertilizers
   * @description List of all fertilizers from industry data sources, such as
   * CDMS.
   * @generated from GET /fertilizers
   */
  async listFertilizers(
    params?: {
      searchString?: string;
      fertilizerType?: 'FERTILIZER' | 'MANURE';
      productName?: string;
      brandName?: string;
      registration?: string;
      sourceSystemProductId?: string;
      countryCode?: string;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ReferenceFertilizer']>> {
    const query = new URLSearchParams();
    if (params?.searchString !== undefined) query.set('searchString', String(params.searchString));
    if (params?.fertilizerType !== undefined)
      query.set('fertilizerType', String(params.fertilizerType));
    if (params?.productName !== undefined) query.set('productName', String(params.productName));
    if (params?.brandName !== undefined) query.set('brandName', String(params.brandName));
    if (params?.registration !== undefined) query.set('registration', String(params.registration));
    if (params?.sourceSystemProductId !== undefined)
      query.set('sourceSystemProductId', String(params.sourceSystemProductId));
    if (params?.countryCode !== undefined) query.set('countryCode', String(params.countryCode));
    const queryString = query.toString();
    const path = `/fertilizers${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ReferenceFertilizer']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Single reference fertilizer
   * @description Single fertilizer from industry data sources, such as CDMS.
   * @generated from GET /fertilizers/{erid}
   */
  async getFertilizers(
    erid: string,
    options?: RequestOptions
  ): Promise<components['schemas']['ReferenceFertilizer']> {
    const path = `/fertilizers/${erid}`;
    return this.client.get<components['schemas']['ReferenceFertilizer']>(this.spec, path, options);
  }

  /**
   * Adds a single reference fertilizer to organization
   * @description This endpoint will associate a reference fertilizer to your
   * organization from the global reference list. The reference fertilizers are
   * immutable, however, they can still be archived or made available. If a
   * reference fertilizer is created as a carrier, it cannot be changed
   * thereafter. The registration of a reference fertilizer can also be updated.
   * The response headers from the GET endpoints will include the attributes
   * that can be overridden.
   * @generated from POST /fertilizers/{erid}/associateToOrg/{organizationId}
   */
  async createFertilizersAssociateToOrg(
    erid: string,
    organizationId: string,
    data: components['schemas']['PostReferenceFertilizer'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/fertilizers/${erid}/associateToOrg/${organizationId}`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Reference list of documents for an associated fertilizer
   * @description List of all the documents for a fertilizer from industry data
   * sources, such as CDMS.
   * @generated from GET /fertilizers/{erid}/documents
   */
  async listFertilizersDocuments(
    erid: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Document']>> {
    const path = `/fertilizers/${erid}/documents`;
    return this.client.get<PaginatedResponse<components['schemas']['Document']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Sets organizational attributes such as isCarrier, archived, registration, etc
   * @description This endpoint will set attribute overrides while importing a
   * reference fertilizer to your organization. The reference fertilizers are
   * immutable, however, they can still be archived or made available. Once set
   * to true, the carrier attribute cannot be set to false. The registration of
   * a reference fertilizer can be updated. The response headers from the GET
   * endpoints will include the attributes that can be overridden.
   * @generated from PATCH /fertilizers/{erid}/setOverridesForOrg/{organizationId}
   */
  async patchFertilizersSetOverridesForOrg(
    erid: string,
    organizationId: string,
    data: components['schemas']['CommonPostReferenceFertilizer'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/fertilizers/${erid}/setOverridesForOrg/${organizationId}`;
    await this.client.patch(this.spec, path, data, options);
  }

  /**
   * Retrieve unified list of custom and reference chemicals in your organization.
   * @generated from GET /organizations/{organizationId}/chemicals
   */
  async listOrganizationsChemicals(
    organizationId: string,
    params?: {
      status?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
      embed?: 'activeIngredients' | 'availableRegistrations' | 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Chemical']>> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/chemicals${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['Chemical']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Add chemical
   * @description This endpoint will add a custom chemical into the
   * organization. Its name+type must be unique within your organization, unless
   * carrier is set to true. If carrier is set to true, then type is
   * disregarded. A chemical's carrier property cannot be changed to false once
   * set to true. A chemical cannot be archived if it is in an active tank mix
   * or dry blend. If a chemical is marked as archived and is used in a tank
   * mix/dry blend, if the tank mix/dry blend is made available, then this
   * chemical will also be made available. If passing in a liquid weight or
   * weight unit, material classification should be set to LIQUID. Additionally,
   * POST can be used for supporting offline creation of chemicals from e.g. a
   * mobile app, by sending a payload with an `id` generated by the client. If
   * an `id` is present in the payload, the service checks the database for that
   * `id`. In case no record is found, a new one is created with that `id` and
   * the request is responded with 201. Otherwise no creation happens and the
   * request is responded with 409 and error message that a resource with that
   * `id` already exists.
   * @generated from POST /organizations/{organizationId}/chemicals
   */
  async createChemicals(
    organizationId: string,
    data: components['schemas']['PostChemical'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/chemicals`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Retrieve a specific chemical from an organization's asset list.
   * @generated from GET /organizations/{organizationId}/chemicals/{erid}
   */
  async getOrganizationsChemicals(
    organizationId: string,
    erid: string,
    params?: {
      embed?: 'activeIngredients' | 'availableRegistrations' | 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<components['schemas']['Chemical']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/chemicals/${erid}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['Chemical']>(this.spec, path, options);
  }

  /**
   * Update a single chemical
   * @description Allows the custom chemical to be renamed, made
   * active/archived, or flagged as a carrier.
   * @generated from PUT /organizations/{organizationId}/chemicals/{erid}
   */
  async updateChemicals(
    organizationId: string,
    erid: string,
    data: components['schemas']['PutChemical'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/chemicals/${erid}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Retrieve dry blends for an org
   * @generated from GET /organizations/{organizationId}/dryBlends
   */
  async listDryBlends(
    organizationId: string,
    params?: { embed?: 'product' },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['DryBlend']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/dryBlends${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['DryBlend']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Create a dry blend
   * @description Add a dry blend to the asset list of an organization. Any
   * chemicals or fertilizers in the dry blend must exist in the organization
   * before the dry blend is persisted. The name of the dry blend must be unique
   * in your organization. Additionally, POST can be used for supporting offline
   * creation of dry blends from e.g. a mobile app, by sending a payload with an
   * `erid` generated by the client. If an `erid` is present in the payload, the
   * service checks the database for that `erid`. In case no record is found, a
   * new one is created with that `erid` and the request is responded with 201.
   * Otherwise no creation happens and the request is responded with 409 and
   * error message that a resource with that `erid` already exists.
   * @generated from POST /organizations/{organizationId}/dryBlends
   */
  async createDryBlends(
    organizationId: string,
    data: components['schemas']['PostDryBlend'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/dryBlends`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Retrieves a specific dry blend
   * @generated from GET /organizations/{organizationId}/dryBlends/{erid}
   */
  async getDryBlends(
    organizationId: string,
    erid: string,
    params?: { embed?: 'product' },
    options?: RequestOptions
  ): Promise<components['schemas']['DryBlend']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/dryBlends/${erid}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['DryBlend']>(this.spec, path, options);
  }

  /**
   * Update a dry blend
   * @description Allows updates to be made to the name, archival status, and
   * components of a dry blend.
   * @generated from PUT /organizations/{organizationId}/dryBlends/{erid}
   */
  async updateDryBlends(
    organizationId: string,
    erid: string,
    data: components['schemas']['PostDryBlend'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/dryBlends/${erid}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Retrieve unified list of custom and reference fertilizers in your organization.
   * @generated from GET /organizations/{organizationId}/fertilizers
   */
  async listOrganizationsFertilizers(
    organizationId: string,
    params?: {
      status?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
      embed?: 'activeIngredients' | 'availableRegistrations' | 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Fertilizer_Fertilizers']>> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/fertilizers${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['Fertilizer_Fertilizers']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Add fertilizer
   * @description This endpoint will add a custom fertilizer into the
   * organization. Its name+type must be unique within your organization, unless
   * carrier is set to true. If carrier is set to true, then type is
   * disregarded. A fertilizer's carrier property cannot be changed to false
   * once set to true. A fertilizer cannot be archived if it is in an active
   * tank mix or dry blend. If a fertilizer is marked as archived and is used in
   * a tank mix/dry blend, if the tank mix/dry blend is made available, then
   * this fertilizer will also be made available. If passing in a liquid weight
   * or weight unit, material classification should be set to LIQUID.
   * Additionally, POST can be used for supporting offline creation of
   * fertilizers from e.g. a mobile app, by sending a payload with an `id`
   * generated by the client. If an `id` is present in the payload, the service
   * checks the database for that `id`. In case no record is found, a new one is
   * created with that `id` and the request is responded with 201. Otherwise no
   * creation happens and the request is responded with 409 and error message
   * that a resource with that `id` already exists.
   * @generated from POST /organizations/{organizationId}/fertilizers
   */
  async createFertilizers(
    organizationId: string,
    data: components['schemas']['PostFertilizer'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/fertilizers`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Retrieve a specific fertilizer from an organization's asset list.
   * @generated from GET /organizations/{organizationId}/fertilizers/{erid}
   */
  async getOrganizationsFertilizers(
    organizationId: string,
    erid: string,
    params?: {
      embed?: 'activeIngredients' | 'availableRegistrations' | 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<components['schemas']['Fertilizer_Fertilizers']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/fertilizers/${erid}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['Fertilizer_Fertilizers']>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Update a single fertilizer
   * @description Allows the fertilizer custom to be renamed, made
   * active/archived, or flagged as a carrier.
   * @generated from PUT /organizations/{organizationId}/fertilizers/{erid}
   */
  async updateFertilizers(
    organizationId: string,
    erid: string,
    data: components['schemas']['PutFertilizer'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/fertilizers/${erid}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Retrieve product companies for an org.
   * @description A unified list of custom and reference product companies in
   * your organization.
   * @generated from GET /organizations/{organizationId}/productCompanies
   */
  async listProductCompanies(
    organizationId: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<unknown>> {
    const path = `/organizations/${organizationId}/productCompanies`;
    return this.client.get<PaginatedResponse<unknown>>(this.spec, path, options);
  }

  /**
   * Retrieve tank mixes for an org
   * @description This endpoint will retrieve tank mixes for an org.
   * @generated from GET /organizations/{organizationId}/tankMixes
   */
  async listTankMixes(
    organizationId: string,
    params?: { embed?: 'chemical'; recordFilter?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['TankMixCollection']>> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.recordFilter !== undefined) query.set('recordFilter', String(params.recordFilter));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/tankMixes${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['TankMixCollection']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Create a tank mix
   * @description Add a tank mix to the asset list of an organization. Any
   * chemicals or fertilizers in the tank mix must exist in the organization
   * before the tank mix is persisted. The name of the tank mix must be unique
   * in your organization. Additionally, POST can be used for supporting offline
   * creation of tank mixes from e.g. a mobile app, by sending a payload with an
   * `orgUniqueErid` generated by the client. If an `orgUniqueErid` is present
   * in the payload, the service checks the database for that `orgUniqueErid`.
   * In case no record is found, a new one is created with that `orgUniqueErid`
   * and the request is responded with 201. Otherwise no creation happens and
   * the request is responded with 409 and error message that a resource with
   * that `orgUniqueErid` already exists.
   * @generated from POST /organizations/{organizationId}/tankMixes
   */
  async createTankMixes(
    organizationId: string,
    data: components['schemas']['TankMix'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/tankMixes`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * View a specific tank mix
   * @description This endpoint will retrieve a specific tank mix.
   * @generated from GET /organizations/{organizationId}/tankMixes/{id}
   */
  async getTankMixes(
    organizationId: string,
    id: string,
    params?: { embed?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['TankMixCollection']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/tankMixes/${id}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['TankMixCollection']>(this.spec, path, options);
  }

  /**
   * Update a tank mix
   * @description This endpoint allows to update the metadata and the
   * composition of a tank mix.
   * @generated from PUT /organizations/{organizationId}/tankMixes/{id}
   */
  async updateTankMixes(
    organizationId: string,
    id: string,
    data: components['schemas']['TankMix'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/tankMixes/${id}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * View varieties for an org
   * @description This endpoint will retrieve a collection of varieties for the
   * specified org.
   * @generated from GET /organizations/{organizationId}/varieties
   */
  async list(
    organizationId: string,
    params?: {
      status?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
      embed?: 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Variety']>> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/varieties${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['Variety']>>(
      this.spec,
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{organizationId}/varieties
   */
  async listAll(
    organizationId: string,
    params?: {
      status?: 'AVAILABLE' | 'ARCHIVED' | 'ALL';
      embed?: 'documents' | 'showMergedProducts';
    },
    options?: RequestOptions
  ): Promise<components['schemas']['Variety'][]> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set('status', String(params.status));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/varieties${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['Variety']>(this.spec, path, options);
  }

  /**
   * Add a variety
   * @description This endpoint will add a custom variety into the organization.
   * Its name+cropName must be unique within your organization. Its crop name
   * must be a supported crop name (see /cropTypes). There are a number of crop
   * names that are deprecated in the system. If the crop name is set to one of
   * these, then it will be mapped to its corresponding valid crop name.
   * Additionally, POST can be used for supporting offline creation of varieties
   * from e.g. a mobile app, by sending a payload with an `id` generated by the
   * client. If an `id` is present in the payload, the service checks the
   * database for that `id`. In case no record is found, a new one is created
   * with that `id` and the request is responded with 201. Otherwise no creation
   * happens and the request is responded with 409 and error message that a
   * resource with that `id` already exists.
   * @generated from POST /organizations/{organizationId}/varieties
   */
  async create(
    organizationId: string,
    data: components['schemas']['PostVariety'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/varieties`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * View a specific variety
   * @description This endpoint will return the variety with the specified erid.
   * @generated from GET /organizations/{organizationId}/varieties/{erid}
   */
  async get(
    organizationId: string,
    erid: string,
    params?: { embed?: 'documents' | 'showMergedProducts' },
    options?: RequestOptions
  ): Promise<components['schemas']['Variety']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/organizations/${organizationId}/varieties/${erid}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['Variety']>(this.spec, path, options);
  }

  /**
   * Update a single variety
   * @description This endpoint allows the custom variety to be renamed, made
   * active/archived, or associated to a different manufacturer or crop type.
   * @generated from PUT /organizations/{organizationId}/varieties/{erid}
   */
  async update(
    organizationId: string,
    erid: string,
    data: components['schemas']['PutVariety'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${organizationId}/varieties/${erid}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Search reference catalog varieties
   * @description This endpoint searches the reference catalog for varieties
   * that match the given search criteria. This data can be used in a subsequent
   * request to create a variety in an organization. Results are limited to 100
   * items.
   * @generated from GET /varieties
   */
  async listVarieties(
    params?: {
      searchString?: string;
      cropName?: string;
      productName?: string;
      brandName?: string;
      sourceSystemProductId?: string;
      countryCode?: string;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['ReferenceVariety']>> {
    const query = new URLSearchParams();
    if (params?.searchString !== undefined) query.set('searchString', String(params.searchString));
    if (params?.cropName !== undefined) query.set('cropName', String(params.cropName));
    if (params?.productName !== undefined) query.set('productName', String(params.productName));
    if (params?.brandName !== undefined) query.set('brandName', String(params.brandName));
    if (params?.sourceSystemProductId !== undefined)
      query.set('sourceSystemProductId', String(params.sourceSystemProductId));
    if (params?.countryCode !== undefined) query.set('countryCode', String(params.countryCode));
    const queryString = query.toString();
    const path = `/varieties${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['ReferenceVariety']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Get a single reference variety.
   * @description Single variety from industry data sources, such as CDMS.
   * @generated from GET /varieties/{erid}
   */
  async getVarieties(
    erid: string,
    options?: RequestOptions
  ): Promise<components['schemas']['ReferenceVariety']> {
    const path = `/varieties/${erid}`;
    return this.client.get<components['schemas']['ReferenceVariety']>(this.spec, path, options);
  }

  /**
   * Adds a single reference variety to organization
   * @description This endpoint will associate a reference variety to your
   * organization from the global reference list. The reference varieties are
   * immutable, however, they can still be archived or made available. The
   * response headers from the GET endpoints will include the attributes that
   * can be overridden.
   * @generated from POST /varieties/{erid}/associateToOrg/{organizationId}
   */
  async createAssociatetoorg(
    erid: string,
    organizationId: string,
    data: components['schemas']['ReferenceProductPointerRequest'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/varieties/${erid}/associateToOrg/${organizationId}`;
    await this.client.post(this.spec, path, data, options);
  }

  /**
   * Reference list of documents for an associated seed variety.
   * @description List of all the documents for a variety from industry data
   * sources, such as CDMS.
   * @generated from GET /varieties/{erid}/documents
   */
  async listDocuments(
    erid: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['Document']>> {
    const path = `/varieties/${erid}/documents`;
    return this.client.get<PaginatedResponse<components['schemas']['Document']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Sets organizational attributes such as isCarrier, archived, registration, etc.
   * @description This endpoint will set attribute overrides while importing a
   * reference variety to your organization. The reference varieties are
   * immutable, however, they can still be archived or made available. The
   * response headers from the GET endpoints will include the attributes that
   * can be overridden.
   * @generated from PATCH /varieties/{erid}/setOverridesForOrg/{organizationId}
   */
  async patch(
    erid: string,
    organizationId: string,
    data: components['schemas']['CommonProductPointerRequest'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/varieties/${erid}/setOverridesForOrg/${organizationId}`;
    await this.client.patch(this.spec, path, data, options);
  }
}

// Re-export types for convenience
export type { components as ProductsTypes } from '../types/generated/products.js';
