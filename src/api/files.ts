/**
 * FilesApi
 *
 * Auto-generated SDK wrapper for John Deere files API.
 * @generated from files.yaml
 */

import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/files.js';

export class FilesApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * List Files
   * @description This resource retrieves the list of available files. For each file, the response will link to the following resources: owningOrganization: View the org that owns the file. partnerships: View the partners this file is shared with.
   * @generated from GET /files
   */
  async list(
    params?: { filter: string; fileType: number; transferable: boolean },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FilesGet']>> {
    const query = new URLSearchParams();
    if (params?.filter !== undefined) query.set('filter', String(params.filter));
    if (params?.fileType !== undefined) query.set('fileType', String(params.fileType));
    if (params?.transferable !== undefined) query.set('transferable', String(params.transferable));
    const queryString = query.toString();
    const path = `/files${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FilesGet']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /files
   */
  async listAll(
    params?: { filter: string; fileType: number; transferable: boolean },
    options?: RequestOptions
  ): Promise<components['schemas']['FilesGet'][]> {
    const query = new URLSearchParams();
    if (params?.filter !== undefined) query.set('filter', String(params.filter));
    if (params?.fileType !== undefined) query.set('fileType', String(params.fileType));
    if (params?.transferable !== undefined) query.set('transferable', String(params.transferable));
    const queryString = query.toString();
    const path = `/files${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['FilesGet']>(path, options);
  }

  /**
   * View/Download A File
   * @description This resource allows the client to view or download a file. Note: Only files smaller than 50 MB can be downloaded at once. Larger files will need to be downloaded in chunks. To download in chunks, you can use the Range request header, or the offset and size request parameters. If both are used, the request header will take precedence. To view a file's metadata, choose the application/vnd.deere.axiom.v3+json Accept Header. To download the file to the client software, choose a /zip or octet-stream Accept Header. The following example will show a GET call to view a files metadata. The response will contain links to the following resources: owningOrganization: View the org that owns the file. partnerships: View a list of the partnerships through which the file is shared, if applicable. initiateFileTransfer: Request to send this file to a specified machine. wdtCapableMachines: View a list of machines in the org which can receive this file.
   * @generated from GET /files/{fileId}
   */
  async get(fileId: string, options?: RequestOptions): Promise<unknown> {
    const path = `/files/${fileId}`;
    return this.client.get<unknown>(path, options);
  }

  /**
   * Upload/Update A File
   * @description This resource allows the client to upload or update a file. The client must before uploading a file.
   * @generated from PUT /files/{fileId}
   */
  async update(
    fileId: string,
    data: components['schemas']['EditableFileDetails'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/files/${fileId}`;
    await this.client.put(path, data, options);
  }

  /**
   * List an Org's Files
   * @description View a list of an org's files. This resource allows for pagination. For each returned file, the response will link to the following resources: owningOrganization: View the org that owns the file. partnerships: View the partnerships through which the file is shared, if applicable. initiateFileTransfer: Submit a transfer request for the specified file. machinesEligibleToReceiveFile: List of WDT-capable machines that the specified file can be sent to. sendFileToMachine: The same as "initiateFileTransfer." wdtCapableMachines: The same as "machinesEligibleToReceiveFile."
   * @generated from GET /organizations/{orgId}/files
   */
  async listFiles(
    orgId: string,
    params?: {
      filter?: string;
      startDate?: string;
      endDate?: unknown;
      fileType?: number;
      archived?: boolean;
      status?: string;
    },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FilesGet']>> {
    const query = new URLSearchParams();
    if (params?.filter !== undefined) query.set('filter', String(params.filter));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    if (params?.fileType !== undefined) query.set('fileType', String(params.fileType));
    if (params?.archived !== undefined) query.set('archived', String(params.archived));
    if (params?.status !== undefined) query.set('status', String(params.status));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/files${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FilesGet']>>(path, options);
  }

  /**
   * Create A File ID
   * @description The POST call below shows the creation of file id "55" in organization "73" in Operation Center. The response "location" header will return the new file ID in the link returned. The client software will then use the new file ID, to
   * @generated from POST /organizations/{orgId}/files
   */
  async create(
    orgId: string,
    data: components['schemas']['PostableFileDetails'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/files`;
    await this.client.post(path, data, options);
  }
}

// Re-export types for convenience
export type { components as FilesTypes } from '../types/generated/files.js';
