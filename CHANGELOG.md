# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-12

### Added
- Biome.js for linting and formatting
- Dependabot for automated dependency updates
- `.nvmrc` for Node.js version pinning

### Changed
- **BREAKING**: First stable release - API is now considered stable
- Fixed `exports` field order in package.json (types first for bundler compatibility)
- Updated copyright year in LICENSE

## [0.2.0] - 2026-01-11

### Added
- Machine Data APIs (10 new APIs): Machine Locations, Machine Alerts, Engine Hours, Hours of Operation, Device State, Notifications, Harvest ID, AEMP, Equipment Measurement, Partnerships
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

## [Unreleased]

## [0.1.0] - 2024-XX-XX

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
- DeereClient with automatic pagination support
- Error handling with typed errors (DeereError, RateLimitError, AuthError)
- Support for all John Deere environments (production, sandbox, partner, cert)
