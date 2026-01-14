/**
 * WebhookApi
 *
 * Auto-generated SDK wrapper for John Deere webhook API.
 * @generated from webhook.yaml
 */

import type { DeereClient, RequestOptions } from '../client.js';
import type { components } from '../types/generated/webhook.js';

export class WebhookApi {
  constructor(private readonly client: DeereClient) {}

  /**
   * Get Event Subscriptions
   * @description This resource will return a paged list of event subscriptions for the user. The endpoint will return all Active, Expired, and Terminated subscriptions.
   * @generated from GET /eventSubscriptions
   */
  async list(options?: RequestOptions): Promise<unknown> {
    const path = `/eventSubscriptions`;
    return this.client.get<unknown>(path, options);
  }
  /**
   * Get all items (follows pagination automatically)
   * @generated from GET /eventSubscriptions
   */
  async listAll(options?: RequestOptions): Promise<unknown[]> {
    const path = `/eventSubscriptions`;
    return this.client.getAll<unknown>(path, options);
  }

  /**
   * Create an Event Subscription
   * @description This resource will create an event subscription for a user. It returns a list of event subscriptions. To create a subscription for an event, your client must have access to the event's associated api. The response will include links to:- user: The subscribed user provided by the current authorization context. self: The created subscription.
   * @generated from POST /eventSubscriptions
   */
  async create(
    data: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<components['schemas']['CreatedSubscriptionValues']> {
    const path = `/eventSubscriptions`;
    return this.client.post<components['schemas']['CreatedSubscriptionValues']>(
      path,
      data,
      options
    );
  }

  /**
   * Get an Event Subscription
   * @description This resource will get a single event subscription by id. The response will include links to: user: The subscribed user provided by the current authorization context. self: The subscription itself.
   * @generated from GET /eventSubscriptions/{id}
   */
  async get(
    id: string,
    options?: RequestOptions
  ): Promise<components['schemas']['CreatedSubscriptionValues']> {
    const path = `/eventSubscriptions/${id}`;
    return this.client.get<components['schemas']['CreatedSubscriptionValues']>(path, options);
  }

  /**
   * Update an Event Subscription
   * @description This resource will update an event subscription for a user. Only certain fields are editable.
   * @generated from PUT /eventSubscriptions/{id}
   */
  async update(
    id: string,
    data: components['schemas']['SubscriptionResponseContent'],
    options?: RequestOptions
  ): Promise<void> {
    const path = `/eventSubscriptions/${id}`;
    await this.client.put(path, data, options);
  }
}

// Re-export types for convenience
export type { components as WebhookTypes } from '../types/generated/webhook.js';
