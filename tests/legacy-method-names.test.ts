import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  inferLegacyMethodName,
  type LegacyNamedOp,
  resolveLegacyMethodNames,
} from '../scripts/lib/legacy-method-names.js';

describe('legacy-method-names', () => {
  describe('inferLegacyMethodName: operationId heuristics', () => {
    it('getall* maps to list', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'getAllWidgets',
          method: 'get',
          path: '/widgets',
          isCollection: true,
        }),
        'list'
      );
    });

    it('list* maps to list', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'listFields',
          method: 'get',
          path: '/fields',
          isCollection: true,
        }),
        'list'
      );
    });

    it('/^get[a-z]+s$/ maps to list', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'getFields',
          method: 'get',
          path: '/fields',
          isCollection: true,
        }),
        'list'
      );
    });

    it('get* (no "all") maps to get', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'getField',
          method: 'get',
          path: '/fields/{id}',
          isCollection: false,
        }),
        'get'
      );
    });

    it('get* containing "all" anywhere is excluded from the get branch by the includes("all") guard', () => {
      // Preserved quirk: the guard is `!id.includes('all')`, not a narrower
      // `!id.startsWith('getall')`. isCollection: true makes this
      // discriminating: if the guard were broken this would incorrectly
      // return 'get' instead of falling through to the HTTP-method
      // fallback's 'list'.
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'getFallbackField',
          method: 'get',
          path: '/fallbackFields',
          isCollection: true,
        }),
        'list'
      );
    });

    it('create* maps to create', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'createWidget',
          method: 'post',
          path: '/widgets',
          isCollection: false,
        }),
        'create'
      );
    });

    it('post* (not containing "get") maps to create', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'postWidget',
          method: 'post',
          path: '/widgets',
          isCollection: false,
        }),
        'create'
      );
    });

    it('update* maps to update', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'updateWidget',
          method: 'put',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'update'
      );
    });

    it('put* maps to update', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'putWidget',
          method: 'put',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'update'
      );
    });

    it('delete* maps to delete', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'deleteWidget',
          method: 'delete',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'delete'
      );
    });

    it('remove* maps to delete', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: 'removeWidget',
          method: 'delete',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'delete'
      );
    });
  });

  describe('inferLegacyMethodName: HTTP-method fallback (operationId matches no heuristic)', () => {
    it('get + isCollection -> list', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'get',
          path: '/widgets',
          isCollection: true,
        }),
        'list'
      );
    });

    it('get + item -> get', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'get',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'get'
      );
    });

    it('post -> create', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'post',
          path: '/widgets',
          isCollection: false,
        }),
        'create'
      );
    });

    it('put -> update', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'put',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'update'
      );
    });

    it('patch -> patch', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'patch',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'patch'
      );
    });

    it('delete -> delete', () => {
      assert.strictEqual(
        inferLegacyMethodName({
          operationId: '',
          method: 'delete',
          path: '/widgets/{id}',
          isCollection: false,
        }),
        'delete'
      );
    });
  });

  describe('resolveLegacyMethodNames: collision and order sensitivity', () => {
    // The real incident shapes: two item endpoints that both infer the bare
    // 'get' name (operationId left blank so the HTTP-method fallback fires
    // for both). Real toPascalCase semantics lowercase interior caps, so
    // /fieldOps/{id} suffixes to "Fieldops", not "FieldOps".
    const fieldOperationsOp: LegacyNamedOp = {
      operationId: '',
      method: 'get',
      path: '/fieldOperations/{operationId}',
      isCollection: false,
    };
    const fieldOpsOp: LegacyNamedOp = {
      operationId: '',
      method: 'get',
      path: '/fieldOps/{operationId}',
      isCollection: false,
    };

    it('two ops both inferring get: the second gets a PascalCased last-non-param-segment suffix', () => {
      const names = resolveLegacyMethodNames([fieldOperationsOp, fieldOpsOp]);
      assert.strictEqual(names.get('GET /fieldOperations/{operationId}'), 'get');
      assert.strictEqual(names.get('GET /fieldOps/{operationId}'), 'getFieldops');
    });

    // ORDER SENSITIVITY (deliberate): this test freezes the bug this branch
    // exists to remove. It documents CURRENT behavior only. Feeding the
    // same two colliding ops in reversed order silently swaps which one
    // gets the bare 'get' name. This test (and the module it tests) is
    // deleted once the manifest-based naming lands in a later commit.
    it('reversing input order swaps which op gets the bare name', () => {
      const names = resolveLegacyMethodNames([fieldOpsOp, fieldOperationsOp]);
      assert.strictEqual(names.get('GET /fieldOps/{operationId}'), 'get');
      assert.strictEqual(names.get('GET /fieldOperations/{operationId}'), 'getFieldoperations');
    });
  });

  describe('resolveLegacyMethodNames: cumulative counter quirk', () => {
    it('a third collision on the same base+suffix appends the counter cumulatively (getX, getX2, getX23)', () => {
      // Preserved quirk: the while-loop counter appends to the
      // already-suffixed methodName each iteration rather than restarting
      // from the base+suffix, so a third collision on the same pair
      // produces "getX23", not "getX3".
      const ops: LegacyNamedOp[] = [
        // Claims the bare 'get' name so the next three all collide.
        { operationId: '', method: 'get', path: '/seed/{id}', isCollection: false },
        // All three share the same last-non-param segment ("x"), so they
        // all suffix to the same "X" and collide with each other in turn.
        { operationId: '', method: 'get', path: '/a/{aId}/x/{xId}', isCollection: false },
        { operationId: '', method: 'get', path: '/b/{bId}/x/{xId}', isCollection: false },
        { operationId: '', method: 'get', path: '/c/{cId}/x/{xId}', isCollection: false },
      ];

      const names = resolveLegacyMethodNames(ops);

      assert.strictEqual(names.get('GET /seed/{id}'), 'get');
      assert.strictEqual(names.get('GET /a/{aId}/x/{xId}'), 'getX');
      assert.strictEqual(names.get('GET /b/{bId}/x/{xId}'), 'getX2');
      assert.strictEqual(names.get('GET /c/{cId}/x/{xId}'), 'getX23');
    });
  });

  describe('resolveLegacyMethodNames: real equipment.yaml collision chain', () => {
    // Reproduces the exact operationIds and paths declared in
    // specs/fixed/equipment.yaml, in file order, verified against the
    // committed src/api/equipment.ts. GET /equipment and GET /equipment/{id}
    // have no operationId in the spec, so parseSpec's synthesized fallback
    // ("get" + path letters only) applies. GET /equipmentMakes is not one of
    // the five asserted names below. It is required scaffolding: it is
    // what claims the bare 'list' name first, which is why GET
    // /equipmentISGTypes collides into 'listEquipmentisgtypes' instead of
    // staying 'list'.
    it('locks in the five real method names shipped in src/api/equipment.ts', () => {
      const ops: LegacyNamedOp[] = [
        { operationId: 'getequipment', method: 'get', path: '/equipment', isCollection: true },
        {
          operationId: 'getequipmentid',
          method: 'get',
          path: '/equipment/{id}',
          isCollection: false,
        },
        {
          operationId: 'getEquipmentMakes',
          method: 'get',
          path: '/equipmentMakes',
          isCollection: true,
        },
        {
          operationId: 'getEquipmentISGTypes',
          method: 'get',
          path: '/equipmentISGTypes',
          isCollection: true,
        },
        {
          operationId: 'getEquipmentISGTypesByMakeId',
          method: 'get',
          path: '/equipmentMakes/{equipmentMakeId}/equipmentISGTypes',
          isCollection: true,
        },
        {
          operationId: 'getEquipmentISGTypeByMakeIdAndISGTypeId',
          method: 'get',
          path: '/equipmentMakes/{equipmentMakeId}/equipmentISGTypes/{equipmentISGTypeId}',
          isCollection: false,
        },
      ];

      const names = resolveLegacyMethodNames(ops);

      assert.strictEqual(names.get('GET /equipment'), 'get');
      assert.strictEqual(names.get('GET /equipment/{id}'), 'getEquipment');
      assert.strictEqual(names.get('GET /equipmentMakes'), 'list');
      assert.strictEqual(names.get('GET /equipmentISGTypes'), 'listEquipmentisgtypes');
      assert.strictEqual(
        names.get('GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes'),
        'getEquipmentisgtypes'
      );
      assert.strictEqual(
        names.get('GET /equipmentMakes/{equipmentMakeId}/equipmentISGTypes/{equipmentISGTypeId}'),
        'getEquipmentisgtypes2'
      );
    });
  });
});
