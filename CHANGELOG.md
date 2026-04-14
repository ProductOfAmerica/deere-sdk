# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] - 2026-04-14

**Patch release completing 2.1.0's intended scope.** 2.1.0 shipped one safe
facade method — `deere.safe.fieldOperations.listAllWithMeasurements` — against
a plan that explicitly deferred `list`/`get` variants and silently omitted any
audit of the rest of the embed surface. A post-ship audit found that the same
silent-zero bug class was still loaded on TWO other field-operations methods,
plus the entire equipment and products families. 2.1.1 fixes that.

Framing as a patch is technically stretched (2.1.1 adds public API surface,
which semver-purists would call a minor), but the work here is completing
2.1.0's promise to kill the embed footgun in the `fieldOperations` family and
extending that guarantee to adjacent families where JD's spec documents narrow
embed enum values. Nothing in 2.1.0 is broken or removed.

### Added

- **`deere.safe.fieldOperations.listWithMeasurements(orgId, fieldId, params?)`** —
  paginated single-page variant. Returns `PaginatedResponse<FieldOperationWithMeasurements>`.
  Forces `embed=measurementTypes`, runtime-verifies every operation on the
  returned page carries the `measurementTypes` array, throws `DeereError` on
  contract violation. Same guarantee contract as `listAllWithMeasurements`.
- **`deere.safe.fieldOperations.getWithMeasurements(operationId, params?)`** —
  single-operation-by-id variant. Returns `FieldOperationIdWithMeasurements`.
  JD treats the list-shape (`FieldOperation`) and get-shape (`FieldOperationId`)
  as separate schemas; 2.1.0's spec patch only covered `FieldOperation`. 2.1.1
  adds a matching patch for `FieldOperationId` so the narrowed return type on
  the single-op path is honest.
- **`FieldOperationIdWithMeasurements`** — new exported type, the narrowed
  variant of `FieldOperationId`.
- **`deere.safe.equipment`** (new facade, `SafeEquipmentApi`) — six methods
  wrapping every embed-accepting raw method on `EquipmentApi`:
  `getWithEmbed`, `getEquipmentWithEmbed`, `listEquipmentmodelsWithEmbed`,
  `listEquipmentisgtypesWithEmbed`, `getEquipmentisgtypesWithEmbed`,
  `getEquipmentisgtypes2WithEmbed`. Each method makes the `embed` parameter
  **required at the type level** — TypeScript refuses to compile a call that
  forgets it. Embed values follow JD's documented enums (`devices`, `equipment`,
  `icon`, `pairingDetails`, `offsets`, `capabilities`, `make`, `type`, `isgType`,
  `equipmentModels`, `recordMetadata`).
- **`deere.safe.products`** (new facade, `SafeProductsApi`) — three methods
  wrapping every embed-accepting raw method on `ProductsApi`: `listWithEmbed`,
  `listAllWithEmbed`, `getWithEmbed`. Embed values are JD's documented enum:
  `documents`, `showMergedProducts`.
- **Spec patch: `FieldOperationId.measurementTypes`** — mirrors the 2.1.0
  patch on `FieldOperation` so both the list-shape and get-shape carry the
  optional array in the generated types. Added via one new `addProperty` entry
  in `scripts/embed-contracts.yaml`.

### Important scope note — what 2.1.1 does NOT cover

Equipment and Products safe facades are **type-level forcing functions only**.
They require the caller to pass `embed`, but they do NOT narrow the return
type and do NOT runtime-verify that response fields are populated. The reason:
we don't yet have empirical wire traces confirming which response fields each
embed value populates on those endpoints. Without that evidence, any type
narrowing or runtime assertion would be guessing. 2.1.0's pattern of spec
patch + narrowed type + runtime verification is deferred for these families
until `field-mcp/scripts/jd-probe-shapes.ts` captures wire traces for
equipment and products. Once captured, a future release can tighten the
wrappers with the same registry-driven mechanism.

