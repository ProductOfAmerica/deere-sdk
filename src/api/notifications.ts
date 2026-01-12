/**
 * NotificationsApi
 *
 * Auto-generated SDK wrapper for John Deere notifications API.
 * @generated from notifications.yaml
 */

import type { DeereClient, RequestOptions, PaginatedResponse } from '../client.js';
import type { components } from '../types/generated/notifications.js';

export class NotificationsApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Fetch single notification.
   * @description Retrieve a single notification by source event.
   * @generated from GET /notifications/{sourceEvent}
   */
  async get(sourceEvent: string, options?: RequestOptions): Promise<components['schemas']['GetResponse']> {
    const path = `/notifications/${sourceEvent}`;
    return this.client.get<components['schemas']['GetResponse']>(path, options);
  }

  /**
   * Create Notification Event
   * @description This resource creates an event that Operations Center will use to generate notifications. These notifications will be received by anyone who is subscribed to your services. Each notification event will include a link to <b>source</b>, which will define the event.
   * @generated from POST /notificationEvents
   */
  async create(data: components['schemas']['PostNotifications'], options?: RequestOptions): Promise<void> {
    const path = `/notificationEvents`;
    await this.client.post(path, data, options);
  }

  /**
   * Delete a Notification Event
   * @description This resource deletes a notification event that was previously posted to MJD as well as any generated notifications.
   * @generated from DELETE /notificationEvents/{sourceEvent}
   */
  async delete(sourceEvent: string, options?: RequestOptions): Promise<void> {
    const path = `/notificationEvents/${sourceEvent}`;
    await this.client.delete(path, options);
  }

  /**
   * Search Notifications for an Organization
   * @description This endpoint will let you search Notifications based on criteria specified in request parameters. The return value is the list of notifications that exist only in the user’s staff organization(s). This API cannot be used with a partner organization ID in the path. If partnership permissions are set up properly in Operations Center, partner notifications for shared resources will be available in the users staff organization which holds the partnership. Each data point will include links to: <ul> <li><b>targetResource:</b> View the target (like file) associated with this notification within each MinimizedNotification object. Please refer to sample response below to see the example.</li> <li><b>contributionDefinition:</b> View the definition of "notification".</li> </ul>
   * @generated from GET /organizations/{orgId}/notifications/events
   */
  async list(orgId: string, params?: { before?: unknown; after?: unknown; count?: number; eventTypes?: unknown; severities?: unknown; sourceEvents?: unknown; startDate?: string; endDate?: string }, options?: RequestOptions): Promise<PaginatedResponse<components['schemas']['GetResponse']>> {
    const query = new URLSearchParams();
    if (params?.before !== undefined) query.set('before', String(params.before));
    if (params?.after !== undefined) query.set('after', String(params.after));
    if (params?.count !== undefined) query.set('count', String(params.count));
    if (params?.eventTypes !== undefined) query.set('eventTypes', String(params.eventTypes));
    if (params?.severities !== undefined) query.set('severities', String(params.severities));
    if (params?.sourceEvents !== undefined) query.set('sourceEvents', String(params.sourceEvents));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/notifications/events${queryString ? `?${queryString}` : ''}`;
    return this.client.get<PaginatedResponse<components['schemas']['GetResponse']>>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /organizations/{orgId}/notifications/events
   */
  async listAll(orgId: string, params?: { before?: unknown; after?: unknown; count?: number; eventTypes?: unknown; severities?: unknown; sourceEvents?: unknown; startDate?: string; endDate?: string }, options?: RequestOptions): Promise<components['schemas']['GetResponse'][]> {
    const query = new URLSearchParams();
    if (params?.before !== undefined) query.set('before', String(params.before));
    if (params?.after !== undefined) query.set('after', String(params.after));
    if (params?.count !== undefined) query.set('count', String(params.count));
    if (params?.eventTypes !== undefined) query.set('eventTypes', String(params.eventTypes));
    if (params?.severities !== undefined) query.set('severities', String(params.severities));
    if (params?.sourceEvents !== undefined) query.set('sourceEvents', String(params.sourceEvents));
    if (params?.startDate !== undefined) query.set('startDate', String(params.startDate));
    if (params?.endDate !== undefined) query.set('endDate', String(params.endDate));
    const queryString = query.toString();
    const path = `/organizations/${orgId}/notifications/events${queryString ? `?${queryString}` : ''}`;
    return this.client.getAll<components['schemas']['GetResponse']>(path, options);
  }
}

// Re-export types for convenience
export type { components as NotificationsTypes } from '../types/generated/notifications.js';
