<h1 align="center">deere-sdk</h1>

<p align="center">
  <strong>Unofficial TypeScript SDK for John Deere Operations Center API</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/deere-sdk"><img src="https://img.shields.io/npm/v/deere-sdk?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/deere-sdk"><img src="https://img.shields.io/npm/dm/deere-sdk?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/ProductOfAmerica/deere-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/ProductOfAmerica/deere-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ProductOfAmerica/deere-sdk/ci.yml?style=flat-square&label=tests" alt="Tests"></a>
  <img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ProductOfAmerica/deere-sdk/main/.github/badges/coverage.json&style=flat-square" alt="Coverage">
  <img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ProductOfAmerica/deere-sdk/main/.github/badges/api-health.json&style=flat-square" alt="API Health">
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#api-status">API Status</a>
</p>

---

## Highlights

- **28 APIs** with **123 operations** — Full coverage of John Deere agricultural APIs
- **Fully typed** — Auto-generated TypeScript types from OpenAPI specs
- **Auto-pagination** — `listAll()` methods handle pagination automatically
- **HAL support** — Built-in link following for John Deere's HAL-style responses
- **Automatic retries** — Exponential backoff with jitter for transient failures
- **Daily health checks** — Automated monitoring of API availability

---

## Installation

```bash
npm install deere-sdk
```

```bash
pnpm add deere-sdk
```

```bash
yarn add deere-sdk
```

---

## Quick Start

```typescript
import { Deere } from 'deere-sdk';

const deere = new Deere({
  accessToken: 'your-oauth-access-token',
  environment: 'sandbox', // or 'production'
});

// List all organizations
const orgs = await deere.organizations.listAll();

// Get fields for an organization
const fields = await deere.fields.listAll(orgs[0].id);

// Get equipment
const equipment = await deere.equipment.get();
```

---

## Authentication

This SDK requires an OAuth 2.0 access token from John Deere:

