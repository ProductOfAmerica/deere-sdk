/**
 * FieldOperationsApi
 *
 * Auto-generated SDK wrapper for John Deere field-operations-api API.
 * @generated from field-operations-api.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/field-operations-api.js';

export class FieldOperationsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Field Operations
   * @description This resource returns logical data structures representing the agronomic operations performed in a field. Supported field operation types include Seeding, Application, and Harvest. A single field operation may potentially span consecutive days depending on the type of operation. Each field operation may have one or more measurements, listed as links from the field operation itself. Each field operation will include links to: <br/> <ul> <li><b>organization:</b> The organization which owns this data.</li> <li><b>field:</b> The field in which this operation was performed.</li> <li><b>self:</b> The field operation.</li> </ul>
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/fieldOperations
   */
  async list(orgId: string, fieldId: string, params?: { cropSeason?: string; fieldOperationType?: string; startDate?: string; endDate?: string; embed?: 'measurementTypes'; workPlanIds?: unknown }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['FieldOperation']>> {
    const query = new URLSearchParams();
    if (params?.cropSeason !== undefined) query.set('cropSeason', String(params.cropSeason));
    if (params?.fieldOperationType !== undefined) query.set('fieldOperationType', String(params.fieldOperationType));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.workPlanIds !== undefined) query.set('workPlanIds', String(params.workPlanIds));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/fieldOperations${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FieldOperation']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/fields/{fieldId}/fieldOperations
   */
  async listAll(orgId: string, fieldId: string, params?: { cropSeason?: string; fieldOperationType?: string; startDate?: string; endDate?: string; embed?: 'measurementTypes'; workPlanIds?: unknown }, options?: RequestOptions): Promise<components['schemas']['FieldOperation'][]> {
    const query = new URLSearchParams();
    if (params?.cropSeason !== undefined) query.set('cropSeason', String(params.cropSeason));
    if (params?.fieldOperationType !== undefined) query.set('fieldOperationType', String(params.fieldOperationType));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    if (params?.workPlanIds !== undefined) query.set('workPlanIds', String(params.workPlanIds));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fields/${fieldId}/fieldOperations${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['FieldOperation']>(path, options);
  }

  /**
   * View a Field Operation
   * @description View a single field operation. The response will include links to: <br/> <ul> <li><b>organization:</b> The organization which owns this data.</li> <li><b>field:</b> The field in which this operation was performed.</li> <li><b>self:</b> The field operation.</li> <ul>
   * @generated from GET /fieldOperations/{operationId}
   */
  async get(operationId: string, params?: { embed?: 'measurementTypes' }, options?: RequestOptions): Promise<components['schemas']['FieldOperationId']> {
    const query = new URLSearchParams();
    if (params?.embed !== undefined) query.set('embed', String(params.embed));
    const queryString = query.toString();
    const path = `/fieldOperations/${operationId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['FieldOperationId']>(path, options);
  }

  /**
   * Asynchronous Shapefile Download
   * @description An ESRI Shapefile is available for each Field Operation. <b>Please see the <a href=/dev-docs/field-operations#shapefile-overview>shapefiles overview</a> for details</b> on the shapefile format and how to consume it.<p>The expected response codes are:</p> <ul> <li><b>202 Accepted – </b>The request was received and is being processed. Call back later to check for completion. <ul> <li>This API does not currently support webhooks. To check for completion, repeat the same API call until you get an HTTP 307.</li> <li>Processing may take up to 30 minutes, depending on the size of data. Applications should poll the API using a backoff loop. Polling intervals should start at 5 seconds and double with each attempt: <mark>secondsToWait = 5 * 2 ^ (numberOfAttempts - 1)</mark></li> </ul> </li> <li><b>307 Temporary Redirect – </b>The shapefile is ready to download. This response contains a location header. The location is a pre-signed URL that is valid for no less than one hour. To download the file, perform a GET request to the URL in the location header. Do not apply OAuth signing or other authorization to this request - it will cause the call to fail. </li> <li><b>406 Not Acceptable - </b>A shapefile cannot be generated. </li> </ul> Note the initial call for a shapefile may receive either a 202 or a 307 response, depending upon whether an up-to-date file already exists for the specified field operation. <br/><br/>For a sample integration, see our <a href=https://github.com/JohnDeere/MyJohnDeereAPI-OAuth2-Java-Example>Java sample code</a>.
   * @generated from GET /fieldOps/{operationId}
   */
  async getFieldops(operationId: string, params?: { splitShapeFile?: boolean; shapeType?: 'Point' | 'Polygon'; resolution?: 'EachSection' | 'EachSensor' | 'OneHertz' }, options?: RequestOptions): Promise<unknown> {
    const query = new URLSearchParams();
    if (params?.splitShapeFile !== undefined) query.set('splitShapeFile', String(params.splitShapeFile));
    if (params?.shapeType !== undefined) query.set('shapeType', String(params.shapeType));
    if (params?.resolution !== undefined) query.set('resolution', String(params.resolution));
    const queryString = query.toString();
    const path = `/fieldOps/${operationId}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<unknown>(path, options);
  }
}

// Re-export types for convenience
export type { components as FieldOperationsApiTypes } from '../types/generated/field-operations-api.js';
