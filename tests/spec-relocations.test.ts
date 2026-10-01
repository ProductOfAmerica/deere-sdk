import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadApiSurface } from '../scripts/lib/api-surface.js';
import {
  applyRelocations,
  DEPRECATED_REPLACEMENT_KEY,
  RELOCATED_FROM_KEY,
  RELOCATIONS,
  type Relocation,
} from '../scripts/lib/spec-relocations.js';

const ENTRY: Relocation = {
  method: 'get',
  path: '/users/{userName}/organizations',
  into: 'organizations',
  from: 'users',
  replacement: 'deere.users.listOrganizations()',
  observed: '2026-10-01',
  evidence: 'test',
  removeInMajor: 4,
};

const OP = {
  summary: 'View User Orgs',
  parameters: [{ $ref: '#/components/parameters/UserName2' }],
  responses: {
    '200': {
      content: {
        'application/vnd.deere.axiom.v3+json': {
          schema: {
            properties: {
              values: { items: { $ref: '#/components/schemas/OrganizationViewGet' } },
            },
          },
        },
      },
    },
  },
};

const COMPONENTS = () => ({
  parameters: { UserName2: { name: 'userName', in: 'path', required: true } },
  schemas: {
    OrganizationViewGet: {
      properties: { links: { items: { $ref: '#/components/schemas/OrganizationLink2' } } },
    },
    OrganizationLink2: { properties: { rel: { type: 'string' } } },
  },
});

function usersDoc(withOp = true): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    paths: {
      '/users/{username}': { get: { summary: 'View User' } },
      ...(withOp ? { [ENTRY.path]: { get: structuredClone(OP) } } : {}),
    },
    components: COMPONENTS(),
  };
}

function orgsDoc(withOp = false): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    paths: {
      '/organizations': { get: { summary: 'List' } },
      ...(withOp ? { [ENTRY.path]: { get: structuredClone(OP) } } : {}),
    },
    components: COMPONENTS(),
  };
}

const run = (target: Record<string, unknown>, source: Record<string, unknown>) =>
  applyRelocations(target, 'organizations', new Map([['users', source]]), [ENTRY]);

describe('applyRelocations', () => {
  it('copies a moved operation back, deprecated and stamped, after the native paths', () => {
    const target = orgsDoc();
    const applied = run(target, usersDoc());
    assert.strictEqual(applied.length, 1);
    const paths = target.paths as Record<string, Record<string, Record<string, unknown>>>;
    assert.deepStrictEqual(Object.keys(paths), ['/organizations', ENTRY.path]);
    const op = paths[ENTRY.path].get;
    assert.strictEqual(op.deprecated, true);
    assert.strictEqual(op[RELOCATED_FROM_KEY], 'users');
    assert.match(String(op[DEPRECATED_REPLACEMENT_KEY]), /deere\.users\.listOrganizations\(\)/);
    assert.deepStrictEqual(op.parameters, OP.parameters);
    assert.deepStrictEqual(target.components, COMPONENTS());
  });

  it('copies referenced components the target lacks, transitively', () => {
    const target = orgsDoc();
    target.components = { schemas: {} };
    run(target, usersDoc());
    assert.deepStrictEqual(target.components, COMPONENTS());
  });

  it('throws when a shared component differs, leaving the target untouched', () => {
    const target = orgsDoc();
    const components = target.components as ReturnType<typeof COMPONENTS>;
    components.schemas.OrganizationLink2 = { properties: { rel: { type: 'integer' } } };
    const before = structuredClone(target);
    assert.throws(() => run(target, usersDoc()), /OrganizationLink2 differs/);
    assert.deepStrictEqual(target, before);
  });

  it('throws when the owning spec declares the operation again (moved back)', () => {
    assert.throws(() => run(orgsDoc(true), usersDoc(false)), /moved it back/);
  });

  it('throws when both documents declare it (stale entry)', () => {
    assert.throws(() => run(orgsDoc(true), usersDoc(true)), /stale/);
  });

  it('throws when neither document declares it (dropped)', () => {
    assert.throws(() => run(orgsDoc(false), usersDoc(false)), /major-version decision/);
  });

  for (const key of ['servers', 'parameters']) {
    it(`throws when the source path item carries path-level ${key}`, () => {
      const source = usersDoc();
      (
        (source.paths as Record<string, Record<string, unknown>>)[ENTRY.path] as Record<
          string,
          unknown
        >
      )[key] = [];
      assert.throws(() => run(orgsDoc(), source), new RegExp(`path-level "${key}"`));
    });
  }

  it('never mutates the source document', () => {
    const source = usersDoc();
    const before = structuredClone(source);
    run(orgsDoc(), source);
    assert.deepStrictEqual(source, before);
  });

  it('ignores specs no entry targets', () => {
    const users = usersDoc();
    assert.deepStrictEqual(
      applyRelocations(users, 'users', new Map([['users', usersDoc()]]), [ENTRY]),
      []
    );
  });
});

describe('the committed relocation registry', () => {
  const surface = loadApiSurface();
  const pkgMajor = Number(
    (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version.split('.')[0]
  );

  for (const entry of RELOCATIONS) {
    const op = `${entry.method.toUpperCase()} ${entry.path}`;

    it(`${op}: the owning spec still binds a published method to it`, () => {
      assert.ok(
        (surface.specs[entry.into] ?? []).some((e) => e.op === op),
        `${entry.into} has no manifest entry for ${op}`
      );
    });

    it(`${op}: the replacement it names exists under ${entry.from}`, () => {
      const method = /\.([A-Za-z0-9]+)\(\)$/.exec(entry.replacement)?.[1];
      assert.ok(method, `cannot read a method name from "${entry.replacement}"`);
      assert.ok(
        (surface.specs[entry.from] ?? []).some((e) => e.op === op && e.name === method),
        `${entry.from} has no manifest entry ${op} -> ${method}`
      );
    });

    it(`${op}: is deleted before major ${entry.removeInMajor} ships`, () => {
      assert.ok(
        pkgMajor < entry.removeInMajor,
        `package.json is at major ${pkgMajor}: delete this relocation and the ${entry.into} ` +
          `manifest entry for ${op} (its deprecated method) as part of the major release.`
      );
    });
  }
});
