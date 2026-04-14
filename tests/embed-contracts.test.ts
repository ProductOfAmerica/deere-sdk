/**
 * Integration tests for the embed-contracts feature end-to-end.
 *
 * Exercises:
 * 1. SafeFieldOperationsApi runtime behavior (happy path, contract violation,
 *    empty array, query-string forcing).
 * 2. Spec-patch regression — asserts the generated types file carries the
 *    three fields the patch injects (measurementTypes, applicationProductTotals,
 *    ApplicationProductTotal). Catches silent loss if fix-specs.ts regresses.
 * 3. Generator wire-up — instantiates Deere and checks that
 *    deere.safe.fieldOperations.listAllWithMeasurements is a live callable
 *    function. Single end-to-end test that catches a regression in the
 *    generator's emission of `this.safe = new SafeFacades(this)`.
 *
 * See scripts/embed-contracts.yaml, src/safe/, and scripts/generate-sdk.ts
 * generateMainClass() for the production code paths under test.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Deere } from '../src/deere.js';
import { DeereError } from '../src/errors.js';
import type { components } from '../src/types/generated/field-operations-api.js';
import { mockJsonResponse, mockWithSpy } from './helpers/mock-fetch.js';

const HARVEST_FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'jd',
  'field-operation-harvest.json'
);
const APPLICATION_FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'jd',
  'field-operation-application.json'
);

function loadFixture(path: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  // Strip _meta (origin header added during the field-mcp → deere-sdk copy).
  // See plan step 4 for rationale.
  const { _meta: _ignored, ...body } = raw;
  return body;
}

/** Wrap one or more FieldOperation bodies in a paginated-response envelope
 *  with no nextPage link so client.getAll() returns after one fetch. */
function envelope(items: unknown[]): { values: unknown[]; links: unknown[] } {
  return { values: items, links: [] };
}

describe('SafeFieldOperationsApi — runtime behavior', () => {
  it('listAllWithMeasurements returns operations when measurementTypes is populated', async () => {
    const harvest = loadFixture(HARVEST_FIXTURE_PATH);
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockJsonResponse(envelope([harvest])),
    });

    const ops = await deere.safe.fieldOperations.listAllWithMeasurements('org-id', 'field-id');

    assert.strictEqual(ops.length, 1);
    assert.ok(
      Array.isArray(ops[0].measurementTypes),
      'measurementTypes should be an array on the narrowed return type'
    );
    assert.ok(
      ops[0].measurementTypes.length > 0,
      'harvest fixture should carry populated measurementTypes'
    );
    assert.strictEqual(
      ops[0].measurementTypes[0].measurementName,
      'HarvestYieldResult',
      'first measurement in harvest fixture is HarvestYieldResult'
    );
  });

  it('listAllWithMeasurements throws DeereError on contract violation (missing measurementTypes)', async () => {
    // Construct an operation WITHOUT measurementTypes even though embed is passed.
    // This is the exact silent-failure mode the safe wrapper exists to catch.
    const brokenOp = {
      '@type': 'FieldOperation',
      id: 'op-123',
      fieldOperationType: 'harvest',
      // NOTE: no measurementTypes array
    };
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockJsonResponse(envelope([brokenOp])),
    });

    await assert.rejects(
      () => deere.safe.fieldOperations.listAllWithMeasurements('org-id', 'field-id'),
      (err: Error) => {
        assert.ok(err instanceof DeereError, `expected DeereError, got ${err.constructor.name}`);
        assert.match(err.message, /contract violation/);
        assert.match(err.message, /op-123/, 'error should name the offending operation id');
        assert.match(err.message, /harvest/, 'error should name the operation type');
        return true;
      }
    );
  });

  it('listAllWithMeasurements accepts empty measurementTypes array (operation with no data yet)', async () => {
    const opWithEmptyMeasurements = {
      '@type': 'FieldOperation',
      id: 'op-456',
      fieldOperationType: 'seeding',
      measurementTypes: [], // valid: operation exists but has no recorded measurements
    };
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockJsonResponse(envelope([opWithEmptyMeasurements])),
    });

    const ops = await deere.safe.fieldOperations.listAllWithMeasurements('org-id', 'field-id');
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].id, 'op-456');
    assert.deepStrictEqual(ops[0].measurementTypes, []);
  });
});

