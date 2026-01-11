# John Deere TypeScript SDK

> **Unofficial** TypeScript SDK for John Deere Operations Center API

This SDK provides typed access to John Deere's agricultural APIs, auto-generated from their OpenAPI specifications.

## Installation

```bash
npm install deere-sdk
# or
pnpm add deere-sdk
# or
yarn add deere-sdk
```

## Quick Start

```typescript
import { Deere } from 'deere-sdk';

const deere = new Deere({
  accessToken: 'your-oauth-access-token',
  environment: 'sandbox', // or 'production'
});

// List all organizations
const orgs = await deere.organizations.listAll();
console.log('Organizations:', orgs);

// Get fields for an organization
const fields = await deere.fields.listAll(orgs[0].id);
console.log('Fields:', fields);

// Get farms
const farms = await deere.farms.listAll(orgs[0].id);
console.log('Farms:', farms);

// Get equipment
const equipment = await deere.equipment.get();
console.log('Equipment:', equipment);
```

## Authentication

This SDK requires an OAuth 2.0 access token from John Deere. You'll need to:

1. Register as a developer at [developer.deere.com](https://developer.deere.com)
2. Create an application and get your client ID/secret
3. Implement the OAuth 2.0 flow to obtain access tokens
4. Use the `accessToken` in the SDK configuration

### OAuth Scopes

Common scopes you may need:
- `ag1` - Read access to agricultural data
- `ag2` - Write access to agricultural data
- `ag3` - Additional agricultural data access
- `offline_access` - Refresh token support

## Available APIs

The SDK provides access to 18 John Deere APIs:

| API | Property | Description |
|-----|----------|-------------|
| Organizations | `deere.organizations` | Organization management |
| Fields | `deere.fields` | Field CRUD and boundaries |
| Farms | `deere.farms` | Farm management |
| Boundaries | `deere.boundaries` | Field boundary management |
| Clients | `deere.clients` | Client/customer management |
| Equipment | `deere.equipment` | Machines and implements |
| Field Operations | `deere.fieldOperations` | Harvests, plantings, applications |
| Crop Types | `deere.cropTypes` | Crop type catalog |
| Products | `deere.products` | Product catalog (seeds, chemicals) |
| Map Layers | `deere.mapLayers` | Map layer management |
| Files | `deere.files` | File management |
| Flags | `deere.flags` | Field flags/markers |
| Guidance Lines | `deere.guidanceLines` | GPS guidance lines |
| Operators | `deere.operators` | Machine operator management |
| Users | `deere.users` | User management |
| Assets | `deere.assets` | Asset management |
| Webhook | `deere.webhook` | Webhook subscriptions |
| Connection Management | `deere.connectionManagement` | OAuth connection management |

## API Examples

### Organizations

```typescript
// List all organizations
const orgs = await deere.organizations.listAll();

// Get specific organization
const org = await deere.organizations.get('org-id');

// Search organizations
const filtered = await deere.organizations.list({ orgName: 'Farm' });

// List users in an organization
const users = await deere.organizations.listUsers('org-id');
for (const user of users.values) {
  console.log(`${user.givenName} ${user.familyName} (${user.userType})`);
}
```

### Fields

```typescript
// List all fields
const fields = await deere.fields.listAll('org-id');

// Get field details
const field = await deere.fields.get('org-id', 'field-id');

// Create a field
await deere.fields.create('org-id', { name: 'North Field', ... });

// Update a field
await deere.fields.update('org-id', 'field-id', { name: 'Updated Name' });

// Delete a field
await deere.fields.delete('org-id', 'field-id');
```

### Farms

```typescript
// List all farms
const farms = await deere.farms.listAll('org-id');

// Get farm with archived filter
const allFarms = await deere.farms.list('org-id', { recordFilter: 'all' });

// Create a farm
await deere.farms.create('org-id', { name: 'Smith Farm', clientUri: '...' });

// Get fields for a farm
const farmFields = await deere.farms.listFields('org-id', 'farm-id');
```

### Equipment

```typescript
// Get all equipment
const equipment = await deere.equipment.get();

// Filter by organization
const orgEquipment = await deere.equipment.get({ organizationIds: [123] });

// Filter by type
const machines = await deere.equipment.get({ categories: 'Machine' });

// Get equipment details
const machine = await deere.equipment.getEquipment('equipment-id');
```

### Field Operations

```typescript
// Get field operations
const ops = await deere.fieldOperations.list('org-id');

// Filter by crop season and type
const harvests = await deere.fieldOperations.list('org-id', {
  cropSeason: '2024',
  fieldOperationTypes: 'harvest'
});
```

### Boundaries

```typescript
// List boundaries for a field
const boundaries = await deere.boundaries.listAll('org-id', 'field-id');

// Get active boundary
const active = await deere.boundaries.getActiveBoundary('org-id', 'field-id');

// Create boundary
await deere.boundaries.create('org-id', 'field-id', {
  name: 'Main Boundary',
  multipolygons: [...]
});
```

### Low-Level Client

For endpoints not covered by the typed APIs:

```typescript
import { DeereClient } from 'deere-sdk';

const client = new DeereClient({
  accessToken: 'your-token',
  environment: 'sandbox',
});

// Make raw requests
const response = await client.get<CustomType>('/some/endpoint');
const created = await client.post('/some/endpoint', { data: 'value' });

// Follow HAL links
const nextPage = await client.followLink(response.links[0]);

// Automatic pagination
for await (const items of client.paginate('/large/collection')) {
  console.log(items);
}
```

## Error Handling

```typescript
import { DeereError, RateLimitError, AuthError } from 'deere-sdk';

try {
  const fields = await deere.fields.listAll('org-id');
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter} seconds`);
  } else if (error instanceof AuthError) {
    console.log('Authentication failed. Token may be expired.');
  } else if (error instanceof DeereError) {
    console.log(`API error: ${error.status} ${error.message}`);
  }
}
```

## Environments

| Environment | URL | Use Case |
|-------------|-----|----------|
| `production` | api.deere.com | Live production data |
| `sandbox` | sandboxapi.deere.com | Development/testing |
| `partner` | partnerapi.deere.com | Partner integrations |
| `cert` | apicert.deere.com | Certification testing |

## TypeScript Support

The SDK is fully typed. You can access the OpenAPI-generated types:

```typescript
import { Types } from 'deere-sdk';

// Access specific API types
type Farm = Types.Farms.components['schemas']['GetFarm'];
type Field = Types.Fields.components['schemas']['FieldsResponse'];
```

## Disclaimer

This is an **unofficial** SDK and is not affiliated with, endorsed by, or connected to John Deere or Deere & Company. Use at your own risk.

John Deere and Operations Center are trademarks of Deere & Company.

## License

MIT
