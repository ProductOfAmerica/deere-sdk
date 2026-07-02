/**
 * FieldOperationsApi
 *
 * Auto-generated SDK wrapper for John Deere field-operations-api API.
 * @generated from field-operations-api.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/field-operations-api.js';

export class FieldOperationsApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'field-operations-api';

  constructor(private readonly client: DeereClient) {}

  /**
   * View a Field Operation
   * @description View a single field operation. The response will include links
   * to: organization: The organization which owns this data. field: The field
   * in which this operation was performed. self: The field operation.
   * @generated from GET /fieldOperations/{operationId}
   */
  async get(
    operationId: string,
    params?: { embed?: 'measurementTypes' },
    options?: RequestOptions
  ): Promise<components['schemas']['FieldOperationId']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/fieldOperations/${operationId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['FieldOperationId']>(this.spec, path, options);
  }

  /**
   * Field Operation Measurements
   * @description Field Operations include a variety of measurements collected
   * when the operation is performed in the field. This endpoint returns an
   * array of measurement types available for a given field operation. Two
   * categories of measurements are available today: Target: Target measurements
   * refer to what the machine or implement attempted to perform in the field.
   * Result: Result measurements refer to what the machine or implement actually
   * accomplished in the field. For example, the SeedingRateTarget measurement
   * describes the rate at which the equipment attempted to plant seeds, while
   * the SeedingRateResult measurement describes the rate at which seeds were
   * actually planted by the equipment. Target measurements may be consistent
   * throughout the entire operation (the operator may have applied a single
   * rate across an entire field) but result measurements will vary during the
   * operation as they account for machine error, operator error, and
   * environmental factors. The difference in rate and location are easily
   * visible in the associated map image. Note: The values included in the
   * responses will depend on their availability as well as the field operation
   * type (Seeding, Application Tank Mix, Application Single Product, Harvest
   * Yield Contour, or Harvest Yield Result). Please refer . "carting"
   * operations as well as construction operations "constructionmilling",
   * "constructionpaving", "constructioncompacting", "constructioncrushing",
   * "constructionstabilizingrecycling" are not supported at this time.
   * @generated from GET /fieldOperations/{operationId}/measurementTypes
   */
  async listMeasurementTypes(
    operationId: string,
    options?: RequestOptions
  ): Promise<PaginatedResponse<unknown>> {
    const path = `/fieldOperations/${operationId}/measurementTypes`;
    return this.client.get<PaginatedResponse<unknown>>(this.spec, path, options);
  }

  /**
   * Field Operation Measurement
   * @description Field Operations include a variety of measurements collected
   * when the operation is performed in the field. This endpoint returns an
   * array of measurement types available for a given field operation. Two
   * categories of measurements are available today: Target: Target measurements
   * refer to what the machine or implement attempted to perform in the field.
   * Result: Result measurements refer to what the machine or implement actually
   * accomplished in the field. For example, the SeedingRateTarget measurement
   * describes the rate at which the equipment attempted to plant seeds, while
   * the SeedingRateResult measurement describes the rate at which seeds were
   * actually planted by the equipment. Target measurements may be consistent
   * throughout the entire operation (the operator may have applied a single
   * rate across an entire field) but result measurements will vary during the
   * operation as they account for machine error, operator error, and
   * environmental factors. The difference in rate and location are easily
   * visible in the associated map image. Note: The values included in the
   * responses will depend on their availability as well as the field operation
   * type (Seeding, Application Tank Mix, Application Single Product, Harvest
   * Yield Contour, or Harvest Yield Result). To view the different responses
   * for each field operation type, view the documentation above. Please refer
   * Note: This API has two possible accept headers. One will give a response
   * with totals, and the other will give a response with a Base64 encoded
   * image. For the image layer, A map image is available for each measurement
   * offering a visual depiction of the data. Argonomic data points are grouped
   * either by label (such as variety name) or numerical range, and this
   * information provided in the JSON response as a map legend.
   * @generated from GET /fieldOperations/{operationId}/measurementTypes/{measurementType}
   */
  async getMeasurementTypes(
    operationId: string,
    measurementType: string,
    options?: RequestOptions
  ): Promise<components['schemas']['FieldOperationMeasurementType']> {
    const path = `/fieldOperations/${operationId}/measurementTypes/${measurementType}`;
    return this.client.get<components['schemas']['FieldOperationMeasurementType']>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Asynchronous Shapefile Download
   * @description An ESRI Shapefile is available for each Field Operation.
   * Please see the for details on the shapefile format and how to consume it.
   * The expected response codes are: 202 Accepted – The request was received
   * and is being processed. Call back later to check for completion. This API
   * does not currently support webhooks. To check for completion, repeat the
   * same API call until you get an HTTP 307. Processing may take up to 30
   * minutes, depending on the size of data. Applications should poll the API
   * using a backoff loop. Polling intervals should start at 5 seconds and
   * double with each attempt: secondsToWait = 5 * 2 ^ (numberOfAttempts - 1)
   * 307 Temporary Redirect – The shapefile is ready to download. This response
   * contains a location header. The location is a pre-signed URL that is valid
   * for no less than one hour. To download the file, perform a GET request to
   * the URL in the location header. Do not apply OAuth signing or other
   * authorization to this request - it will cause the call to fail. 406 Not
   * Acceptable - A shapefile cannot be generated. Note the initial call for a
   * shapefile may receive either a 202 or a 307 response, depending upon
   * whether an up-to-date file already exists for the specified field
   * operation. For a sample integration, see our .
   * @generated from GET /fieldOps/{operationId}
   */
  async getFieldops(
    operationId: string,
    params?: {
      splitShapeFile?: boolean;
      shapeType?: 'Point' | 'Polygon';
      resolution?: 'EachSection' | 'EachSensor' | 'OneHertz';
    },
    options?: RequestOptions
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.splitShapeFile !== undefined)
      query.set('splitShapeFile', String(params.splitShapeFile));
    if (params?.shapeType !== undefined) query.set('shapeType', String(params.shapeType));
    if (params?.resolution !== undefined) query.set('resolution', String(params.resolution));
    const queryString = query.toString();
    const path = `/fieldOps/${operationId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(this.spec, path, options);
  }

  /**
   * List Field Operations
   * @description This resource returns logical data structures representing the
   * agronomic operations performed in a field. Supported field operation types
   * include Seeding, Application, and Harvest. A single field operation may
   * potentially span consecutive days depending on the type of operation. Each
   * field operation may have one or more measurements, listed as links from the
   * field operation itself. Each field operation will include links to:
   * organization: The organization which owns this data. field: The field in
   * which this operation was performed. self: The field operation.
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/fieldOperations
   */
  async list(
    orgId: string,
    fieldId: string,
    params?: {
      cropSeason?: string;
      fieldOperationType?: string;
      startDate?: string;
      endDate?: string;
      embed?: 'measurementTypes';
      workPlanIds?: unknown;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FieldOperation']>> {
    const query = new URLSearchParams();
    if (params?.cropSeason !== undefined) query.set('cropSeason', String(params.cropSeason));
    if (params?.fieldOperationType !== undefined)
      query.set('fieldOperationType', String(params.fieldOperationType));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.workPlanIds !== undefined) query.set('workPlanIds', String(params.workPlanIds));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/fieldOperations${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldOperation']>>(
      this.spec,
      path,
      options
    );
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/fieldOperations
   */
  async listAll(
    orgId: string,
    fieldId: string,
    params?: {
      cropSeason?: string;
      fieldOperationType?: string;
      startDate?: string;
      endDate?: string;
      embed?: 'measurementTypes';
      workPlanIds?: unknown;
    },
    options?: RequestOptions
  ): Promise<components['schemas']['FieldOperation'][]> {
    const query = new URLSearchParams();
    if (params?.cropSeason !== undefined) query.set('cropSeason', String(params.cropSeason));
    if (params?.fieldOperationType !== undefined)
      query.set('fieldOperationType', String(params.fieldOperationType));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.workPlanIds !== undefined) query.set('workPlanIds', String(params.workPlanIds));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/fieldOperations${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['FieldOperation']>(this.spec, path, options);
  }
}

// Re-export types for convenience
export type { components as FieldOperationsApiTypes } from '../types/generated/field-operations-api.js';
