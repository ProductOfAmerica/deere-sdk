import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  isDocumentationKey,
  restoreEquipmentItemRefs,
  sanitizePropertyKey,
  stripDocumentationMarkup,
  stripTypeDiscriminators,
} from '../scripts/lib/spec-utils.js';

describe('fix-specs utilities', () => {
  describe('isDocumentationKey', () => {
    it('detects keys wrapped entirely in HTML tags', () => {
      assert.strictEqual(isDocumentationKey('<b>Location</b>'), true);
      assert.strictEqual(isDocumentationKey('<b>Identity</b>'), true);
      assert.strictEqual(isDocumentationKey('<span>Section</span>'), true);
    });

    it('rejects normal property keys', () => {
      assert.strictEqual(isDocumentationKey('createdTime'), false);
      assert.strictEqual(isDocumentationKey('id'), false);
      assert.strictEqual(isDocumentationKey('type'), false);
    });

    it('rejects keys with embedded HTML (not fully wrapped)', () => {
      assert.strictEqual(isDocumentationKey('createdTime<sup>DEPRECATED</sup>'), false);
      assert.strictEqual(isDocumentationKey('type<sup><a href="#foo">1</a></sup>'), false);
    });
  });

  describe('sanitizePropertyKey', () => {
    it('strips DEPRECATED markers', () => {
      assert.strictEqual(sanitizePropertyKey('createdTime<sup>DEPRECATED</sup>'), 'createdTime');
      assert.strictEqual(sanitizePropertyKey('referenceId<sup>DEPRECATED</sup>'), 'referenceId');
      assert.strictEqual(sanitizePropertyKey('timeRange<sup>DEPRECATED</sup>'), 'timeRange');
    });

    it('strips footnote references with nested anchor tags', () => {
      assert.strictEqual(
        sanitizePropertyKey("createdTime<sup><a href='#additional-date-time'>2</a></sup>"),
        'createdTime'
      );
      assert.strictEqual(
        sanitizePropertyKey("type<sup><a href='#additional-type'>1</a></sup>"),
        'type'
      );
      assert.strictEqual(
        sanitizePropertyKey(
          "fieldOperationType<sup><a href='#field-operation-additional'>1</a></sup>"
        ),
        'fieldOperationType'
      );
    });

    it('strips footnotes with double quotes in href', () => {
      assert.strictEqual(
        sanitizePropertyKey('severity<sup><a href="#event-severity">1</a></sup>'),
        'severity'
      );
    });

    it('leaves clean keys unchanged', () => {
      assert.strictEqual(sanitizePropertyKey('createdTime'), 'createdTime');
      assert.strictEqual(sanitizePropertyKey('id'), 'id');
      assert.strictEqual(sanitizePropertyKey('name'), 'name');
    });

    it('handles multiple sup tags (edge case)', () => {
      assert.strictEqual(sanitizePropertyKey('field<sup>1</sup><sup>2</sup>'), 'field');
    });

    it('strips standalone tags after sup removal', () => {
      assert.strictEqual(sanitizePropertyKey('field<b>bold</b>'), 'fieldbold');
    });
  });

  describe('stripDocumentationMarkup', () => {
    it('strips tags without reintroducing nested script markup', () => {
      const stripped = stripDocumentationMarkup('<scrip<script>alert(1)</script>t>safe</script>');

      assert.strictEqual(stripped.includes('<script'), false);
    });

    it('can drop documentation-only tag contents', () => {
      assert.strictEqual(
        stripDocumentationMarkup('createdTime<sup><a href="#foo">2</a></sup>', {
          dropTagContent: ['sup'],
        }),
        'createdTime'
      );
    });

    it('can replace line-break style tags', () => {
      assert.strictEqual(
        stripDocumentationMarkup('first<br/>second</p>third', {
          replaceTags: { br: '\n', p: '\n' },
        }),
        'first\nsecond\nthird'
      );
    });
  });

  describe('stripTypeDiscriminators', () => {
    it('removes only discriminators whose propertyName is @type', () => {
      const spec = {
        components: {
          schemas: {
            resource: {
              type: 'object',
              properties: { '@type': { type: 'string' } },
              discriminator: { propertyName: '@type' },
            },
            // A legitimately-discriminated union on some other property is kept.
            shape: {
              type: 'object',
              discriminator: { propertyName: 'kind' },
            },
            plain: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      };

      const removed = stripTypeDiscriminators(spec);

      assert.strictEqual(removed, 1);
      assert.strictEqual('discriminator' in spec.components.schemas.resource, false);
      // The rest of the schema is preserved.
      assert.deepStrictEqual(spec.components.schemas.resource.properties, {
        '@type': { type: 'string' },
      });
      // Non-@type discriminator untouched.
      assert.deepStrictEqual(spec.components.schemas.shape.discriminator, {
        propertyName: 'kind',
      });
      // Plain schema untouched.
      assert.deepStrictEqual(spec.components.schemas.plain, {
        type: 'object',
        properties: { id: { type: 'string' } },
      });
    });

    it('counts every @type discriminator across schemas', () => {
      const spec = {
        components: {
          schemas: {
            a: { discriminator: { propertyName: '@type' } },
            b: { discriminator: { propertyName: '@type' } },
            c: {},
          },
        },
      };
      assert.strictEqual(stripTypeDiscriminators(spec), 2);
    });

    it('is a no-op for specs without components.schemas', () => {
      assert.strictEqual(stripTypeDiscriminators({}), 0);
      assert.strictEqual(stripTypeDiscriminators({ components: {} }), 0);
    });
  });

  describe('restoreEquipmentItemRefs', () => {
    interface ValuesEnvelope {
      type?: string;
      items?: { $ref?: string };
    }
    type EnvelopeResponse = {
      content: Record<string, { schema: { type: string; properties: { values: ValuesEnvelope } } }>;
    };
    // Mirror the two regressed 200 responses: a values-shaped envelope whose
    // items ref JD's 2026-07 doc edit dropped down to a bare `type: array`.
    function envelopeResponse(values: ValuesEnvelope = { type: 'array' }): EnvelopeResponse {
      return {
        content: {
          'application/json': { schema: { type: 'object', properties: { values } } },
        },
      };
    }
    function itemsOf(response: EnvelopeResponse): { $ref?: string } | undefined {
      return response.content['application/json'].schema.properties.values.items;
    }

    it('restores the item ref when it is absent and the target schema is present', () => {
      const getEquipment = envelopeResponse();
      const getEquipmentById = envelopeResponse();
      const spec = {
        components: {
          schemas: { equipmentForList: { type: 'object' }, equipment: { type: 'object' } },
          responses: { GetEquipment: getEquipment, GetEquipmentById: getEquipmentById },
        },
      };

      const restored = restoreEquipmentItemRefs(spec);

      assert.strictEqual(restored, 2);
      assert.deepStrictEqual(itemsOf(getEquipment), {
        $ref: '#/components/schemas/equipmentForList',
      });
      assert.deepStrictEqual(itemsOf(getEquipmentById), {
        $ref: '#/components/schemas/equipment',
      });
    });

    it('no-ops when the item ref is already present (does not overwrite a repaired doc)', () => {
      const getEquipment = envelopeResponse({
        items: { $ref: '#/components/schemas/equipmentForList' },
      });
      const spec = {
        components: {
          schemas: { equipmentForList: { type: 'object' } },
          responses: { GetEquipment: getEquipment },
        },
      };

      assert.strictEqual(restoreEquipmentItemRefs(spec), 0);
      // The pre-existing ref is preserved, not rewritten.
      assert.deepStrictEqual(itemsOf(getEquipment), {
        $ref: '#/components/schemas/equipmentForList',
      });
    });

    it('no-ops when the target schema is missing (never resurrects a dangling ref)', () => {
      const getEquipment = envelopeResponse();
      const spec = {
        components: {
          schemas: {},
          responses: { GetEquipment: getEquipment },
        },
      };

      assert.strictEqual(restoreEquipmentItemRefs(spec), 0);
      assert.strictEqual(itemsOf(getEquipment), undefined);
    });

    it('touches only the two registered responses, leaving other envelopes alone', () => {
      const getEquipment = envelopeResponse();
      const getEquipmentById = envelopeResponse();
      const somethingElse = envelopeResponse();
      const spec = {
        components: {
          schemas: {
            equipmentForList: { type: 'object' },
            equipment: { type: 'object' },
            other: { type: 'object' },
          },
          responses: {
            GetEquipment: getEquipment,
            GetEquipmentById: getEquipmentById,
            SomethingElse: somethingElse,
          },
        },
      };

      const restored = restoreEquipmentItemRefs(spec);

      assert.strictEqual(restored, 2);
      assert.deepStrictEqual(itemsOf(getEquipment), {
        $ref: '#/components/schemas/equipmentForList',
      });
      assert.deepStrictEqual(itemsOf(getEquipmentById), {
        $ref: '#/components/schemas/equipment',
      });
      // An unregistered values-shaped response is left untouched.
      assert.strictEqual(itemsOf(somethingElse), undefined);
    });

    it('is a no-op for specs without components.responses or components.schemas', () => {
      assert.strictEqual(restoreEquipmentItemRefs({}), 0);
      assert.strictEqual(restoreEquipmentItemRefs({ components: {} }), 0);
    });
  });
});
