/**
 * SafeProductsApi — hand-written facade over the generated ProductsApi.
 *
 * The products API has three methods (`list`, `listAll`, `get`) accepting
 * `embed?: 'documents' | 'showMergedProducts'`. JD's spec names the embed
 * "documents" and the description of the variety schema mentions a
 * `documentsList` field, so the documented behavior strongly suggests
 * embed=documents populates a list of document references on the variety
 * response.
 *
 * Like SafeEquipmentApi, we don't yet have wire traces confirming the exact
 * conditional response shape. This facade provides type-level forcing of the
 * embed parameter without narrowing the return type. Future follow-ups can
 * tighten via spec patches once field-mcp probes capture the real shapes.
 *
 * See scripts/embed-contracts.yaml for the contract registry.
 */

import type { ProductsApi } from '../api/products.js';
import type { PaginatedResponse, RequestOptions } from '../client.js';
import type { components } from '../types/generated/products.js';

type RequireEmbed<P> = P extends { embed?: infer E }
  ? Omit<P, 'embed'> & { embed: NonNullable<E> }
  : never;

type RawListParams = NonNullable<Parameters<ProductsApi['list']>[1]>;
type SafeListParams = RequireEmbed<RawListParams>;

type RawListAllParams = NonNullable<Parameters<ProductsApi['listAll']>[1]>;
type SafeListAllParams = RequireEmbed<RawListAllParams>;

type RawGetParams = NonNullable<Parameters<ProductsApi['get']>[2]>;
type SafeGetParams = RequireEmbed<RawGetParams>;

export class SafeProductsApi {
  constructor(private readonly raw: ProductsApi) {}

  /**
   * List one page of varieties for an org, with a required `embed` parameter.
   * Wraps `deere.products.list`. Embed values: `documents`,
   * `showMergedProducts`.
   */
  async listWithEmbed(
    organizationId: string,
    params: SafeListParams,
    options?: RequestOptions
  ): Promise<PaginatedResponse<components['schemas']['VarietyCollection']>> {
    return this.raw.list(organizationId, params, options);
  }

  /**
   * List all varieties for an org (auto-paginated), with a required `embed`
   * parameter. Wraps `deere.products.listAll`.
   */
  async listAllWithEmbed(
    organizationId: string,
    params: SafeListAllParams,
    options?: RequestOptions
  ): Promise<components['schemas']['VarietyCollection'][]> {
    return this.raw.listAll(organizationId, params, options);
  }

  /**
   * Get a single variety by ERID, with a required `embed` parameter.
   * Wraps `deere.products.get`.
   */
  async getWithEmbed(
    organizationId: string,
    erid: string,
    params: SafeGetParams,
    options?: RequestOptions
  ): Promise<components['schemas']['Variety']> {
    return this.raw.get(organizationId, erid, params, options);
  }
}
