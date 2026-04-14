//
// Type-level tests for the embed-contracts feature.
//
// This file is NOT executed at runtime. The test runner's glob in package.json
// is "tests/\*.test.ts" (direct children of tests/ ending in .test.ts), so
// anything under tests/types/ with the .types.ts suffix is skipped by the
// runner but still picked up by pnpm typecheck:test via tsconfig.test.json's
// "tests/\*\*/\*" include.
//
// Purpose: prove that the narrowed FieldOperationWithMeasurements type and the
// raw FieldOperation type actually differ on measurementTypes optionality.
// If the spec patch ever regresses and measurementTypes goes back to being
// absent entirely, the @ts-expect-error assertion below will be flipped (the
// error will disappear) and pnpm typecheck:test will fail.
//

import type { Deere, FieldOperationWithMeasurements } from '../../src/index.js';
import type { components } from '../../src/types/generated/field-operations-api.js';

declare const deere: Deere;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _typeCheck() {
  // --- Safe path: measurementTypes is non-optional on the narrowed type. ---
  const safe: FieldOperationWithMeasurements[] =
    await deere.safe.fieldOperations.listAllWithMeasurements('org', 'field');

  // Non-optional indexed access should compile without `?.`.
  const _ms: components['schemas']['FieldOperationMeasurement'][] = safe[0].measurementTypes;

  // Individual measurement fields are still optional (JD's house style), so
  // `?.` is required to drill down.
  const _yieldValue: number | undefined = safe[0].measurementTypes[0]?.averageYield?.value;

  // applicationProductTotals — the second spec patch — should type-check
  // against the new ApplicationProductTotal schema.
  const _appTotals: components['schemas']['ApplicationProductTotal'][] | undefined =
    safe[0].measurementTypes[0]?.applicationProductTotals;

  // The enum-typed discriminator lets consumers narrow with switch + exhaustiveness.
  const first = safe[0].measurementTypes[0];
  if (first && first.measurementName === 'HarvestYieldResult') {
    // Inside the narrowed branch, measurementName is known to be the literal
    // string 'HarvestYieldResult'. (openapi-typescript emits this as a union
    // member from FieldOperationMeasurementTypesEnum.)
    const _check: string = first.measurementName;
    void _check;
  }

  // --- Raw path: measurementTypes is optional. Caller MUST narrow. ---
  const raw = await deere.fieldOperations.listAll('org', 'field');

  // Raw return should NOT assign to the non-optional narrowed type —
  // measurementTypes is optional here.
  // @ts-expect-error raw FieldOperation has optional measurementTypes
  const _rawFails: components['schemas']['FieldOperationMeasurement'][] = raw[0].measurementTypes;

  // Correct raw-path access: handle the undefined branch explicitly.
  const _rawOk: components['schemas']['FieldOperationMeasurement'][] | undefined =
    raw[0].measurementTypes;

  void safe;
  void _ms;
  void _yieldValue;
  void _appTotals;
  void _rawFails;
  void _rawOk;
}

void _typeCheck;