The following endpoints also take an `embed` parameter but **remain unwrapped
in 2.1.1** because JD's published OpenAPI spec documents the embed as a bare
`string` with no enum values — we literally cannot know what values the caller
should be forced to pass. These endpoints are still raw-only and still expose
the silent-zero footgun to callers who forget the embed: `boundaries.list`,
`boundaries.listAll`, `boundaries.listBoundaries`, `clients.list`,
`clients.listAll`, `clients.get`, `farms.list`, `farms.listAll`, `farms.get`,
`assets.list`, `assets.listAll`, `assets.get`, `guidance-lines.list`,
`guidance-lines.listAll`, `guidance-lines.get`, `harvest-id.list`,
`harvest-id.listAll`, `harvest-id.get`, `operators.list`, `operators.listAll`,
`operators.get`, `map-layers.list`, `map-layers.listAll`, `users.*`,
`flags.*`, `fields.*`. A proper audit of these requires both empirical wire
traces AND a fix-specs patch to tighten the `embed?: string` type to a
narrow enum, and is tracked as a future work item.

### Migration

If FieldMCP (or any other consumer) calls `fieldOperations.list` or
`fieldOperations.get` and reads measurement data from the response, migrate:

```ts
// Before — silent data loss if embed is forgotten
const page = await deere.fieldOperations.list(orgId, fieldId);
const op = await deere.fieldOperations.get(operationId);

// After — guaranteed measurementTypes, throws on contract drift
const page = await deere.safe.fieldOperations.listWithMeasurements(orgId, fieldId);
const op = await deere.safe.fieldOperations.getWithMeasurements(operationId);
```

For equipment and products, the migration is the same pattern but the safe
wrapper just forces you to pick an embed at compile time:

```ts
// Raw (compiles, will silently miss fields when you forget embed)
const equipmentList = await deere.equipment.get();

// Safe (refuses to compile unless you pass embed)
const equipmentList = await deere.safe.equipment.getWithEmbed({ embed: 'devices' });
```

### Unchanged

- Everything shipped in 2.1.0. `listAllWithMeasurements` is untouched, same
  signature, same guarantee.
- Raw `FieldOperationsApi`, `EquipmentApi`, `ProductsApi` method signatures.
- Error hierarchy, URL resolution, HATEOAS mode.
- The contract registry mechanism and `applyEmbedContracts` patcher.

## [2.1.0] - 2026-04-14

**Minor, additive release.** Kills a footgun on `fieldOperations.listAll` by
introducing a "safe facade" layer (`deere.safe.*`) that forces query params
John Deere's API requires for a complete response but the raw SDK leaves
optional. Also adds a contract registry that lets future SDK patches encode
JD spec gaps in one place instead of across hand-written wrappers.

### Why

John Deere's API documents `embed` as an optional query param on
`GET /organizations/{orgId}/fields/{fieldId}/fieldOperations`, but silently
omits the `measurementTypes` array on every returned FieldOperation unless
the request passes `?embed=measurementTypes`. Downstream consumers that
forget the embed param get objects with zero values for yield, area,
moisture, application rate, and seeding population — and can't tell "missing
data" from "real zero" because JD's OpenAPI spec never documents the
invariant. FieldMCP shipped placeholder data to production three separate
times because of this exact bug. 2.1.0 makes "forget the embed param"
syntactically impossible.

### Added

- **`deere.safe.fieldOperations.listAllWithMeasurements(orgId, fieldId, params?)`**
  — returns `FieldOperationWithMeasurements[]` (non-optional `measurementTypes`
  array). Forces `embed=measurementTypes` on the outgoing request, and verifies
  every returned operation actually carries the array, throwing `DeereError`
  with the operation id on any contract violation. Empty `measurementTypes: []`
  is valid (the operation has no recorded measurements yet); `undefined` is not
  and fails loudly.
- **`SafeFacades` class** on `deere.safe` — composition root for safe facades.
  Adding a new safe wrapper means writing a file under `src/safe/` and adding
  one field + one constructor init to `SafeFacades`. The codegen at
  `scripts/generate-sdk.ts` is deliberately kept dumb about what's inside
  `SafeFacades` — it only emits the wire-up, never the contents.
- **`FieldOperationWithMeasurements`** type — re-exported from the main entry
  for consumers who need to reference the narrowed shape directly.
- **`scripts/embed-contracts.yaml`** — new registry encoding JD's undocumented
  invariants as a list of OpenAPI schema-patch operations. Consumed at codegen
  time by `scripts/fix-specs.ts`'s `applyEmbedContracts()` transform before
  `openapi-typescript` runs, so the generated types include the
  previously-missing fields with JD's own declared schemas as `$ref` targets.
- **Generated type `ApplicationProductTotal`** and optional properties
  `FieldOperation.measurementTypes: FieldOperationMeasurement[]` and
  `FieldOperationMeasurementInFullRelease.applicationProductTotals:
  ApplicationProductTotal[]` — produced by the registry patcher and visible to
  both safe-path and raw-path callers.

