/**
 * FilesApi
 *
 * Auto-generated SDK wrapper for John Deere files API.
 * @generated from files.yaml
 */

import type { SpecName } from '../api-servers.generated.js';
import type { DeereClient, PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/files.js';

export class FilesApi {
  /** The OpenAPI spec this class is generated from. Used by DeereClient to
   * resolve request URLs via API_SERVERS. Typed against SpecName so typos
   * are caught at compile time. */
  private readonly spec: SpecName = 'files';

  constructor(private readonly client: DeereClient) {}

  /**
   * List File Transfer Requests
   * @description This resource allows the client to check the status of a file
   * transfer request that has already been submitted. The response will contain
   * links to the following resources: file: View the file for which the
   * transfer was requested. machine: View the machine to which the transfer was
   * requested.
   * @generated from GET /fileTransfers
   */
  async listFileTransfers(
    params?: { source?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FileValue']>> {
    const query = new URLSearchParams();
    if (params?.source !== undefined) query.set('source', String(params.source));
    const queryString = query.toString();
    const path = `/fileTransfers${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FileValue']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * View a File Transfer Request
   * @description This resource allows the client to check the status of a file
   * transfer request that has already been submitted. The response will contain
   * links to the following resources: file: View the file for which the
   * transfer was requested. machine: View the machine to which the transfer was
   * requested.
   * @generated from GET /fileTransfers/{id}
   */
  async getFileTransfers(
    id: string,
    params?: { source?: string },
    options?: RequestOptions
  ): Promise<components['schemas']['FileTransfersValue']> {
    const query = new URLSearchParams();
    if (params?.source !== undefined) query.set('source', String(params.source));
    const queryString = query.toString();
    const path = `/fileTransfers/${id}${queryString ? `?${queryString}` : ''}`;
    return this.client.get<components['schemas']['FileTransfersValue']>(this.spec, path, options);
  }

  /**
   * List Files
   * @description This resource retrieves the list of available files. For each
   * file, the response will link to the following resources:
   * owningOrganization: View the org that owns the file. partnerships: View the
   * partners this file is shared with.
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
    return this.client.get<PaginatedResponse<components['schemas']['FilesGet']>>(
      this.spec,
      path,
      options
    );
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
    return this.client.getAll<components['schemas']['FilesGet']>(this.spec, path, options);
  }

  /**
   * View/Download A File
   * @description This resource allows the client to view or download a file.
   * Note: Only files smaller than 50 MB can be downloaded at once. Larger files
   * will need to be downloaded in chunks. To download in chunks, you can use
   * the Range request header, or the offset and size request parameters. If
   * both are used, the request header will take precedence. To view a file's
   * metadata, choose the application/vnd.deere.axiom.v3+json Accept Header. To
   * download the file to the client software, choose a /zip or octet-stream
   * Accept Header. The following example will show a GET call to view a files
   * metadata. The response will contain links to the following resources:
   * owningOrganization: View the org that owns the file. partnerships: View a
   * list of the partnerships through which the file is shared, if applicable.
   * initiateFileTransfer: Request to send this file to a specified machine.
   * wdtCapableMachines: View a list of machines in the org which can receive
   * this file.
   * @generated from GET /files/{fileId}
   */
  async get(
    fileId: string,
    options?: RequestOptions
  ): Promise<components['schemas']['ValueFileIdGet']> {
    const path = `/files/${fileId}`;
    return this.client.get<components['schemas']['ValueFileIdGet']>(this.spec, path, options);
  }

  /**
   * Upload/Update A File
   * @description This resource allows the client to upload or update a file.
   * The client must before uploading a file.
   * @generated from PUT /files/{fileId}
   */
  async update(
    fileId: string,
    data: components['schemas']['EditableFileDetails'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/files/${fileId}`;
    await this.client.put(this.spec, path, data, options);
  }

  /**
   * Get File Transfer List by Organization
   * @description This resource will retrieve list of all File Transfer by an
   * Organization. The response will contain links to the following resources:
   * file: View the file for which the transfer was requested. machine: View the
   * machine to which the transfer was requested.
   * @generated from GET /organizations/{orgId}/fileTransfers
   */
  async listOrganizationsFileTransfers(
    orgId: string,
    params?: { source?: string },
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['FileTransfersValue']>> {
    const query = new URLSearchParams();
    if (params?.source !== undefined) query.set('source', String(params.source));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/fileTransfers${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['FileTransfersValue']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Submit a File Transfer Request
   * @description This resource allows you to select a file and machine, and use
   * the client software to submit a file transfer request. After that,
   * MyJohnDeere API v3's infrastructure transfers the selected file to the
   * selected machine, where it becomes available for the machine operator to
   * use. The response links to the following resources: file: The file for
   * which the transfer is being requested. machine: The machine to which the
   * transfer is being requested.
   * @generated from POST /organizations/{orgId}/fileTransfers
   */
  async createFileTransfers(
    orgId: string,
    data: components['schemas']['FileTransfersPost'],
    options?: RequestOptions
  ): Promise<components['schemas']['PostFileTransfersResponse']> {
    const path = `/organizations/${orgId}/fileTransfers`;
    return this.client.post<components['schemas']['PostFileTransfersResponse']>(
      this.spec,
      path,
      data,
      options
    );
  }

  /**
   * List an Org's Files
   * @description View a list of an org's files. This resource allows for
   * pagination. For each returned file, the response will link to the following
   * resources: owningOrganization: View the org that owns the file.
   * partnerships: View the partnerships through which the file is shared, if
   * applicable. initiateFileTransfer: Submit a transfer request for the
   * specified file. machinesEligibleToReceiveFile: List of WDT-capable machines
   * that the specified file can be sent to. sendFileToMachine: The same as
   * "initiateFileTransfer." wdtCapableMachines: The same as
   * "machinesEligibleToReceiveFile."
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
    return this.client.get<PaginatedResponse<components['schemas']['FilesGet']>>(
      this.spec,
      path,
      options
    );
  }

  /**
   * Create A File ID
   * @description The POST call below shows the creation of file id "55" in
   * organization "73" in Operation Center. The response "location" header will
   * return the new file ID in the link returned. The client software will then
   * use the new file ID, to
   * @generated from POST /organizations/{orgId}/files
   */
  async create(
    orgId: string,
    data: components['schemas']['PostableFileDetails'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/organizations/${orgId}/files`;
    await this.client.post(this.spec, path, data, options);
  }
}

// Re-export types for convenience
export type { components as FilesTypes } from '../types/generated/files.js';
