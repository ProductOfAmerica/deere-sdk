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
import { SafeFieldOperationsApi } from './field-operations.js';

export type { FieldOperationWithMeasurements } from './field-operations.js';
export { SafeFieldOperationsApi } from './field-operations.js';

/**
 * Composition root for all safe facades.
 *
 * Constructed by the generated `Deere` class as its last init step (after all
 * generated API fields have been initialized). Expose as `deere.safe`.
 *
 * Init-order invariant: SafeFacades' constructor reads
 * `deere.fieldOperations` (and future safe wrappers will read other generated
 * fields). The generator's `generateMainClass()` emits `this.safe = new
 * SafeFacades(this)` AFTER the `${assignments}` substitution for exactly this
 * reason. If a future generator refactor ever reorders those emissions, the
 * runtime guard in this constructor fires loudly rather than silently
 * initializing fields to undefined and failing ten minutes later in a
 * downstream method call.
 */
export class SafeFacades {
  readonly fieldOperations: SafeFieldOperationsApi;

  constructor(deere: Deere) {
    if (!deere.fieldOperations) {
      throw new Error(
        'SafeFacades constructed before deere.fieldOperations was initialized. ' +
          'scripts/generate-sdk.ts must emit `this.safe = new SafeFacades(this)` ' +
          'AFTER the generated API field initializations in generateMainClass(). ' +
          'Check the output order of the template substitutions.'
      );
    }
    this.fieldOperations = new SafeFieldOperationsApi(deere.fieldOperations);
  }
}
