/**
 * src/safe — hand-written "safe" facades over generated API classes.
 *
 * Each file in this directory wraps a generated FooApi class with a FooSafeApi
 * class whose methods force query params that the raw API leaves optional but
 * that John Deere's real API requires for a complete response. See
 * scripts/embed-contracts.yaml for the registry that documents the
 * invariants these wrappers enforce.
 *
 * SafeFacades is the composition root. The generated Deere class constructs
 * one instance as its last init step and exposes it as `deere.safe`, so
 * consumers reach every safe wrapper through `deere.safe.<resource>.<method>`.
 * Adding a new safe wrapper means adding a file here, then adding a field and
 * a constructor init to SafeFacades below. Never touch scripts/generate-sdk.ts
 * for new safe wrappers — the generator deliberately knows nothing about this
 * module beyond its import path.
 */

import type { Deere } from '../deere.js';
import { SafeEquipmentApi } from './equipment.js';
import { SafeFieldOperationsApi } from './field-operations.js';
import { SafeProductsApi } from './products.js';

export { SafeEquipmentApi } from './equipment.js';
export type {
  FieldOperationIdWithMeasurements,
  FieldOperationWithMeasurements,
} from './field-operations.js';
export { SafeFieldOperationsApi } from './field-operations.js';
export { SafeProductsApi } from './products.js';

/**
 * Composition root for all safe facades.
 *
 * Constructed by the generated `Deere` class as its last init step (after all
 * generated API fields have been initialized). Expose as `deere.safe`.
 *
 * Init-order invariant: SafeFacades' constructor reads generated API fields
 * (`deere.fieldOperations`, `deere.equipment`, `deere.products`). The
 * generator's `generateMainClass()` emits `this.safe = new SafeFacades(this)`
 * AFTER the `${assignments}` substitution for exactly this reason. If a
 * future generator refactor ever reorders those emissions, the runtime guard
 * in this constructor fires loudly rather than silently initializing fields
 * to undefined and failing ten minutes later in a downstream method call.
 *
 * Adding a new safe facade: write the class under `src/safe/`, import it
 * here, add a `readonly` field, add an init line in the constructor, and
 * extend the init-order guard to cover the required raw API. The generator
 * never learns about the new facade — `scripts/generate-sdk.ts` only wires
 * up `SafeFacades` as a black box.
 */
export class SafeFacades {
  readonly fieldOperations: SafeFieldOperationsApi;
  readonly equipment: SafeEquipmentApi;
  readonly products: SafeProductsApi;

  constructor(deere: Deere) {
    if (!deere.fieldOperations || !deere.equipment || !deere.products) {
      throw new Error(
        'SafeFacades constructed before all required raw API fields were initialized ' +
          '(fieldOperations, equipment, products). scripts/generate-sdk.ts must emit ' +
          '`this.safe = new SafeFacades(this)` AFTER the generated API field initializations ' +
          'in generateMainClass(). Check the output order of the template substitutions.'
      );
    }
    this.fieldOperations = new SafeFieldOperationsApi(deere.fieldOperations);
    this.equipment = new SafeEquipmentApi(deere.equipment);
    this.products = new SafeProductsApi(deere.products);
  }
}
