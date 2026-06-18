import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  computeReturnType,
  resolveContentSchemaRef,
  type SchemaLike,
  unwrapCollectionItemRef,
  usesPaginatedResponse,
} from '../scripts/lib/sdk-gen-utils.js';

// A products-shaped registry: the wrapper nests `values.items.$ref` under
// `allOf` + a CollectionBase, exactly like specs/fixed/products.yaml. A shallow
// top-level `properties.values` check would miss this and leave products broken.
const schemas: Record<string, SchemaLike> = {
  CollectionBase: {
    properties: {
      links: { type: 'array' } as SchemaLike,
      total: { type: 'integer' } as SchemaLike,
    },
  },
  VarietyCollection: {
    allOf: [
      { $ref: '#/components/schemas/CollectionBase' },
      { properties: { values: { items: { $ref: '#/components/schemas/Variety' } } } },
    ],
  },
  Variety: { properties: { name: { type: 'string' } as SchemaLike } },
};

describe('generate-sdk helpers', () => {
  describe('unwrapCollectionItemRef', () => {
    it('unwraps an allOf/CollectionBase wrapper to its item', () => {
      assert.strictEqual(unwrapCollectionItemRef('VarietyCollection', schemas), 'Variety');
    });

    it('unwraps a top-level values.items.$ref wrapper', () => {
      const direct: Record<string, SchemaLike> = {
        Wrap: { properties: { values: { items: { $ref: '#/components/schemas/Item' } } } },
        Item: {},
      };
      assert.strictEqual(unwrapCollectionItemRef('Wrap', direct), 'Item');
    });

    it('returns undefined for a non-wrapper schema (no values array)', () => {
      assert.strictEqual(unwrapCollectionItemRef('Variety', schemas), undefined);
    });

    it('returns undefined for an unknown schema name', () => {
      assert.strictEqual(unwrapCollectionItemRef('Nope', schemas), undefined);
      assert.strictEqual(unwrapCollectionItemRef('X', undefined), undefined);
    });

    it('is cycle-guarded against self-referential allOf', () => {
      const cyclic: Record<string, SchemaLike> = {
        A: { allOf: [{ $ref: '#/components/schemas/A' }] },
      };
      assert.strictEqual(unwrapCollectionItemRef('A', cyclic), undefined);
    });
  });

  describe('resolveContentSchemaRef', () => {
    it('(a) COLLECTION + direct $ref to a wrapper -> item', () => {
      assert.strictEqual(
        resolveContentSchemaRef({ $ref: '#/components/schemas/VarietyCollection' }, schemas, true),
        'Variety'
      );
    });

    it('(b) SINGLE-resource + direct $ref to a wrapper -> wrapper unchanged (collection gate)', () => {
      assert.strictEqual(
        resolveContentSchemaRef({ $ref: '#/components/schemas/VarietyCollection' }, schemas, false),
        'VarietyCollection'
      );
    });

    it('(c) SINGLE-resource + inline values.items.$ref -> item (branch 2 unconditional)', () => {
      assert.strictEqual(
        resolveContentSchemaRef(
          { properties: { values: { items: { $ref: '#/components/schemas/equipment' } } } },
          schemas,
          false
        ),
        'equipment'
      );
    });

    it('(d) COLLECTION + direct $ref to a non-wrapper -> unchanged', () => {
      assert.strictEqual(
        resolveContentSchemaRef({ $ref: '#/components/schemas/Variety' }, schemas, true),
        'Variety'
      );
    });

    it('returns undefined when the schema names nothing', () => {
      assert.strictEqual(resolveContentSchemaRef(undefined, schemas, true), undefined);
      assert.strictEqual(
        resolveContentSchemaRef({ type: 'object' } as SchemaLike, schemas, true),
        undefined
      );
    });
  });

  describe('computeReturnType', () => {
    it('DELETE -> void', () => {
      assert.strictEqual(computeReturnType({ method: 'delete', isCollection: false }), 'void');
    });

    it('collection GET with item ref -> PaginatedResponse<item>', () => {
      assert.strictEqual(
        computeReturnType({ method: 'get', isCollection: true, responseSchemaRef: 'Variety' }),
        "PaginatedResponse<components['schemas']['Variety']>"
      );
    });

    it('single GET with ref -> the item type', () => {
      assert.strictEqual(
        computeReturnType({ method: 'get', isCollection: false, responseSchemaRef: 'equipment' }),
        "components['schemas']['equipment']"
      );
    });

    it('collection GET with NO ref -> PaginatedResponse<unknown> (fallback, not bare unknown)', () => {
      assert.strictEqual(
        computeReturnType({ method: 'get', isCollection: true }),
        'PaginatedResponse<unknown>'
      );
    });

    it('POST/PUT/PATCH with no ref -> void', () => {
      assert.strictEqual(computeReturnType({ method: 'post', isCollection: false }), 'void');
      assert.strictEqual(computeReturnType({ method: 'put', isCollection: false }), 'void');
    });

    it('non-collection GET with no ref -> unknown', () => {
      assert.strictEqual(computeReturnType({ method: 'get', isCollection: false }), 'unknown');
    });
  });

  describe('usesPaginatedResponse', () => {
    it('is true for any collection GET, even one whose item ref is missing', () => {
      assert.strictEqual(usesPaginatedResponse([{ method: 'get', isCollection: true }]), true);
    });

    it('is false when no operation is a collection GET', () => {
      assert.strictEqual(
        usesPaginatedResponse([
          { method: 'get', isCollection: false, responseSchemaRef: 'X' },
          { method: 'post', isCollection: false },
        ]),
        false
      );
    });
  });
});
