# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
