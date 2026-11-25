import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as yaml from 'yaml';
import {
  RETAINED_ENUM_VALUES,
  RETAINED_ENUM_VALUES_KEY,
  type RetainedEnumValue,
  retainEnumValues,
} from '../scripts/lib/spec-retained-enums.js';

const KEEP: RetainedEnumValue = {
  spec: 'equipment',
  parameter: 'Embed',
  operations: ['GET /equipment/{id}'],
  value: 'capabilities',
  replacement: 'capabilities.Connectivity',
  observed: '2026-11-24',
  evidence: 'test',
  removeInMajor: 4,
};

const EMBED = { $ref: '#/components/parameters/Embed' };

/** A document whose Embed parameter lists `values`, referenced as `paths` say. */
const doc = (
  values: unknown[],
  paths: Record<string, unknown> = { '/equipment/{id}': { get: { parameters: [EMBED] } } }
) => ({
  paths,
  components: {
    parameters: { Embed: { name: 'embed', in: 'query', schema: { type: 'string', enum: values } } },
  },
});

describe('retainEnumValues', () => {
  it('puts the value back just before its replacement and stamps the schema', () => {
    const spec = doc(['devices', 'capabilities.Connectivity', 'icon']);
    assert.strictEqual(retainEnumValues(spec, 'equipment', [KEEP]), 1);
    assert.deepStrictEqual(spec.components.parameters.Embed.schema, {
      type: 'string',
      enum: ['devices', 'capabilities', 'capabilities.Connectivity', 'icon'],
      [RETAINED_ENUM_VALUES_KEY]: ['capabilities'],
    });
  });

  it('adds to the stamp an earlier entry left on the same schema', () => {
    const spec = doc(['offsets', 'capabilities.Connectivity']);
    const earlier: RetainedEnumValue = { ...KEEP, value: 'icon', replacement: 'offsets' };
    assert.strictEqual(retainEnumValues(spec, 'equipment', [earlier, KEEP]), 2);
    assert.deepStrictEqual(spec.components.parameters.Embed.schema, {
      type: 'string',
      enum: ['icon', 'offsets', 'capabilities', 'capabilities.Connectivity'],
      [RETAINED_ENUM_VALUES_KEY]: ['icon', 'capabilities'],
    });
  });

  // Listing the value again makes the entry inert, and stopping the sync over
  // that would block an upstream improvement. A replacement that went at the
  // same time changes getEquipment's signature, which stops the sync instead.
  it('no-ops once John Deere lists the value again, with or without the replacement', () => {
    for (const values of [
      ['capabilities', 'capabilities.Connectivity'],
      ['devices', 'capabilities'],
    ]) {
      const spec = doc([...values]);
      assert.strictEqual(retainEnumValues(spec, 'equipment', [KEEP]), 0);
      assert.deepStrictEqual(spec.components.parameters.Embed.schema, {
        type: 'string',
        enum: values,
      });
    }
  });

  // The skip comes before the referrer check: a value Deere lists itself is
  // Deere's claim for every operation, so a new one using the parameter must
  // not stop the sync either.
  it('no-ops on a value listed again even when an unlisted operation references it', () => {
    const spec = doc(['capabilities', 'capabilities.Connectivity'], {
      '/equipment/{id}': { get: { parameters: [EMBED] } },
      '/equipment/{id}/devices': { get: { parameters: [EMBED] } },
    });
    assert.strictEqual(retainEnumValues(spec, 'equipment', [KEEP]), 0);
  });

  it('no-ops for another spec with the same parameter', () => {
    const spec = doc(['capabilities.Connectivity']);
    assert.strictEqual(retainEnumValues(spec, 'fields', [KEEP]), 0);
    assert.deepStrictEqual(spec.components.parameters.Embed.schema.enum, [
      'capabilities.Connectivity',
    ]);
  });

  it('matches its operations whatever their path parameters are called', () => {
    const spec = doc(['capabilities.Connectivity'], {
      '/equipment/{equipmentId}': { get: { parameters: [EMBED] } },
    });
    assert.strictEqual(retainEnumValues(spec, 'equipment', [KEEP]), 1);
  });

  it('counts a reference made by a path item for each operation under it', () => {
    const paths = { '/equipment/{id}': { parameters: [EMBED], get: {}, put: {} } };
    assert.throws(
      () => retainEnumValues(doc(['capabilities.Connectivity'], paths), 'equipment', [KEEP]),
      /is referenced by GET \/equipment\/\{id\}, PUT \/equipment\/\{id\} \(/
    );
    const both = { ...KEEP, operations: ['GET /equipment/{id}', 'PUT /equipment/{id}'] };
    assert.strictEqual(
      retainEnumValues(doc(['capabilities.Connectivity'], paths), 'equipment', [both]),
      1
    );
  });

  // A method John Deere adds would otherwise get the value too, and the sync
  // releases a new method without anyone reading it.
  it('throws when an operation the entry does not list references the parameter', () => {
    const spec = doc(['capabilities.Connectivity'], {
      '/equipment/{id}': { get: { parameters: [EMBED] } },
      '/equipment/{id}/devices': { get: { parameters: [EMBED] } },
    });
    assert.throws(
      () => retainEnumValues(spec, 'equipment', [KEEP]),
      /is referenced by GET \/equipment\/\{id\}, GET \/equipment\/\{id\}\/devices \(.*manifest entry's op:\)\. .*for GET \/equipment\/\{id\}\./
    );
  });

  it('throws when the operation it lists no longer references the parameter', () => {
    const spec = doc(['capabilities.Connectivity'], { '/equipment/{id}': { get: {} } });
    assert.throws(
      () => retainEnumValues(spec, 'equipment', [KEEP]),
      /is referenced by no operation/
    );
  });

  it('throws, naming the enum it found, when neither value is listed', () => {
    const spec = doc(['devices', 'capabilities.connectivity']);
    assert.throws(
      () => retainEnumValues(spec, 'equipment', [KEEP]),
      /lists \["devices","capabilities\.connectivity"\]\. .*keeps "capabilities" beside "capabilities\.Connectivity"/
    );
  });

  it('throws when the parameter or its enum is gone', () => {
    assert.throws(() => retainEnumValues({}, 'equipment', [KEEP]), /has no enum/);
    const noEnum = { components: { parameters: { Embed: { schema: { type: 'string' } } } } };
    assert.throws(() => retainEnumValues(noEnum, 'equipment', [KEEP]), /has no enum/);
  });
});

describe('the committed retained enum values', () => {
  const pkgMajor = Number(
    (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version.split('.')[0]
  );

  for (const entry of RETAINED_ENUM_VALUES) {
    const label = `${entry.spec} ${entry.parameter} "${entry.value}"`;

    // codegen-drift only proves that regenerating reproduces what is committed,
    // so it would not notice fix-specs no longer calling the transform. This
    // checks the value and not the stamp: once John Deere lists the value again
    // the entry stamps nothing, and that must not fail the sync. Whether the
    // entry is still needed is deliberately not tested, for the same reason.
    it(`${label}: is in specs/fixed`, () => {
      const fixed = yaml.parse(
        readFileSync(join(process.cwd(), 'specs', 'fixed', `${entry.spec}.yaml`), 'utf8')
      ) as { components?: { parameters?: Record<string, { schema?: { enum?: unknown[] } }> } };
      const values = fixed.components?.parameters?.[entry.parameter]?.schema?.enum ?? [];
      assert.ok(values.includes(entry.value), JSON.stringify(values));
    });

    it(`${label}: is deleted before major ${entry.removeInMajor} ships`, () => {
      assert.ok(
        pkgMajor < entry.removeInMajor,
        `package.json is at major ${pkgMajor}: delete this RETAINED_ENUM_VALUES entry as part of ` +
          `the major release. That drops "${entry.value}" from the generated types: run the ` +
          `offline stages, then pnpm accept-signatures, and update the doc comments and README ` +
          `examples that name the value (search src/safe and README.md).`
      );
    });
  }
});