### Migration

Replace raw `listAll` calls that read measurement data with the safe variant:

```ts
// Before — silently returns FieldOperation objects without measurementTypes
// unless you remember to pass embed, and the type system doesn't warn you.
const ops = await deere.fieldOperations.listAll(orgId, fieldId);
const yield_ = ops[0].measurementTypes; // ← undefined, silent data loss

// After — always populated, type-guaranteed, throws clearly on drift
const ops = await deere.safe.fieldOperations.listAllWithMeasurements(
  orgId,
  fieldId
);
const yield_ = ops[0].measurementTypes[0]?.averageYield?.value; // typed, narrowed
```

Raw `deere.fieldOperations.listAll` still exists and still works — it's the
right tool for metadata-only callers (calendar UIs, operation listings that
don't consume measurement data). The raw return type now carries
`measurementTypes?: FieldOperationMeasurement[]` as an optional field, so
raw-path consumers can read it when they pass the embed param themselves,
but with a compile-time nudge that it might be absent.

### Unchanged

- `FieldOperationsApi.listAll` signature, behavior, and existing query param
  semantics. No breaking changes.
- All other generated API classes.
- Error hierarchy, HATEOAS mode, URL resolution, retry policy.
- `openapi-typescript` version, generator script structure (aside from the
  three literal-string insertions in `generateMainClass()` that wire up
  `SafeFacades` — see `scripts/generate-sdk.ts` and the `// DO NOT REORDER`
  comment it emits into the generated `deere.ts`).

## [2.0.0] - 2026-04-13

**Major release.** URL resolution is now fully spec-driven. This release fixes
a latent bug where `deere.equipment.*` and `deere.equipmentMeasurement.*`
calls 404'd on every environment because the client prepended a platform
baseUrl to specs that declared a different host. Along the way it replaces
the v1 friendly environment names with the raw JD subdomain names that the
specs actually declare, refactors every `DeereClient` HTTP method to take a
spec name as its first argument, and adds a Bearer-token hostname allowlist
to `fetchUrl` so tokens can't leak to third-party URLs.

### Breaking changes

#### 1. Environment names changed

v2 uses the raw subdomain names that JD's specs declare in their
`servers.variables.environment.enum` blocks. Constructor throws immediately
on v1 names with a migration hint pointing at the v2 replacement.

| v1.x          | v2.0          |
|---------------|---------------|
| `production`  | `api`         |
| `sandbox`     | `sandboxapi`  |
| `partner`     | `partnerapi`  |
| `cert`        | `apicert`     |
| `qa`          | `apiqa.tal`   |

Four new environments are also exposed: `partnerapicert`, `partnerapiqa`,
`sandboxapiqa`, `apidev.tal`. These come directly from templated specs'
declared enums and will auto-update as JD adds regions.

#### 2. `DeereClient` method signatures now require a spec name

```ts
// v1
await client.get('/organizations');

// v2
await client.get('organizations', '/organizations');
```

The first argument is a `SpecName` — the name of the OpenAPI spec that owns
the path. Generated API classes (`deere.organizations.list()` etc.) pass the
spec name internally, so code using the generated accessors needs **no
changes**. Only direct `client.get/post/put/patch/delete/paginate/getAll`
callers must migrate.

#### 3. Absolute URLs use `fetchUrl()`

```ts
// v1 — auto-detected from URL shape
await client.get('https://equipmentapi.deere.com/isg/equipment');

// v2 — explicit escape hatch
await client.fetchUrl('GET', 'https://equipmentapi.deere.com/isg/equipment');
```

`fetchUrl` is the one entry point for absolute-URL requests. It attaches the
Bearer token ONLY to `*.deere.com` hosts; third-party URLs get no
`Authorization` header to prevent token leakage.

#### 4. `config.baseUrl` removed

Per-client base URL no longer exists; each spec declares its own. For
mocking in tests, inject a custom `fetch` implementation instead.

#### 5. `DeereClient.warmLinkCache` now takes a spec name

```ts
// v1
await client.warmLinkCache(['/organizations']);

// v2
await client.warmLinkCache('organizations', ['/organizations']);
```

#### 6. Default environment changed from `'sandbox'` to `'sandboxapi'`

Behaviorally identical (both pointed at the sandbox host) — just the string
value changed to match the v2 naming.

### Fixed

- **`EquipmentApi` and `EquipmentMeasurementApi` now route correctly.** Every
  call in v1 404'd because the client prepended the platform baseUrl
  (`https://api.deere.com/platform`) to specs whose actual host is
  `https://equipmentapi.deere.com/isg`. v2 reads each spec's `servers` block
  at build time via `scripts/generate-api-servers.ts` and routes requests
  to the right host per-spec, per-environment.
- **Trust-boundary safety for equipment-measurement.** `equipment-measurement.yaml`
  declares three static hosts (`-qual`, `-cert`, bare prod). v1 silently
  routed every environment to whatever host the client's scalar `baseUrl`
  pointed at, so sandbox users could nuke prod data. v2 maps each
  environment to a tier via JD's own `x-deere-proxy-info` metadata and
  throws `UnsupportedEnvironmentError` for environments without a matching
  tier (`sandboxapi` and `apidev.tal`) before any HTTP call.
- **`fetchUrl` Bearer token hostname allowlist.** v1's
  `client.get(absoluteUrl)` attached the Bearer token to any URL, risking
  leakage via HATEOAS nextPage links or paste-and-fetch bugs. v2's `fetchUrl`
  only attaches the token to `*.deere.com` hosts.
- **`ENVIRONMENT_URLS` duplication eliminated.** The URL table used to live
  in both `src/client.ts` and `scripts/generate-sdk.ts`. v2 has one source
  of truth: the generated `src/api-servers.generated.ts`.
- **Platform-disguised specs normalized at build time.** Six specs
  (`files.yaml`, `flags.yaml`, `organizations.yaml`, `machine-alerts.yaml`,
  `machine-locations.yaml`, `partnerships.yaml`) hardcoded platform URLs
  without using the `{environment}` template. `scripts/fix-specs.ts` now
  rewrites them to the templated form with the global env enum union, so
  sandbox users don't regress.
- **HATEOAS cross-spec parent resolution.** `HATEOAS_MAP` entries now record
  `parentSpec` — which spec owns the parent resource — so a child in
  `equipment.yaml` whose parent `/organizations/{orgId}` lives in
  `organizations.yaml` fetches the parent via the platform host, not the
  equipment host.

### Added

- `SpecName` type exported from `deere-sdk` — the literal union of all 28
  spec names. Useful for generic wrappers over the SDK.
- `NoServerConfigError` and `UnsupportedEnvironmentError` classes — both
  extend `DeereError`. Thrown from the runtime URL resolver before any HTTP
  call when a spec is unavailable or an env isn't supported for a spec.
- `client.fetchUrl(method, url, body?, options?)` — public escape hatch for
  absolute-URL requests.
- `scripts/generate-api-servers.ts` build step that reads all
  `specs/fixed/*.yaml` and emits `src/api-servers.generated.ts` as the
  single source of truth for URL resolution. Runs as part of `pnpm generate`.

### Internal

- Error hierarchy (`DeereError`, `RateLimitError`, `AuthError`, `HateoasError`)
  moved from `src/client.ts` to new `src/errors.ts` to avoid a circular
  import with the environment resolver. `src/client.ts` re-exports them for
  backward compatibility.
- `yamlFiles.sort()` added to both `fix-specs.ts` and `generate-sdk.ts` main
  loops for deterministic generator output across CI runners.
- Removed orphan `src/api/field-operations.ts` (dead code, never referenced
  from `src/api/index.ts`).

## [1.0.10] - 2026-03-26

### Added
- **HATEOAS mode** — `hateoas: true` enables HAL link traversal for John Deere production certification
- Generated route map with 41 path-to-parent+rel entries from OpenAPI specs
- `HateoasError` class thrown on resolution failure (strict mode)
- `hateoasDebug` option for logging link resolution details
- `clearLinkCache()` and `warmLinkCache()` methods on `DeereClient`

## [1.0.9] - 2026-03-25

### Changed
- Synced with latest John Deere API specifications

## [1.0.8] - 2026-03-25

### Changed
- Synced with latest John Deere API specifications

## [1.0.7] - 2026-03-04

### Changed
- Synced with latest John Deere API specifications

## [1.0.6] - 2026-01-27

### Changed
- Synced with latest John Deere API specifications

## [1.0.5] - 2026-01-14

### Added

- `wrapJsDocText` utility for improved JSDoc formatting in generated SDK code
- Test-specific TypeScript config (`tsconfig.test.json`)
- Shared spec utilities library (`scripts/lib/spec-utils.ts`)
- Unit tests for spec fixing (`tests/fix-specs.test.ts`)
- `CODEOWNERS` file with default ownership rules

### Changed

- Consolidate workflows by linking release workflow to publish workflow
- Update CI workflows to ignore non-essential files (docs, configs)
- Adjust API health workflow schedule
- Refactor `fix-specs.ts` and `generate-types.ts` to use shared spec utilities
- Regenerate SDK with improved JSDoc formatting (line wrapping)

### Fixed

- OpenSSF Scorecard branch protection check now uses fine-grained PAT with `repo_token` parameter

## [1.0.4] - 2026-01-13

### Added

- Property-based fuzz testing with `fast-check` for input validation
- `CONTRIBUTING.md` with coding standards and contribution guidelines
- Sigstore cosign signing for release artifacts (`.sig`, `.pem` files)
- SHA256 checksums file for releases
- OpenSSF Best Practices badge

### Changed

- Convert `scripts/check-api-health.js` to TypeScript
- Add `scripts/tsconfig.json` for IDE support
- Update API health workflow to use `tsx`
- Add fuzz tests to CI pipeline

## [1.0.3] - 2026-01-13

### Fixed

- SDK generator now returns typed responses for POST/PUT/PATCH methods when OpenAPI spec defines a response schema
- Filter out invalid `$ref` pointers that reference responses instead of schemas (fixes TypeScript compilation errors)

### Changed

- `boundaries.create()` now returns `PostBoundary` instead of `void`
- `partnerships.createPermissions()` now returns `PermissionsPost` instead of `void`
- `webhook.create()` now returns `CreatedSubscriptionValues` instead of `void`

## [1.0.2] - 2026-01-13

### Added

- Universal ESM compatibility (Deno, Bun, browsers, Node.js)

### Changed

- Use explicit `.js` file extensions in all imports
- Switch to `"NodeNext"` module resolution for strict ESM compliance
- Update SDK generator to output explicit file extensions

## [1.0.1] - 2026-01-12

### Fixed

- Use barrel import in `deere.ts` and remove invalid Response component
- Update `generate-sdk.ts` to import from `'./api'` barrel instead of individual files
- Fix fix-specs.ts to properly delete invalid components.Response from equipment-measurement spec
- Fix stale refs in `missingRefs` set that were causing Response to be recreated
- API count was outdated in `README.md`
- CI build not firing on unimportant changes
- Wrong `README.md` documentation urls
- Generate clean imports in SDK code generator – only import types that are actually used
- PaginatedResponse only imported for APIs with paginated endpoints
- Components only imported for APIs that reference schema types

### Changed

- Upgrade `@biomejs/biome` to 2.3.11 with migrated config
- Add tsconfig.scripts.json for IDE support of scripts folder

## [1.0.0] - 2026-01-12

### Added

- Biome.js for linting and formatting
- Dependabot for automated dependency updates
- `.nvmrc` for Node.js version pinning

### Changed

- **BREAKING**: First stable release – API is now considered stable
- Fixed `exports` field order in `package.json` (types first for bundler compatibility)
- Updated copyright year in `LICENSE`

## [0.2.0] - 2026-01-11

### Added

- Machine Data APIs (10 new APIs): Machine Locations, Machine Alerts, Engine Hours, Hours of Operation, Device State,
  Notifications, Harvest ID, AEMP, Equipment Measurement, Partnerships
- Total API count now 28 with 123 operations

## [0.1.3] - 2026-01-11

### Changed

- Synced with latest John Deere API specifications

## [0.1.2] - 2026-01-11

### Changed

- Synced with latest John Deere API specifications

## [0.1.1] - 2026-01-11

### Changed

- Synced with latest John Deere API specifications

## [0.1.0] - 2026-01-11

### Added

- Initial release
- TypeScript SDK for John Deere Operations Center API
- Auto-generated types from OpenAPI specifications
- Support for 18 John Deere APIs:
    - Organizations
    - Fields
    - Farms
    - Boundaries
    - Clients
    - Equipment
    - Field Operations
    - Crop Types
    - Products
    - Map Layers
    - Files
    - Flags
    - Guidance Lines
    - Operators
    - Users
    - Assets
    - Webhook
    - Connection Management
- `DeereClient` with automatic pagination support
- Error handling with typed errors (`DeereError`, `RateLimitError`, `AuthError`)
- Support for all John Deere environments (`production`, `sandbox`, `partner`, `cert`)
