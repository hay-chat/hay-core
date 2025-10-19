# Top Santiago MCP Plugin

A Model Context Protocol (MCP) plugin for interacting with the Top Santiago Services API. This plugin enables AI assistants to manage addresses, subscriptions, delivery routes, and administrative functions through the Top Santiago platform.

## Overview

Top Santiago is a logistics and delivery management platform. This MCP plugin provides tools to:

- **Address Management**: Search and retrieve delivery addresses
- **Subscription Management**: Full CRUD operations on subscriptions and routes
- **Administrative Functions**: Create agencies, users, and API tokens (internal use)

## API Documentation

- **Base URL (Sandbox)**: https://api.sandbox.topsantiago.com
- **Authentication**: API Key via `x-api-key` header
- **API Version**: v1

## Plugin Structure

```
top-santiago/
├── manifest.json              # Plugin metadata and tool definitions
├── package.json               # NPM package configuration
├── README.md                  # This file
└── mcp/
    ├── index.js              # Entry point - starts the MCP server
    ├── server.js             # MCP server setup and tool registration
    ├── api-client.js         # HTTP client for Top Santiago API
    └── tools/
        ├── address.js        # Address management tools
        ├── subscription.js   # Subscription CRUD tools
        └── admin.js          # Administrative tools (auth, user, agency)
```

## Installation

### 1. Install Dependencies

```bash
cd plugins/top-santiago
npm install
```

### 2. Configure API Key

You need a Top Santiago API key to use this plugin. Add it to your environment:

```bash
# In your .env file or environment variables
TOP_SANTIAGO_API_KEY=your_api_key_here

# Optional: Override the API base URL (defaults to sandbox)
TOP_SANTIAGO_API_URL=https://api.sandbox.topsantiago.com
```

### 3. Make Entry Point Executable

```bash
chmod +x mcp/index.js
```

## Available Tools

### Address Tools

#### `list_addresses`
Fetch addresses with optional filters.

**Parameters:**
- `search` (optional): Filter by lodging | street | postal code | locality | council
- `description` (optional): Filter by lodging name
- `streetName` (optional): Filter by street name
- `locality` (optional): Filter by locality name
- `council` (optional): Filter by council name
- `offset` (optional): Number of records to skip (default: 0)
- `limit` (optional): Results per page, 1-100 (default: 10)

**Example:**
```javascript
{
  "search": "Rua da Alegria",
  "locality": "Porto",
  "limit": 20
}
```

#### `get_address`
Retrieve a specific address by ID.

**Parameters:**
- `id` (required): Address ID

**Example:**
```javascript
{
  "id": "12345"
}
```

---

### Subscription Tools

#### `list_subscriptions`
Fetch subscriptions with optional filters.

**Parameters:**
- `name` (optional): Filter by subscription name
- `contact` (optional): Filter by contact
- `email` (optional): Filter by email
- `offset` (optional): Records to skip (default: 0)
- `limit` (optional): Results per page, 1-100 (default: 10)

#### `get_subscription`
Retrieve a specific subscription by ID.

**Parameters:**
- `id` (required): Subscription ID

#### `create_subscription`
Create a new subscription with optional routes.

**Parameters:**
- `name` (required): Subscription name
- `email` (required): Email address
- `contact` (required): Contact information
- `paymentMode` (optional): Payment method - CRE, TRF, CRD, DIN, MBWAY, PAL (default: CRE)
- `notes` (optional): Additional notes
- `routes` (optional): Array of route objects

**Route Object:**
```javascript
{
  "routeDate": "2025-01-15",           // YYYY-MM-DD format
  "pickupAddressId": 100,              // Pickup address ID
  "deliveryAddressId": 200,            // Delivery address ID
  "numberBags": 5,                     // Number of bags (min: 1)
  "state": "HOLD",                     // HOLD | PICKUP | TRANS | DELIVERED | PROBLEM | CANCELED
  "isActive": 1,                       // 1 or 0
  "notes": "Handle with care"          // Max 200 characters
}
```

**Example:**
```javascript
{
  "name": "Acme Corp Weekly Delivery",
  "email": "delivery@acme.com",
  "contact": "+351 912 345 678",
  "paymentMode": "CRE",
  "notes": "Corporate account",
  "routes": [
    {
      "routeDate": "2025-01-15",
      "pickupAddressId": 100,
      "deliveryAddressId": 200,
      "numberBags": 5,
      "state": "HOLD"
    }
  ]
}
```

#### `update_subscription`
Full update of a subscription (replaces all fields).

**Parameters:**
- `id` (required): Subscription ID to update
- `name` (required): Subscription name
- `email` (required): Email address
- `contact` (required): Contact information
- `paymentMode` (optional): Payment method
- `notes` (optional): Additional notes
- `routes` (optional): Array of routes

#### `patch_subscription`
Partial update of a subscription (only updates provided fields).

**Parameters:**
- `id` (required): Subscription ID to update
- Any of the subscription fields (all optional except `id`)

**Example (update only email and notes):**
```javascript
{
  "id": "12345",
  "email": "newemail@acme.com",
  "notes": "Updated contact information"
}
```

#### `delete_subscription`
Delete a subscription by ID.

**Parameters:**
- `id` (required): Subscription ID to delete

---

### Administrative Tools

**Note:** These tools are restricted to Top Santiago internal use only.