1. Register at [developer.deere.com](https://developer.deere.com)
2. Create an application and get your client ID/secret
3. Implement the OAuth 2.0 authorization code flow
4. Use the access token in the SDK

<details>
<summary><strong>OAuth Scopes</strong></summary>

| Scope | Description |
|-------|-------------|
| `ag1` | Read access to agricultural data |
| `ag2` | Write access to agricultural data |
| `ag3` | Additional agricultural data access |
| `offline_access` | Refresh token support |

</details>

<details>
<summary><strong>Environments</strong></summary>

| Environment | URL | Use Case |
|-------------|-----|----------|
| `production` | api.deere.com | Live data |
| `sandbox` | sandboxapi.deere.com | Development |
| `partner` | partnerapi.deere.com | Partner integrations |
| `cert` | apicert.deere.com | Certification |

</details>

---

## API Reference

### Operations Center APIs

| API | Property | Methods | Description |
|-----|----------|---------|-------------|
| [Organizations](https://developer.deere.com/documentation/organizations) | `deere.organizations` | 4 | Organization management |
| [Fields](https://developer.deere.com/documentation/fields) | `deere.fields` | 7 | Field CRUD and boundaries |
| [Farms](https://developer.deere.com/documentation/farms) | `deere.farms` | 7 | Farm management |
| [Boundaries](https://developer.deere.com/documentation/boundaries) | `deere.boundaries` | 7 | Field boundary management |
| [Clients](https://developer.deere.com/documentation/clients) | `deere.clients` | 7 | Customer management |
| [Equipment](https://developer.deere.com/documentation/equipment) | `deere.equipment` | 15 | Machines and implements |
| [Field Operations](https://developer.deere.com/documentation/field-operations-api) | `deere.fieldOperations` | 4 | Harvests, plantings, applications |
| [Crop Types](https://developer.deere.com/documentation/crop-types) | `deere.cropTypes` | 4 | Crop type catalog |
| [Products](https://developer.deere.com/documentation/products) | `deere.products` | 9 | Seeds and chemicals catalog |
| [Map Layers](https://developer.deere.com/documentation/map-layers) | `deere.mapLayers` | 4 | Map layer management |
| [Files](https://developer.deere.com/documentation/files) | `deere.files` | 5 | File management |
| [Flags](https://developer.deere.com/documentation/flags) | `deere.flags` | 6 | Field flags/markers |
| [Guidance Lines](https://developer.deere.com/documentation/guidance-lines) | `deere.guidanceLines` | 4 | GPS guidance lines |
| [Operators](https://developer.deere.com/documentation/operators) | `deere.operators` | 6 | Machine operator management |
| [Users](https://developer.deere.com/documentation/users) | `deere.users` | 1 | User information |
| [Assets](https://developer.deere.com/documentation/assets) | `deere.assets` | 8 | Asset tracking |
| [Webhooks](https://developer.deere.com/documentation/webhook) | `deere.webhook` | 4 | Event subscriptions |
| [Connections](https://developer.deere.com/documentation/connection-management) | `deere.connectionManagement` | 3 | OAuth connections |

### Machine Data APIs

| API | Property | Methods | Description |
|-----|----------|---------|-------------|
| [Machine Locations](https://developer.deere.com/documentation/machine-locations) | `deere.machineLocations` | 1 | GPS location history |
| [Machine Alerts](https://developer.deere.com/documentation/machine-alerts) | `deere.machineAlerts` | 1 | DTC alerts |
| [Engine Hours](https://developer.deere.com/documentation/machine-engine-hours) | `deere.machineEngineHours` | 1 | Engine hours tracking |
| [Hours of Operation](https://developer.deere.com/documentation/machine-hours-of-operation) | `deere.machineHoursOfOperation` | 1 | On/off duration |
| [Device State](https://developer.deere.com/documentation/machine-device-state-reports) | `deere.machineDeviceStateReports` | 1 | Terminal state reports |
| [Notifications](https://developer.deere.com/documentation/notifications) | `deere.notifications` | 4 | Push notifications |
| [Harvest ID](https://developer.deere.com/documentation/harvest-id) | `deere.harvestId` | 2 | Cotton module data |
| [AEMP](https://developer.deere.com/documentation/aemp) | `deere.aemp` | 1 | ISO 15143-3 fleet data |
| [Equipment Measurement](https://developer.deere.com/documentation/equipment-measurement) | `deere.equipmentMeasurement` | 1 | Third-party measurements |
| [Partnerships](https://developer.deere.com/documentation/partnerships) | `deere.partnerships` | 6 | Organization partnerships |

---

## Usage Examples

<details>
<summary><strong>Organizations</strong></summary>

```typescript
// List all organizations
const orgs = await deere.organizations.list();
const allOrgs = await deere.organizations.listAll();

// Get a specific organization
const org = await deere.organizations.get('org-id');

// List users in an organization
const users = await deere.organizations.listUsers('org-id');
```

</details>

<details>
<summary><strong>Fields</strong></summary>

```typescript
// List fields in an organization
const fields = await deere.fields.list('org-id');
const allFields = await deere.fields.listAll('org-id');

// Filter fields
const filtered = await deere.fields.list('org-id', {
  farmName: 'North Farm',
  recordFilter: 'AVAILABLE'
});

// Get a specific field
const field = await deere.fields.get('org-id', 'field-id');

// Create a field
await deere.fields.create('org-id', {
  name: 'North Field',
  farmName: 'Smith Farm',
  clientName: 'John Smith'
});

// Update a field
await deere.fields.update('org-id', 'field-id', { name: 'Updated Name' });

// Delete a field
await deere.fields.delete('org-id', 'field-id');
```

</details>

<details>
<summary><strong>Farms</strong></summary>

```typescript
// List farms
const farms = await deere.farms.list('org-id');
const allFarms = await deere.farms.listAll('org-id');

// Include archived
const all = await deere.farms.list('org-id', { recordFilter: 'all' });

// CRUD operations
const farm = await deere.farms.get('org-id', 'farm-id');
await deere.farms.create('org-id', { name: 'North Farm' });
await deere.farms.update('org-id', 'farm-id', { name: 'Updated' });
await deere.farms.delete('org-id', 'farm-id');

// Related resources
const clients = await deere.farms.listClients('org-id', 'farm-id');
const fields = await deere.farms.listFields('org-id', 'farm-id');
```

</details>

<details>
<summary><strong>Boundaries</strong></summary>

```typescript
// List boundaries
const boundaries = await deere.boundaries.list('org-id');
const fieldBoundaries = await deere.boundaries.listBoundaries('org-id', 'field-id');

// Get specific boundary
const boundary = await deere.boundaries.getBoundaries('org-id', 'field-id', 'boundary-id');

// Generate from field operation
const generated = await deere.boundaries.get('operation-id');

// Create boundary
await deere.boundaries.create('org-id', 'field-id', {
  name: 'Main Boundary',
  active: true,
  multipolygons: [/* GeoJSON */]
});

// Update/Delete
await deere.boundaries.update('org-id', 'field-id', 'boundary-id', { name: 'New Name' });
await deere.boundaries.delete('org-id', 'field-id', 'boundary-id');
```

</details>

<details>
<summary><strong>Equipment</strong></summary>

```typescript
// Get all equipment
const equipment = await deere.equipment.get();

// Filter equipment
const filtered = await deere.equipment.get({
  organizationIds: [123],
  categories: 'Machine',
  capableOf: 'Connectivity'
});

// Get equipment details
const machine = await deere.equipment.getEquipment('equipment-id');

// CRUD
await deere.equipment.create('org-id', { type: 'Machine', name: 'Tractor 1' });
await deere.equipment.update('equipment-id', { name: 'Updated' });
await deere.equipment.delete('equipment-id');

// Reference data
const makes = await deere.equipment.list();
const types = await deere.equipment.listEquipmenttypes();
const models = await deere.equipment.listEquipmentmodels({ equipmentModelName: '9RX*' });
```

</details>

<details>
<summary><strong>Field Operations</strong></summary>

```typescript
// List field operations
const ops = await deere.fieldOperations.list('org-id', 'field-id');

// Filter by type and season
const harvests = await deere.fieldOperations.list('org-id', 'field-id', {
  cropSeason: '2024',
  fieldOperationType: 'harvest'
});

// Get operation details
const op = await deere.fieldOperations.get('operation-id');

// Download shapefile
const shapefile = await deere.fieldOperations.getFieldops('operation-id', {
  shapeType: 'Polygon',
  resolution: 'EachSection'
});
```

</details>

<details>
<summary><strong>Machine Data</strong></summary>

```typescript
// Machine locations
const locations = await deere.machineLocations.get('principal-id', {
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-01-31T23:59:59Z'
});

// Machine alerts
const alerts = await deere.machineAlerts.list('principal-id');

// Engine hours
const hours = await deere.machineEngineHours.list('principal-id', { lastKnown: true });

// Hours of operation
const opHours = await deere.machineHoursOfOperation.list('principal-id');

// Device state reports
const state = await deere.machineDeviceStateReports.get('principal-id');
```

</details>

<details>
<summary><strong>Notifications</strong></summary>

```typescript
// List notifications
const notifications = await deere.notifications.list('org-id');

// Filter by severity
const critical = await deere.notifications.list('org-id', {
  severities: 'HIGH,CRITICAL'
});

// Create notification
await deere.notifications.create({
  sourceEvent: 'my-app-event-123',
  title: 'Action Required',
  message: 'Please review the prescription map'
});

// Delete notification
await deere.notifications.delete('source-event-id');
```

</details>

<details>
<summary><strong>Assets</strong></summary>

```typescript
// List assets
const assets = await deere.assets.listAll('org-id');

// Get asset
const asset = await deere.assets.get('asset-id');

// Create asset
await deere.assets.create('org-id', {
  title: 'Fuel Tank #1',
  assetCategory: 'DEVICE',
  assetType: 'SENSOR'
});

// Asset locations
const locations = await deere.assets.listLocations('asset-id', {
  startDate: '2024-01-01T00:00:00Z',
  endDate: '2024-12-31T23:59:59Z'
});

await deere.assets.createLocations('asset-id', {
  timestamp: '2024-06-15T12:00:00Z',
  geometry: { type: 'Point', coordinates: [-93.5, 42.5] }
});
```

</details>

<details>
<summary><strong>Webhooks</strong></summary>

```typescript
// List subscriptions
const subs = await deere.webhook.listAll();

// Create subscription
await deere.webhook.create({
  clientKey: 'your-client-key',
  eventTypeId: 'equipment-status',
  callbackUrl: 'https://your-server.com/webhook'
});

// Update subscription
await deere.webhook.update('subscription-id', {
  callbackUrl: 'https://new-server.com/webhook'
});
```

</details>

<details>
<summary><strong>Partnerships</strong></summary>

```typescript
// List partnerships
const partnerships = await deere.partnerships.listAll();

// Create partnership request
await deere.partnerships.create({
  toOrganizationId: 'partner-org-id',
  message: 'Request to share data'
});

// Get/delete partnership
const partnership = await deere.partnerships.get('token');
await deere.partnerships.delete('token');

// Permissions
const perms = await deere.partnerships.listPermissions('token');
await deere.partnerships.createPermissions('token', {
  permissionType: 'ViewData',
  enabled: true
});
```

</details>

---

## Low-Level Client

For custom endpoints or advanced use cases:

```typescript
import { DeereClient } from 'deere-sdk';

const client = new DeereClient({
  accessToken: 'your-token',
  environment: 'sandbox',
  timeout: 30000,   // Request timeout in ms (default: 30000)
  maxRetries: 3,    // Retry attempts (default: 3, set to 0 to disable)
});

// Raw requests
const response = await client.get<CustomType>('/some/endpoint');
const created = await client.post('/some/endpoint', { data: 'value' });

// Follow HAL links
const nextPage = await client.followLink(response.links[0]);

// Automatic pagination
for await (const items of client.paginate('/large/collection')) {
  console.log(items);
}
```

---

## Error Handling

### Automatic Retries

The SDK automatically retries failed requests with exponential backoff and jitter:

| Error Type | Retried? | Notes |
|------------|----------|-------|
| `429` Rate Limit | Yes | Respects `Retry-After` header |
| `500`, `502`, `503`, `504` | Yes | Server errors |
| Network failures | Yes | Connection issues |
| Timeouts | Yes | Request took too long |
| `401`, `403` Auth errors | No | Refresh your token |
| `400`, `404`, `422` | No | Fix your request |

**Default behavior:** 3 retries with exponential backoff (delays of ~1s, ~2s, ~4s with jitter).

```typescript
// Customize retry behavior
const deere = new Deere({
  accessToken: 'your-token',
  maxRetries: 5,  // More retries (default: 3)
});

// Disable retries entirely
const deere = new Deere({
  accessToken: 'your-token',
  maxRetries: 0,
});
```

### Error Types

```typescript
import { DeereError, RateLimitError, AuthError } from 'deere-sdk';

try {
  const fields = await deere.fields.listAll('org-id');
} catch (error) {
  if (error instanceof RateLimitError) {
    // Only thrown after all retries exhausted
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  } else if (error instanceof AuthError) {
    // Never retried - refresh your token
    console.log('Token expired - refresh required');
  } else if (error instanceof DeereError) {
    console.log(`API error: ${error.status} ${error.message}`);
  }
}
```

---

## TypeScript Support

Access auto-generated types from OpenAPI specs:

```typescript
import { Types } from 'deere-sdk';

type Farm = Types.Farms.components['schemas']['GetFarm'];
type Field = Types.Fields.components['schemas']['FieldsResponse'];
type Equipment = Types.Equipment.components['schemas']['equipment-model'];
```

---

## API Status

This SDK includes automated daily health checks to monitor John Deere API availability.

| Status | Meaning |
|--------|---------|
| ![passing](https://img.shields.io/badge/API%20Health-28%2F28-brightgreen?style=flat-square) | All APIs responding with valid specs |
| ![degraded](https://img.shields.io/badge/API%20Health-25%2F28-yellow?style=flat-square) | Some APIs unavailable or returning empty specs |
| ![failing](https://img.shields.io/badge/API%20Health-10%2F28-red?style=flat-square) | Major API outage detected |

<details>
<summary><strong>APIs Without Public Specs</strong></summary>

These APIs are listed on John Deere's portal but don't provide public OpenAPI specs:

| API | Notes |
|-----|-------|
| `work-plans` | Listed but returns empty spec |
| `retrieve-warranty-information` | Dealer-only |
| `retrieve-pip` | Dealer-only |
| `valid-pin` | Dealer-only |

</details>

<details>
<summary><strong>Additional John Deere APIs</strong></summary>

John Deere offers 40+ additional APIs not included in this SDK:

- **Dealer Solutions** (32 APIs) — Warranty, quotes, service for dealers
- **Financial** (4 APIs) — Merchant transactions, credit applications
- **Supply Chain** (1 API) — Supplier quoting

These target dealers rather than farmers. See [developer.deere.com](https://developer.deere.com) for full documentation.

</details>

---

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.

```bash
# Clone the repo
git clone https://github.com/ProductOfAmerica/deere-sdk.git

# Install dependencies
pnpm install

# Fetch specs and generate SDK
pnpm generate

# Build
pnpm build

# Run tests
pnpm test
```

---

## Disclaimer

> **This is an unofficial SDK** and is not affiliated with, endorsed by, or connected to John Deere or Deere & Company. Use at your own risk.
>
> John Deere, Operations Center, and the leaping deer logo are trademarks of Deere & Company.

---

## License

MIT © 2024

---

<p align="center">
  <sub>Built with TypeScript and auto-generated from John Deere OpenAPI specs</sub>
</p>
