/**
 * Permanent regression test for the COMMITTED scripts/api-surface.yaml
 * manifest (not a fixture). Loading the real file means CI validates every
 * future hand edit or generator auto-append against the same rules
 * loadApiSurface enforces (see scripts/lib/api-surface.ts). This file also
 * locks a handful of publicly shipped method names that must never silently
 * rebind if an upstream spec ever reorders its paths block.
 *
 * Tests run from the repo root, so the default cwd-based path in
 * loadApiSurface() resolves to the real scripts/api-surface.yaml. The manifest
 * was originally seeded by a one-time script (since removed) and is now
 * maintained by generate-sdk's additive auto-append; see the file's git history
 * for its provenance.
 *
 * Pinned pairs were verified against the "@generated from" JSDoc lines in
 * the committed src/api/field-operations-api.ts, src/api/equipment.ts,
 * src/api/products.ts, and src/api/crop-types.ts before being written here.
 *
 * Lookups below match by the entry's exact "op" string (method + raw path
 * with real param names), never by normalized opKey. crop-types declares two
 * sibling operations, GET /cropTypes/{name} and GET /cropTypes/{id}, that
 * collapse to the same normalized identity; a normalized-key lookup could
 * silently return the wrong sibling. Exact-string matching is unambiguous
 * for every entry, since loadApiSurface already rejects a duplicate raw op
 * within one spec.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { loadApiSurface } from '../scripts/lib/api-surface.js';

describe('committed api-surface manifest', () => {
  it('loads without throwing', () => {
    assert.doesNotThrow(() => loadApiSurface());
  });

  const pinned: ReadonlyArray<{ spec: string; op: string; name: string }> = [
    { spec: 'field-operations-api', op: 'GET /fieldOperations/{operationId}', name: 'get' },
    { spec: 'field-operations-api', op: 'GET /fieldOps/{operationId}', name: 'getFieldops' },
    {
      spec: 'field-operations-api',
      op: 'GET /organizations/{orgId}/fields/{fieldId}/fieldOperations',
      name: 'list',
    },
    { spec: 'equipment', op: 'GET /equipment', name: 'get' },
    { spec: 'equipment', op: 'GET /equipment/{id}', name: 'getEquipment' },
    { spec: 'products', op: 'GET /organizations/{organizationId}/varieties', name: 'list' },
    {
      spec: 'products',
      op: 'GET /organizations/{organizationId}/varieties/{erid}',
      name: 'get',
    },
    // Sibling operations sharing a normalized identity (GET /cropTypes/{_}),
    // distinguished only by exact raw path: the real-world case the
    // manifest's ambiguous-group rule exists to support.
    { spec: 'crop-types', op: 'GET /cropTypes/{name}', name: 'get' },
    { spec: 'crop-types', op: 'GET /cropTypes/{id}', name: 'getCroptypes' },
  ];

  for (const { spec, op, name } of pinned) {
    it(`pins ${spec}: ${op} -> ${name}`, () => {
      const surface = loadApiSurface();
      const entry = (surface.specs[spec] ?? []).find((e) => e.op === op);
      assert.ok(entry, `no entry found for ${op} in spec "${spec}"`);
      assert.strictEqual(entry?.name, name);
    });
  }

  it('pins the equipment counter-quirk names (getEquipmentisgtypes, getEquipmentisgtypes2, getEquipmentmodels2)', () => {
    const surface = loadApiSurface();
    const names = new Set((surface.specs.equipment ?? []).map((entry) => entry.name));
    assert.ok(names.has('getEquipmentisgtypes'), 'missing getEquipmentisgtypes');
    assert.ok(names.has('getEquipmentisgtypes2'), 'missing getEquipmentisgtypes2');
    assert.ok(names.has('getEquipmentmodels2'), 'missing getEquipmentmodels2');
  });

  it('no spec contains an entry named listAll (always a derived twin, never pinned)', () => {
    const surface = loadApiSurface();
    for (const [specName, entries] of Object.entries(surface.specs)) {
      for (const entry of entries) {
        assert.notStrictEqual(entry.name, 'listAll', `${specName}: ${entry.op} is named listAll`);
      }
    }
  });

  it('has at least 120 total entries across all specs (floor, not exact match, so future additive syncs do not break this test)', () => {
    const surface = loadApiSurface();
    const total = Object.values(surface.specs).reduce((sum, entries) => sum + entries.length, 0);
    assert.ok(total >= 120, `expected >= 120 total entries, got ${total}`);
  });
});