#### `create_api_token`
Create a new API agency token.

**Parameters:**
- `token` (required): API token string (32-64 characters)
- `agencyId` (required): Agency ID
- `environment` (required): "sandbox" or "production"
- `expiredAt` (optional): Expiration date (ISO format)

#### `create_user`
Create a new user and profile.

**Parameters:**
- `email` (required): User email address
- `userId` (required): User ID
- `agencyId` (required): Agency ID

#### `create_agency`
Create a new agency.

**Parameters:**
- `name` (required): Agency name
- `email` (required): Agency email
- `contact` (optional): Contact information
- `id` (optional): Unique identifier

## Testing

### Using MCP Inspector

The MCP Inspector provides a visual interface to test all tools:

```bash
npm run inspect
```

This opens a web interface where you can:
- Browse available tools
- Test tool calls with different parameters
- View real-time responses
- Debug issues

### Command Line Testing

Run the server directly:

```bash
npm start
```

The server will listen for JSON-RPC messages on stdin.

### Development Mode

Run with auto-reload on file changes:

```bash
npm run dev
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TOP_SANTIAGO_API_KEY` | Your API key for authentication | Yes | - |
| `TOP_SANTIAGO_API_URL` | API base URL | No | `https://api.sandbox.topsantiago.com` |

### Plugin Settings

Configure in the Hay plugin settings UI:

1. **Top Santiago API Key** (encrypted): Your API key
2. **API Base URL**: Override the default sandbox URL if needed

## Error Handling

All tools return structured error messages:

```javascript
{
  "content": [{
    "type": "text",
    "text": "Error creating subscription: Invalid email address"
  }],
  "isError": true
}
```

Common error scenarios:
- **401 Unauthorized**: Invalid or missing API key
- **404 Not Found**: Resource ID doesn't exist
- **400 Bad Request**: Invalid parameters or missing required fields
- **Network Errors**: Connection timeout or API unavailable

## API Client

The plugin uses Axios for HTTP requests with:
- Automatic `x-api-key` header injection
- 30-second request timeout
- Response error interceptor for logging
- Base URL configuration

### Custom API URL

To use a production environment:

```bash
TOP_SANTIAGO_API_URL=https://api.topsantiago.com
```

## Payment Modes

The following payment modes are supported:

| Code | Description |
|------|-------------|
| CRE | Credit (default) |
| TRF | Transfer |
| CRD | Credit Card |
| DIN | Cash |
| MBWAY | MB WAY |
| PAL | PayPal |

## Route States

Routes can have the following states:

| State | Description |
|-------|-------------|
| HOLD | On hold (default) |
| PICKUP | Ready for pickup |
| TRANS | In transit |
| DELIVERED | Delivered successfully |
| PROBLEM | Problem with delivery |
| CANCELED | Canceled |

## Development

### Adding New Tools

1. Add the tool implementation to the appropriate file in `mcp/tools/`
2. Export the tool from the tools array
3. Import and register in `mcp/server.js`
4. Add tool definition to `manifest.json`

### Tool Structure

```javascript
{
  name: "tool_name",
  description: "What the tool does",
  schema: {
    param1: z.string().describe("Parameter description"),
    param2: z.number().optional().describe("Optional parameter")
  },
  handler: async ({ param1, param2 }) => {
    try {
      const result = await topSantiagoClient.someMethod(param1, param2);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error.response?.data?.message || error.message}`
        }],
        isError: true
      };
    }
  }
}
```

## Troubleshooting

### API Key Issues

**Problem:** "WARNING: TOP_SANTIAGO_API_KEY environment variable is not set"

**Solution:**
- Ensure your API key is configured in the plugin settings
- Check that the environment variable is loaded correctly
- Verify the API key is valid and not expired

### Connection Errors

**Problem:** Request timeout or connection refused

**Solution:**
- Check internet connectivity
- Verify the API URL is correct
- Ensure the API is not experiencing downtime
- Try the sandbox URL: `https://api.sandbox.topsantiago.com`

### Invalid Parameters

**Problem:** 400 Bad Request errors

**Solution:**
- Review the tool's required parameters
- Check parameter types (string vs number)
- Validate enum values (payment modes, route states)
- Ensure date formats are YYYY-MM-DD

### Tools Not Appearing

**Problem:** Tools don't show up in the Hay interface

**Solution:**
- Check `manifest.json` is valid JSON
- Verify tools are registered in `server.js`
- Ensure all tool names match between implementation and manifest
- Restart the MCP server

## Security

- **API Key Storage**: API keys are encrypted in the plugin configuration
- **HTTPS Only**: All API requests use HTTPS
- **No Credential Logging**: API keys are never logged to console
- **Timeout Protection**: 30-second timeout prevents hanging requests

## Support & Resources

- **API Documentation**: https://api.sandbox.topsantiago.com/docs
- **MCP Specification**: https://modelcontextprotocol.io
- **Hay Plugin Schema**: See `plugins/base/plugin-manifest.schema.json`

## License

This plugin is part of the Hay platform.

## Changelog

### Version 1.0.0 (2025-01-19)

- Initial release
- Address management tools (list, get)
- Subscription CRUD tools (list, get, create, update, patch, delete)
- Administrative tools (create token, user, agency)
- Full OpenAPI 3.0.1 spec implementation
- Encrypted API key configuration
- Comprehensive error handling
