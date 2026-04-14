/**
 * Unit tests for scripts/embed-contracts.ts — loader + applyEmbedContracts.
 *
 * These tests target the patcher directly with in-memory spec objects. No
 * codegen, no filesystem I/O (except the one loader test that verifies the
 * registry-file-not-found error path). Matches the style of
 * tests/fix-specs.test.ts (node:test + node:assert + describe/it).
 *
 * See scripts/embed-contracts.yaml and the plan in
 * ~/.claude/plans/tingly-hatching-sunbeam.md for context on what this patcher
 * actually does in production.
 */

import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  applyEmbedContracts,
  EMBED_CONTRACT_SENTINEL,
  type EmbedContract,
  loadEmbedContracts,
} from '../scripts/embed-contracts.js';

/** Shape we cast parsed specs to inside assertions. Avoids `any` in the
 *  fixture-poke paths below. The patcher mutates these objects in place, so we
 *  typecheck reads through this shape rather than through `unknown`. Uses
 *  `Record<string, any>` for the innermost schema value because OpenAPI schema
 *  fragments are deeply nested and we don't want to redeclare the whole shape
 *  just to satisfy assertion reads.
 */
// biome-ignore lint/suspicious/noExplicitAny: test-local narrowing for nested fixture reads
type TestSchema = Record<string, any>;

type TestSpec = {
  components: { schemas: Record<string, TestSchema> };
};

function asTestSpec(spec: Record<string, unknown>): TestSpec {
  return spec as unknown as TestSpec;
}

/** Build a minimal OpenAPI spec with one named schema, for testing. */
function buildSpec(schemaName: string, schema: Record<string, unknown>): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        [schemaName]: schema,
      },
    },
  };
}

/** Build an addProperty contract that patches `target` with one property. */
function buildAddPropertyContract(
  target: string,
  property: string,
  schema: Record<string, unknown>
): EmbedContract {
  return {
    spec: 'test-api',
    path: '/test',
    method: 'get',
    embedParam: 'embed',
    responseItemSchema: target,
    variants: {
      testVariant: {
        patches: [{ op: 'addProperty', target, property, schema }],
      },
    },
  };
}

/** Build an addSchema contract that adds a new named schema. */
function buildAddSchemaContract(name: string, schema: Record<string, unknown>): EmbedContract {
  return {
    spec: 'test-api',
    path: '/test',
    method: 'get',
    embedParam: 'embed',
    responseItemSchema: 'Irrelevant',
    variants: {
      testVariant: {
        patches: [{ op: 'addSchema', name, schema }],
      },
    },
  };
}

