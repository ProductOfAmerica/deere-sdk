# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