describe('SafeFieldOperationsApi — query-string forcing', () => {
  it('always adds embed=measurementTypes to the outgoing URL', async () => {
    const harvest = loadFixture(HARVEST_FIXTURE_PATH);
    const { fetch: mockFetch, calls } = mockWithSpy(envelope([harvest]));
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockFetch,
    });

    await deere.safe.fieldOperations.listAllWithMeasurements('org-id', 'field-id');

    assert.strictEqual(calls.length, 1);
    assert.match(
      calls[0].url,
      /embed=measurementTypes/,
      'safe wrapper must always add embed=measurementTypes'
    );
  });

  it('overrides a conflicting embed value passed by the caller', async () => {
    const harvest = loadFixture(HARVEST_FIXTURE_PATH);
    const { fetch: mockFetch, calls } = mockWithSpy(envelope([harvest]));
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockFetch,
    });

    // Caller tries to pass a different embed value (hypothetical — the raw
    // type doesn't allow this today, but a future spec change or escape-hatch
    // cast could let it through). The safe wrapper must still override with
    // measurementTypes. We smuggle the conflicting embed through an unknown
    // cast since the type system rightly refuses to accept it as legitimate.
    const paramsWithConflict = {
      cropSeason: '2026',
      embed: 'client',
    } as unknown as Parameters<(typeof deere.safe.fieldOperations)['listAllWithMeasurements']>[2];
    await deere.safe.fieldOperations.listAllWithMeasurements(
      'org-id',
      'field-id',
      paramsWithConflict
    );

    assert.strictEqual(calls.length, 1);
    assert.match(
      calls[0].url,
      /embed=measurementTypes/,
      'safe wrapper must override a conflicting embed value with measurementTypes'
    );
    assert.ok(!calls[0].url.includes('embed=client'), 'caller-supplied embed must be dropped');
    assert.match(calls[0].url, /cropSeason=2026/, 'other params should still be forwarded');
  });
});

describe('SafeFieldOperationsApi — application fixture (applicationProductTotals)', () => {
  it('resolves nested applicationProductTotals in the application fixture', async () => {
    const application = loadFixture(APPLICATION_FIXTURE_PATH);
    const deere = new Deere({
      accessToken: 'test',
      environment: 'sandboxapi',
      fetch: mockJsonResponse(envelope([application])),
    });

    const ops = await deere.safe.fieldOperations.listAllWithMeasurements('org-id', 'field-id');

    const op = ops[0];
    const appRateResult = op.measurementTypes.find(
      (m: components['schemas']['FieldOperationMeasurement']) =>
        m.measurementName === 'ApplicationRateResult'
    );
    assert.ok(appRateResult, 'ApplicationRateResult measurement should be present');
    assert.ok(
      Array.isArray(appRateResult.applicationProductTotals),
      'applicationProductTotals should be an array (added via spec patch)'
    );
    assert.ok(
      appRateResult.applicationProductTotals!.length > 0,
      'application fixture carries populated applicationProductTotals'
    );
    const productTotal = appRateResult.applicationProductTotals![0];
    assert.strictEqual(
      productTotal.productId,
      '61cb3844',
      'ApplicationProductTotal.productId should match the fixture'
    );
    assert.strictEqual(productTotal.name, 'Atrazine');
    assert.ok(
      Array.isArray(productTotal.productTotals),
      'nested productTotals should be typed as an array'
    );
  });
});

describe('Spec-patch regression — generated types file', () => {
  const GENERATED_TYPES_PATH = join(
    process.cwd(),
    'src',
    'types',
    'generated',
    'field-operations-api.ts'
  );
  const generated = readFileSync(GENERATED_TYPES_PATH, 'utf-8');

  // Quote style on the generated types file is whatever biome picks as the
  // canonical style (single quotes per biome.json). openapi-typescript emits
  // double quotes; `pnpm lint:fix` (or CI normalization) flips them to single.
  // Accept both so the regex survives either state.
  const Q = `['"]`;

  it('FieldOperation gains an optional measurementTypes: FieldOperationMeasurement[]', () => {
    assert.match(
      generated,
      new RegExp(
        `measurementTypes\\?:\\s*components\\[${Q}schemas${Q}\\]\\[${Q}FieldOperationMeasurement${Q}\\]\\[\\]`
      ),
      'spec patch for measurementTypes appears to have regressed; re-run pnpm generate and check scripts/embed-contracts.yaml'
    );
  });

  it('FieldOperationMeasurementInFullRelease gains an optional applicationProductTotals: ApplicationProductTotal[]', () => {
    assert.match(
      generated,
      new RegExp(
        `applicationProductTotals\\?:\\s*components\\[${Q}schemas${Q}\\]\\[${Q}ApplicationProductTotal${Q}\\]\\[\\]`
      ),
      'spec patch for applicationProductTotals appears to have regressed; re-run pnpm generate'
    );
  });

  it('ApplicationProductTotal is a named schema in the generated types', () => {
    assert.match(
      generated,
      /ApplicationProductTotal:\s*{/,
      'ApplicationProductTotal schema appears to have regressed; re-run pnpm generate'
    );
  });
});

describe('Generator wire-up — deere.safe is live', () => {
  it('new Deere(config) exposes a live deere.safe.fieldOperations facade', () => {
    const deere = new Deere({ accessToken: 'test', environment: 'sandboxapi' });

    assert.ok(
      deere.safe,
      'deere.safe should exist (generator must emit `readonly safe: SafeFacades`)'
    );
    assert.ok(
      deere.safe.fieldOperations,
      'deere.safe.fieldOperations should exist (SafeFacades constructor must wire it)'
    );
    assert.strictEqual(
      typeof deere.safe.fieldOperations.listAllWithMeasurements,
      'function',
      'listAllWithMeasurements should be a callable method'
    );
  });
});
