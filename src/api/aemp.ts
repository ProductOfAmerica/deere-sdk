/**
 * AempApi
 *
 * Auto-generated SDK wrapper for John Deere aemp API.
 * @generated from aemp.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/aemp.js';

export class AempApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Get Fleet List
   * @description Retrieve a snapshot view of an equipment owner’s fleet. The API response is paginated with a page size of 100. If the response is large, it will be chunked into multiple pages. Please follow the "next" link within the response to retrieve all the fleets. <br/> <br/> <b>Note:</b> The API response is cached on our servers for an hour. Hence, polling frequency of at least one hour is recommended. <br/> <b>Note:</b> Not all vehicles will supply all data points.
   * @generated from GET /Fleet/{pageNumber}
   */
  async get(pageNumber: string, options?: RequestOptions): Promise<unknown> {
    const path = `/Fleet/${pageNumber}`;
    return this.client.get<unknown>(path, options);
  }
}

// Re-export types for convenience
export type { components as AempTypes } from '../types/generated/aemp.js';