describe('applyEmbedContracts — addProperty', () => {
  it('merges a new property and stamps the sentinel', () => {
    const spec = buildSpec('FieldOperation', {
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    const contract = buildAddPropertyContract('FieldOperation', 'measurementTypes', {
      type: 'array',
      items: { $ref: '#/components/schemas/FieldOperationMeasurement' },
    });

    const count = applyEmbedContracts(spec, 'test-api', [contract]);

    assert.strictEqual(count, 1);
    const fieldOp = asTestSpec(spec).components.schemas.FieldOperation;
    assert.ok(fieldOp.properties.measurementTypes, 'property should be merged');
    assert.strictEqual(
      fieldOp.properties.measurementTypes.type,
      'array',
      'merged property should carry the schema fragment verbatim'
    );
    assert.strictEqual(
      fieldOp[EMBED_CONTRACT_SENTINEL],
      true,
      'containing schema should be stamped with the sentinel'
    );
    // Original property preserved
    assert.deepStrictEqual(fieldOp.properties.id, { type: 'string' });
  });

  it('is idempotent within a run (double-patch with matching sentinel is a no-op)', () => {
    const spec = buildSpec('FieldOperation', {
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    const contract = buildAddPropertyContract('FieldOperation', 'measurementTypes', {
      type: 'array',
    });

    // First call adds the property + sentinel.
    applyEmbedContracts(spec, 'test-api', [contract]);
    // Second call should be a no-op (sentinel is already there).
    const count = applyEmbedContracts(spec, 'test-api', [contract]);
    assert.strictEqual(count, 1, 'second call still counts the patch but does not throw');
    const fieldOp = asTestSpec(spec).components.schemas.FieldOperation;
    assert.ok(fieldOp.properties.measurementTypes);
  });

  it('is a no-op when the spec has no contract entries for that spec name', () => {
    const spec = buildSpec('Unrelated', { type: 'object', properties: {} });
    const contract = buildAddPropertyContract('FieldOperation', 'measurementTypes', {
      type: 'array',
    });
    const count = applyEmbedContracts(spec, 'different-api', [contract]);
    assert.strictEqual(count, 0);
    // Nothing added.
    assert.deepStrictEqual(
      asTestSpec(spec).components.schemas.Unrelated.properties,
      {},
      'unrelated spec should be untouched'
    );
  });

  it('aborts loudly when the target schema does not exist', () => {
    const spec = buildSpec('OtherSchema', { type: 'object', properties: {} });
    const contract = buildAddPropertyContract('FieldOperationTypo', 'measurementTypes', {
      type: 'array',
    });

    assert.throws(
      () => applyEmbedContracts(spec, 'test-api', [contract]),
      (err: Error) => {
        assert.match(
          err.message,
          /target schema "FieldOperationTypo" not found/,
          'error message should name the missing target'
        );
        assert.match(
          err.message,
          /Remediation:/,
          'error message should include a remediation hint'
        );
        return true;
      }
    );
  });

  it('aborts loudly when the property exists without the sentinel (drift detection)', () => {
    const spec = buildSpec('FieldOperation', {
      type: 'object',
      properties: {
        // JD already declares measurementTypes themselves — registry is stale.
        measurementTypes: { type: 'array', items: { $ref: '#/components/schemas/Something' } },
      },
    });
    const contract = buildAddPropertyContract('FieldOperation', 'measurementTypes', {
      type: 'array',
    });

    assert.throws(
      () => applyEmbedContracts(spec, 'test-api', [contract]),
      (err: Error) => {
        assert.match(
          err.message,
          /property "measurementTypes" already exists on FieldOperation without the embed-contract sentinel/
        );
        assert.match(err.message, /JD now declares the field themselves/);
        assert.match(err.message, /remove this patch from scripts\/embed-contracts\.yaml/);
        return true;
      }
    );
  });
});

describe('applyEmbedContracts — addSchema', () => {
  it('injects a new named schema and stamps the sentinel', () => {
    const spec = buildSpec('Existing', { type: 'object' });
    const contract = buildAddSchemaContract('NewSchema', {
      type: 'object',
      properties: { foo: { type: 'string' } },
    });

    const count = applyEmbedContracts(spec, 'test-api', [contract]);

    assert.strictEqual(count, 1);
    const newSchema = asTestSpec(spec).components.schemas.NewSchema;
    assert.ok(newSchema, 'new schema should be added');
    assert.strictEqual(newSchema[EMBED_CONTRACT_SENTINEL], true);
    assert.deepStrictEqual(newSchema.properties, { foo: { type: 'string' } });
  });

  it('is idempotent when the schema already exists with the sentinel', () => {
    const spec = buildSpec('Existing', { type: 'object' });
    const contract = buildAddSchemaContract('NewSchema', {
      type: 'object',
      properties: { foo: { type: 'string' } },
    });

    applyEmbedContracts(spec, 'test-api', [contract]);
    // Second run — should not throw.
    applyEmbedContracts(spec, 'test-api', [contract]);

    const newSchema = asTestSpec(spec).components.schemas.NewSchema;
    assert.ok(newSchema);
  });

  it('aborts loudly when the schema exists without the sentinel (drift detection)', () => {
    const spec = buildSpec('NewSchema', {
      type: 'object',
      properties: { bar: { type: 'number' } },
    });
    const contract = buildAddSchemaContract('NewSchema', { type: 'object' });

    assert.throws(
      () => applyEmbedContracts(spec, 'test-api', [contract]),
      (err: Error) => {
        assert.match(
          err.message,
          /schema "NewSchema" already exists in components\.schemas without the embed-contract sentinel/
        );
        assert.match(err.message, /JD now declares it themselves/);
        return true;
      }
    );
  });
});

describe('loadEmbedContracts', () => {
  function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'embed-contracts-test-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('parses a valid registry file', () => {
    withTempDir((dir) => {
      const path = join(dir, 'registry.yaml');
      writeFileSync(
        path,
        `
- spec: field-operations-api
  path: /test
  method: get
  embedParam: embed
  responseItemSchema: FieldOperation
  variants:
    measurementTypes:
      patches:
        - op: addProperty
          target: FieldOperation
          property: measurementTypes
          schema:
            type: array
`,
        'utf-8'
      );
      const contracts = loadEmbedContracts(path);
      assert.strictEqual(contracts.length, 1);
      assert.strictEqual(contracts[0].spec, 'field-operations-api');
      assert.strictEqual(contracts[0].variants.measurementTypes.patches.length, 1);
      const patch = contracts[0].variants.measurementTypes.patches[0];
      assert.strictEqual(patch.op, 'addProperty');
      if (patch.op === 'addProperty') {
        assert.strictEqual(patch.target, 'FieldOperation');
        assert.strictEqual(patch.property, 'measurementTypes');
      }
    });
  });

  it('throws a clear error when the registry file is missing', () => {
    withTempDir((dir) => {
      const missingPath = join(dir, 'does-not-exist.yaml');
      assert.throws(
        () => loadEmbedContracts(missingPath),
        (err: Error) => {
          assert.match(err.message, /registry file missing at/);
          assert.match(err.message, /does-not-exist\.yaml/);
          return true;
        }
      );
    });
  });

  it('throws a clear error on malformed YAML', () => {
    withTempDir((dir) => {
      const path = join(dir, 'bad.yaml');
      writeFileSync(path, '- spec: missing-required\n  nested:\n    : broken:', 'utf-8');
      assert.throws(
        () => loadEmbedContracts(path),
        (err: Error) => {
          assert.match(err.message, /embed-contracts: /);
          return true;
        }
      );
    });
  });

  it('throws a clear error when top-level value is not an array', () => {
    withTempDir((dir) => {
      const path = join(dir, 'scalar.yaml');
      writeFileSync(path, 'not-an-array', 'utf-8');
      assert.throws(
        () => loadEmbedContracts(path),
        (err: Error) => {
          assert.match(err.message, /top-level value .* must be an array/);
          return true;
        }
      );
    });
  });

  it('throws a clear error on missing required fields', () => {
    withTempDir((dir) => {
      const path = join(dir, 'missing-fields.yaml');
      writeFileSync(
        path,
        `
- spec: field-operations-api
  path: /test
  method: get
  variants:
    measurementTypes:
      patches: []
`,
        'utf-8'
      );
      assert.throws(
        () => loadEmbedContracts(path),
        (err: Error) => {
          assert.match(err.message, /missing or invalid required field "embedParam"/);
          return true;
        }
      );
    });
  });

  it('throws a clear error on unknown op', () => {
    withTempDir((dir) => {
      const path = join(dir, 'unknown-op.yaml');
      writeFileSync(
        path,
        `
- spec: test
  path: /test
  method: get
  embedParam: embed
  responseItemSchema: Test
  variants:
    v:
      patches:
        - op: markRequired
          target: Test
          property: foo
`,
        'utf-8'
      );
      assert.throws(
        () => loadEmbedContracts(path),
        (err: Error) => {
          assert.match(err.message, /unknown op "markRequired"/);
          assert.match(err.message, /known ops are: addProperty, addSchema/);
          return true;
        }
      );
    });
  });

  it('throws a clear error on addProperty with missing target', () => {
    withTempDir((dir) => {
      const path = join(dir, 'bad-patch.yaml');
      writeFileSync(
        path,
        `
- spec: test
  path: /test
  method: get
  embedParam: embed
  responseItemSchema: Test
  variants:
    v:
      patches:
        - op: addProperty
          property: foo
          schema:
            type: string
`,
        'utf-8'
      );
      assert.throws(
        () => loadEmbedContracts(path),
        (err: Error) => {
          assert.match(err.message, /addProperty: `target` must be a non-empty string/);
          return true;
        }
      );
    });
  });
});
