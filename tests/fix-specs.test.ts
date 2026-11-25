import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as yaml from 'yaml';
import {
  fixProseEnums,
  isDocumentationKey,
  PROSE_ENUM_FIXES,
  type ProseEnumFix,
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

    it('restores through the vnd.deere.axiom media type, preferring it over application/json', () => {
      // The generator resolves a response's schema from the vnd media type first
      // (extractSchemaFromContent prefers application/vnd.deere.axiom.v3+json),
      // so restoreEquipmentItemRefs must land the ref there. Declare BOTH media
      // types and prove only the preferred vnd envelope is touched.
      const vndValues: ValuesEnvelope = { type: 'array' };
      const jsonValues: ValuesEnvelope = { type: 'array' };
      const getEquipment = {
        content: {
          'application/vnd.deere.axiom.v3+json': {
            schema: { type: 'object', properties: { values: vndValues } },
          },
          'application/json': {
            schema: { type: 'object', properties: { values: jsonValues } },
          },
        },
      };
      const spec = {
        components: {
          schemas: { equipmentForList: { type: 'object' } },
          responses: { GetEquipment: getEquipment },
        },
      };

      const restored = restoreEquipmentItemRefs(spec);

      assert.strictEqual(restored, 1);
      // The preferred vnd envelope gets the ref...
      assert.deepStrictEqual(vndValues.items, { $ref: '#/components/schemas/equipmentForList' });
      // ...and the application/json envelope is left untouched.
      assert.strictEqual(jsonValues.items, undefined);
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

  describe('fixProseEnums', () => {
    const DROP: ProseEnumFix = {
      spec: 'equipment',
      at: ['components', 'parameters', 'ModelName', 'schema'],
      prose: 'string or partial string',
      replacement: null,
      evidence: 'test fixture',
    };
    const REPLACE: ProseEnumFix = {
      spec: 'products',
      at: ['components', 'schemas', 'Status', 'properties', 'key'],
      prose: 'registration (chemicals only)',
      replacement: 'registration',
      evidence: 'test fixture',
    };
    const parameterSpec = (values: unknown[]) => ({
      components: { parameters: { ModelName: { schema: { type: 'string', enum: values } } } },
    });
    const schemaSpec = (values: unknown[]) => ({
      components: {
        schemas: { Status: { properties: { key: { type: 'string', enum: values } } } },
      },
    });

    it('drops an enum whose only member is the registered prose and keeps the type', () => {
      const spec = parameterSpec(['string or partial string']);
      assert.strictEqual(fixProseEnums(spec, 'equipment', [DROP]), 1);
      assert.deepStrictEqual(spec.components.parameters.ModelName.schema, { type: 'string' });
    });

    it('replaces the prose inside a mixed enum and keeps the other values in order', () => {
      const spec = schemaSpec(['isCarrier', 'archived', 'registration (chemicals only)']);
      assert.strictEqual(fixProseEnums(spec, 'products', [REPLACE]), 1);
      assert.deepStrictEqual(spec.components.schemas.Status.properties.key.enum, [
        'isCarrier',
        'archived',
        'registration',
      ]);
    });

    it('does not duplicate the replacement when the real value is already listed', () => {
      const spec = schemaSpec(['registration', 'registration (chemicals only)', 'archived']);
      assert.strictEqual(fixProseEnums(spec, 'products', [REPLACE]), 1);
      assert.deepStrictEqual(spec.components.schemas.Status.properties.key.enum, [
        'registration',
        'archived',
      ]);
    });

    it('no-ops once the prose is gone (a repaired document)', () => {
      const spec = schemaSpec(['isCarrier', 'archived', 'registration']);
      assert.strictEqual(fixProseEnums(spec, 'products', [REPLACE]), 0);
      assert.deepStrictEqual(spec.components.schemas.Status.properties.key.enum, [
        'isCarrier',
        'archived',
        'registration',
      ]);
    });

    it('no-ops for another spec that has the same location and string', () => {
      const spec = parameterSpec(['string or partial string']);
      assert.strictEqual(fixProseEnums(spec, 'fields', [DROP]), 0);
      assert.deepStrictEqual(spec.components.parameters.ModelName.schema.enum, [
        'string or partial string',
      ]);
    });

    it('no-ops when the location is missing or carries no enum', () => {
      assert.strictEqual(fixProseEnums({}, 'equipment', [DROP]), 0);
      assert.strictEqual(
        fixProseEnums(
          { components: { parameters: { ModelName: { schema: { type: 'string' } } } } },
          'equipment',
          [DROP]
        ),
        0
      );
    });

    it('leaves an unregistered enum value alone even when it contains spaces', () => {
      const spec = parameterSpec(['Engines & Components', 'Commercial Worksite Products']);
      assert.strictEqual(fixProseEnums(spec, 'equipment', [DROP]), 0);
      assert.deepStrictEqual(spec.components.parameters.ModelName.schema.enum, [
        'Engines & Components',
        'Commercial Worksite Products',
      ]);
    });

    it('throws when a drop entry finds real values beside the prose', () => {
      const spec = parameterSpec(['string or partial string', '9RX*']);
      assert.throws(() => fixProseEnums(spec, 'equipment', [DROP]), /other values too/);
    });

    // A reworded sentence is not a repair. Skipping it would put the new
    // sentence into the generated types with nothing to notice.
    it('throws when a drop entry finds the sentence reworded', () => {
      const spec = parameterSpec(['a string, or part of one, with * wildcards']);
      assert.throws(() => fixProseEnums(spec, 'equipment', [DROP]), /different lone value/);
      assert.deepStrictEqual(spec.components.parameters.ModelName.schema.enum, [
        'a string, or part of one, with * wildcards',
      ]);
    });

    it('no-ops when a drop entry finds a real enum with several members', () => {
      const spec = parameterSpec(['9RX420', '9RX470']);
      assert.strictEqual(fixProseEnums(spec, 'equipment', [DROP]), 0);
      assert.deepStrictEqual(spec.components.parameters.ModelName.schema.enum, [
        '9RX420',
        '9RX470',
      ]);
    });

    it('throws when a replace entry finds the note reworded', () => {
      const spec = schemaSpec(['isCarrier', 'archived', 'registration (not for carriers)']);
      assert.throws(() => fixProseEnums(spec, 'products', [REPLACE]), /with other words/);
    });

    it('no-ops when a replace entry finds neither the prose nor anything like it', () => {
      const spec = schemaSpec(['isCarrier', 'archived']);
      assert.strictEqual(fixProseEnums(spec, 'products', [REPLACE]), 0);
      assert.deepStrictEqual(spec.components.schemas.Status.properties.key.enum, [
        'isCarrier',
        'archived',
      ]);
    });

    describe('against the committed specs', () => {
      const fixedSpec = (spec: string): unknown =>
        yaml.parse(readFileSync(join(process.cwd(), 'specs', 'fixed', `${spec}.yaml`), 'utf8'));

      /** Every enum in a document, with the path of the schema that owns it. */
      function* enums(node: unknown, path: string[] = []): Generator<[string, unknown[]]> {
        if (Array.isArray(node)) {
          for (const [index, item] of node.entries()) yield* enums(item, [...path, String(index)]);
        } else if (node !== null && typeof node === 'object') {
          const record = node as Record<string, unknown>;
          if (Array.isArray(record.enum)) yield [path.join('/'), record.enum];
          for (const [key, value] of Object.entries(record)) yield* enums(value, [...path, key]);
        }
      }

      // codegen-drift only proves that regenerating reproduces what is
      // committed, so it would not notice fix-specs no longer calling the
      // transform. This looks at every enum in the spec, not only the
      // registered locations, so it also fails when John Deere renames a
      // component and the prose comes back under the new name.
      //
      // There is deliberately no test for the opposite case, an entry that
      // John Deere's repair has made redundant. The sync runs this suite
      // before it commits, so such a test would stop the sync after an
      // upstream improvement, over an entry that is by then inert. A redundant
      // entry is skipped, as restoreEquipmentItemRefs does. A REWORDED one is
      // not redundant: fixProseEnums throws on it, which fails the sync itself.
      it('no registered prose is left in any enum of specs/fixed', () => {
        for (const spec of new Set(PROSE_ENUM_FIXES.map((fix) => fix.spec))) {
          const prose = PROSE_ENUM_FIXES.filter((fix) => fix.spec === spec).map((fix) => fix.prose);
          const left = [...enums(fixedSpec(spec))]
            .filter(([, values]) => values.some((value) => prose.includes(value as string)))
            .map(([path]) => `${spec} ${path}`);
          assert.deepStrictEqual(left, []);
        }
      });
    });
  });
});
