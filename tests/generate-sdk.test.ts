import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildMethodJsDoc,
  buildMethodParams,
  buildPathTemplate,
  clientCallArguments,
  collectionItemType,
  computeReturnType,
  DEFAULT_DEPRECATION_NOTE,
  deprecatedJsDocLines,
  isCollectionEndpoint,
  methodSignature,
  type ParamListOp,
  type ReturnTypeOp,
  resolveContentSchemaRef,
  type SchemaLike,
  schemaTypeRef,
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
  // A values-shaped wrapper whose items carry NO $ref (inline-typed items).
  InlineWrap: { properties: { values: { items: { type: 'object' } as SchemaLike } } },
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

    it('(e) COLLECTION + values-shaped wrapper whose items have no $ref -> undefined (degrades to PaginatedResponse<unknown>, not a double envelope)', () => {
      assert.strictEqual(
        resolveContentSchemaRef({ $ref: '#/components/schemas/InlineWrap' }, schemas, true),
        undefined
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

  describe('collectionItemType', () => {
    it('is the resolved item type when responseSchemaRef is set', () => {
      assert.strictEqual(
        collectionItemType({ method: 'get', isCollection: true, responseSchemaRef: 'Variety' }),
        "components['schemas']['Variety']"
      );
    });

    it('is unknown when there is no responseSchemaRef', () => {
      assert.strictEqual(collectionItemType({ method: 'get', isCollection: true }), 'unknown');
    });
  });

  describe('computeReturnType + usesPaginatedResponse agreement', () => {
    // The import fix hinges on this invariant: any op whose return type is a
    // PaginatedResponse<...> must be counted by usesPaginatedResponse, or the
    // generated class references PaginatedResponse without importing it. Pin it
    // so a future narrowing of one helper without the other fails a unit test
    // instead of only a full generate+typecheck.
    it('every op that emits a PaginatedResponse<...> is counted by usesPaginatedResponse', () => {
      const ops: ReturnTypeOp[] = [
        { method: 'get', isCollection: true, responseSchemaRef: 'Variety' },
        { method: 'get', isCollection: true },
        { method: 'get', isCollection: false, responseSchemaRef: 'X' },
        { method: 'post', isCollection: false },
        { method: 'delete', isCollection: false },
        { method: 'get', isCollection: false },
      ];
      for (const op of ops) {
        if (computeReturnType(op).startsWith('PaginatedResponse')) {
          assert.ok(
            usesPaginatedResponse([op]),
            `${JSON.stringify(op)} emits PaginatedResponse but usesPaginatedResponse is false (would emit an unimported type)`
          );
        }
      }
    });
  });
});

describe('isCollectionEndpoint', () => {
  it('treats a {param} last segment as item access', () => {
    assert.strictEqual(isCollectionEndpoint('/users/{username}', 'get'), false);
  });

  it('treats a plain literal last segment as a collection', () => {
    assert.strictEqual(isCollectionEndpoint('/organizations', 'get'), true);
    assert.strictEqual(
      isCollectionEndpoint('/users/{userName}/organizations', 'get', ['userName']),
      true
    );
  });

  it('treats a literal declared as an in:path parameter as item access (@currentUser)', () => {
    assert.strictEqual(isCollectionEndpoint('/users/@currentUser', 'get', ['@currentUser']), false);
  });

  it('is never a collection for non-GET methods', () => {
    assert.strictEqual(isCollectionEndpoint('/organizations', 'post'), false);
  });
});

describe('buildMethodJsDoc', () => {
  const base = {
    method: 'get',
    path: '/users/{userName}/organizations',
    summary: 'View User Orgs',
  };

  it('emits no @deprecated tag for a live operation', () => {
    assert.ok(!buildMethodJsDoc(base).some((l) => l.includes('@deprecated')));
  });

  it('emits the relocation note between the summary and @generated', () => {
    const lines = buildMethodJsDoc({
      ...base,
      deprecated: true,
      deprecationNote: 'use deere.users.listOrganizations().',
    });
    const dep = lines.findIndex((l) =>
      l.includes('@deprecated use deere.users.listOrganizations().')
    );
    const gen = lines.findIndex((l) => l.includes('@generated from GET'));
    assert.ok(dep > 0 && dep < gen, lines.join('\n'));
  });

  it('falls back to a generic note when the spec gives no reason', () => {
    const lines = buildMethodJsDoc({ ...base, deprecated: true });
    assert.ok(
      lines.some((l) => l === `   * @deprecated ${DEFAULT_DEPRECATION_NOTE}`),
      lines.join('\n')
    );
  });

  it('has no @deprecated lines helper output for a live operation', () => {
    assert.deepStrictEqual(deprecatedJsDocLines(base), []);
  });

  // Every field below is text from the spec. Whichever one carries it, a
  // comment terminator must not end the block before its own last line: what
  // followed would be a member of the generated class.
  describe('text that tries to end the comment', () => {
    const marker = '__jsDocTestMarker';
    const payloads = {
      'with spaces': `ok */ static { globalThis.${marker} = true; } /*`,
      // No spaces, so the word wrapper has nowhere to break it.
      'as one unbroken word': `ok*/static{globalThis.${marker}=true}/*`,
    };
    const fields = ['summary', 'description', 'deprecationNote', 'path'] as const;

    for (const field of fields) {
      for (const [shape, payload] of Object.entries(payloads)) {
        it(`in the ${field}, ${shape}, stays inside the comment`, () => {
          const lines = buildMethodJsDoc({ ...base, deprecated: true, [field]: payload });

          assert.strictEqual(lines.at(-1), '   */');
          assert.ok(!lines.slice(0, -1).join('\n').includes('*/'), lines.join('\n'));

          // And as the generator uses it: in front of a method, in a class.
          try {
            new Function(`return class Demo {\n${lines.join('\n')}\n  async get() {}\n};`)();
            assert.strictEqual(marker in globalThis, false);
          } finally {
            delete (globalThis as Record<string, unknown>)[marker];
          }
        });
      }
    }
  });
});

describe('buildPathTemplate', () => {
  it('leaves a path with no parameters as it is', () => {
    assert.strictEqual(buildPathTemplate('/organizations'), '/organizations');
    assert.strictEqual(buildPathTemplate('/users/@currentUser'), '/users/@currentUser');
  });

  it('passes each parameter through the encoder, under its own name', () => {
    assert.strictEqual(
      buildPathTemplate('/notificationEvents/{sourceEvent}'),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted template body, as text
      "/notificationEvents/${encodePathParam('sourceEvent', sourceEvent)}"
    );
  });

  it('keeps several parameters in the order the path has them', () => {
    assert.strictEqual(
      buildPathTemplate('/organizations/{orgId}/fields/{fieldId}/boundaries'),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted template body, as text
      "/organizations/${encodePathParam('orgId', orgId)}/fields/${encodePathParam('fieldId', fieldId)}/boundaries"
    );
  });
});

describe('schemaTypeRef', () => {
  it('indexes components by the schema name', () => {
    assert.strictEqual(schemaTypeRef('FieldOperation'), "components['schemas']['FieldOperation']");
  });

  it('keeps a name that tries to leave its quotes inside them', () => {
    const name = "T'] = (evil(), null) as components['schemas']['T";
    assert.strictEqual(
      schemaTypeRef(name),
      "components['schemas']['T\\'] = (evil(), null) as components[\\'schemas\\'][\\'T']"
    );
    assert.strictEqual(
      computeReturnType({ method: 'get', isCollection: false, responseSchemaRef: name }),
      schemaTypeRef(name)
    );
    assert.strictEqual(
      collectionItemType({ method: 'get', isCollection: true, responseSchemaRef: name }),
      schemaTypeRef(name)
    );
  });
});

describe('buildMethodParams and methodSignature', () => {
  // GET /organizations/{orgId}/fields, more or less.
  const list: ParamListOp = {
    method: 'get',
    isCollection: true,
    responseSchemaRef: 'Field',
    pathParams: [{ name: 'orgId' }],
    queryParams: [
      {
        safeName: 'recordFilter',
        required: false,
        type: 'string',
        enumValues: ['AVAILABLE', 'ARCHIVED', 'ALL'],
      },
      { safeName: 'embed', required: false, type: 'string[]' },
    ],
    hasRequestBody: false,
  };

  it('lists the path parameters, then the body, then params, then options', () => {
    assert.deepStrictEqual(
      buildMethodParams({
        ...list,
        method: 'post',
        isCollection: false,
        pathParams: [{ name: 'orgId' }, { name: 'fieldId' }],
        hasRequestBody: true,
        requestBodySchemaRef: 'PostField',
      }),
      [
        'orgId: string',
        'fieldId: string',
        "data: components['schemas']['PostField']",
        // As John Deere declares them: the emitted method keeps their order.
        "params?: { recordFilter?: 'AVAILABLE' | 'ARCHIVED' | 'ALL'; embed?: string[] }",
        'options?: RequestOptions',
      ]
    );
  });

  it('types a body with no named schema as a record, and marks only optional members', () => {
    assert.deepStrictEqual(
      buildMethodParams({
        ...list,
        hasRequestBody: true,
        queryParams: [{ safeName: 'count', required: true, type: 'number' }],
      }),
      [
        'orgId: string',
        'data: Record<string, unknown>',
        'params?: { count: number }',
        'options?: RequestOptions',
      ]
    );
    assert.deepStrictEqual(buildMethodParams({ ...list, pathParams: [], queryParams: [] }), [
      'options?: RequestOptions',
    ]);
  });

  it('writes the signature on one line, path parameters as bare strings', () => {
    assert.strictEqual(
      methodSignature(list),
      "(string, params?: { embed?: string[]; recordFilter?: 'ALL' | 'ARCHIVED' | 'AVAILABLE' }, " +
        "options?: RequestOptions) => PaginatedResponse<components['schemas']['Field']>"
    );
    assert.strictEqual(
      methodSignature({ ...list, method: 'delete', pathParams: [], queryParams: [] }),
      '(options?: RequestOptions) => void'
    );
  });

  // It is built from the pieces the emitted method is built from. Where
  // nothing needs sorting, an enum included, the two are the same text.
  it('uses the very strings the emitted parameter list has', () => {
    const op: ParamListOp = {
      ...list,
      method: 'put',
      isCollection: false,
      hasRequestBody: true,
      requestBodySchemaRef: 'PutField',
      queryParams: [
        { safeName: 'a', required: true, type: 'boolean' },
        { safeName: 'b', required: false, type: 'number' },
        { safeName: 'c', required: false, type: 'string', enumValues: ['X', 'Y'] },
      ],
    };
    const afterThePath = buildMethodParams(op).slice(op.pathParams.length);
    assert.strictEqual(
      methodSignature(op),
      `(string, ${afterThePath.join(', ')}) => ${computeReturnType(op)}`
    );
  });

  // John Deere's enum values sometimes carry documentation markup. The value
  // is written as source, so the markup goes, and it goes from both.
  it('strips markup from an enum value, in the emitted list and the signature alike', () => {
    const op: ParamListOp = {
      ...list,
      queryParams: [
        { safeName: 'mode', required: false, type: 'string', enumValues: ['<b>ALL</b>', 'NONE'] },
      ],
    };
    assert.deepStrictEqual(buildMethodParams(op).slice(1), [
      "params?: { mode?: 'ALL' | 'NONE' }",
      'options?: RequestOptions',
    ]);
    assert.ok(methodSignature(op).includes("params?: { mode?: 'ALL' | 'NONE' }"));
  });

  // Three things a caller cannot see. Upstream churn in them must not stop
  // the sync.
  it('is the same whatever a path parameter is called', () => {
    assert.strictEqual(
      methodSignature({ ...list, pathParams: [{ name: 'organizationId' }] }),
      methodSignature(list)
    );
  });

  it('is the same whatever order the query parameters are declared in', () => {
    assert.strictEqual(
      methodSignature({ ...list, queryParams: [...list.queryParams].reverse() }),
      methodSignature(list)
    );
  });

  it('is the same whatever order an enum declares its values in', () => {
    const [recordFilter, embed] = list.queryParams;
    const reordered = { ...recordFilter, enumValues: ['ALL', 'AVAILABLE', 'ARCHIVED'] };
    assert.strictEqual(
      methodSignature({ ...list, queryParams: [reordered, embed] }),
      methodSignature(list)
    );
  });

  // Everything a caller can see. Each of these is a different method to call,
  // so no two of them, the original included, may share a signature.
  it('differs for every change a caller would have to adapt to', () => {
    const [recordFilter, embed] = list.queryParams;
    const withBody = { ...list, hasRequestBody: true, requestBodySchemaRef: 'PostField' };
    const variants: Record<string, ParamListOp> = {
      'the original': list,
      'a path parameter added': { ...list, pathParams: [{ name: 'orgId' }, { name: 'fieldId' }] },
      'a path parameter removed': { ...list, pathParams: [] },
      'a body added': withBody,
      'a body of another type': { ...withBody, requestBodySchemaRef: 'PutField' },
      'a body with no named type': { ...withBody, requestBodySchemaRef: undefined },
      'a query parameter added': {
        ...list,
        queryParams: [...list.queryParams, { safeName: 'count', required: false, type: 'number' }],
      },
      'a query parameter removed': { ...list, queryParams: [recordFilter] },
      'no query parameters left': { ...list, queryParams: [] },
      'a query parameter that became required': {
        ...list,
        queryParams: [recordFilter, { ...embed, required: true }],
      },
      'a query parameter of another type': {
        ...list,
        queryParams: [recordFilter, { ...embed, type: 'string' }],
      },
      'an enum value added': {
        ...list,
        queryParams: [
          { ...recordFilter, enumValues: ['AVAILABLE', 'ARCHIVED', 'ALL', 'NEW'] },
          embed,
        ],
      },
      'an enum that became any string': {
        ...list,
        queryParams: [{ ...recordFilter, enumValues: undefined }, embed],
      },
      'another return type': { ...list, responseSchemaRef: 'FieldResponse' },
      'a return type that is no longer known': { ...list, responseSchemaRef: undefined },
      'a collection that became one item': { ...list, isCollection: false },
    };

    const names = Object.keys(variants);
    const bySignature = new Map<string, string>();
    for (const name of names) {
      const signature = methodSignature(variants[name]);
      const twin = bySignature.get(signature);
      assert.strictEqual(twin, undefined, `"${name}" has the signature of "${twin}"`);
      bySignature.set(signature, name);
    }
    assert.strictEqual(bySignature.size, names.length);
  });

  // The text is compared, stored in YAML and printed in a job summary, so
  // whatever the spec says has to stay inside its quotes and on one line.
  it('keeps spec text inside its quotes and on one line', () => {
    const signature = methodSignature({
      ...list,
      responseSchemaRef: "Field'] | never\n//",
      queryParams: [
        { safeName: 'mode', required: false, type: 'string', enumValues: ["a' | 'b", 'c\r\nd'] },
      ],
    });
    assert.ok(!/[\r\n]/.test(signature), JSON.stringify(signature));
    assert.ok(signature.includes(schemaTypeRef("Field'] | never\n//")));
    assert.ok(signature.includes("'a\\' | \\'b'"), signature);
  });
});

// DeereClient's post, put and patch take a body before the options, and its
// get and delete do not. The generator once left the body out of a write that
// declares none, and the caller's options were sent in its place.
describe('clientCallArguments', () => {
  type Method = ParamListOp['method'];
  const operation = (method: Method, hasRequestBody: boolean): ParamListOp => ({
    method,
    isCollection: false,
    pathParams: [{ name: 'id' }],
    queryParams: [],
    hasRequestBody,
    requestBodySchemaRef: hasRequestBody ? 'Thing' : undefined,
  });
  const callFor = (method: Method, hasRequestBody: boolean) =>
    clientCallArguments(operation(method, hasRequestBody), `demo.yaml ${method} /things/{id}`);

  const READS: Method[] = ['get', 'delete'];
  const WRITES: Method[] = ['post', 'put', 'patch'];

  it('gives a read the options straight after the path', () => {
    for (const method of READS) {
      assert.deepStrictEqual(callFor(method, false), ['this.spec', 'path', 'options'], method);
    }
  });

  it('gives a write its body, then the options', () => {
    for (const method of WRITES) {
      assert.deepStrictEqual(
        callFor(method, true),
        ['this.spec', 'path', 'data', 'options'],
        method
      );
    }
  });

  it('fills the body slot of a write that has no body, so the options stay in theirs', () => {
    for (const method of WRITES) {
      assert.deepStrictEqual(
        callFor(method, false),
        ['this.spec', 'path', 'undefined', 'options'],
        method
      );
    }
  });

  it('refuses a read that declares a request body, naming the operation', () => {
    for (const method of READS) {
      assert.throws(
        () => callFor(method, true),
        (error: Error) => {
          assert.ok(error.message.startsWith(`demo.yaml ${method} /things/{id}: `), error.message);
          assert.match(error.message, /declares a request body/);
          return true;
        }
      );
    }
  });

  // The call and the parameter list are built apart, so this ties them: the
  // call names nothing but what the method declares.
  it('passes only what the method declares, with the options last', () => {
    for (const method of [...READS, ...WRITES]) {
      for (const hasRequestBody of [false, true]) {
        if (hasRequestBody && READS.includes(method)) continue;
        const declared = buildMethodParams(operation(method, hasRequestBody)).map(
          (parameter) => parameter.split(/[?:]/)[0]
        );
        const [spec, path, ...rest] = callFor(method, hasRequestBody);
        assert.deepStrictEqual([spec, path], ['this.spec', 'path']);
        assert.strictEqual(rest.at(-1), 'options');
        for (const name of rest.filter((argument) => argument !== 'undefined')) {
          assert.ok(declared.includes(name), `${method}: "${name}" is not a parameter`);
        }
        // And a declared body is never left out of the call.
        assert.strictEqual(rest.includes('data'), declared.includes('data'), method);
      }
    }
  });
});
