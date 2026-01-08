# MCP Plugin Generation Workflow

This document describes the complete workflow for generating a Hay plugin from an existing MCP (Model Context Protocol) server repository.

## Overview

This workflow enables automated creation of Hay plugins from public MCP server repositories. The process involves:

1. Cloning the MCP server repository
2. Analyzing the MCP server to extract tools and configuration
3. Gathering necessary authentication and configuration details
4. Generating a complete manifest.json file
5. Setting up the plugin structure
6. Running type checks and validation

## Prerequisites

- Public GitHub repository URL of the MCP server
- Access to the Hay plugin directory structure
- Understanding of the MCP server's authentication requirements

## Required Information Checklist

Before starting the generation process, gather the following information:

### 1. Plugin Metadata

- [ ] **Plugin ID**: Unique identifier (format: `hay-plugin-{name}`, alphanumeric and hyphens only)
- [ ] **Display Name**: Human-readable name (e.g., "Shopify", "Stripe")
- [ ] **Description**: Brief description of what the plugin does
- [ ] **Version**: Semantic version (default: "1.0.0")
- [ ] **Author**: Author or organization name (default: "Hay")
- [ ] **Icon**: Icon identifier or URL

### 2. Plugin Classification

- [ ] **Type**: One or more of:
  - `mcp-connector`: Connects to external MCP servers
  - `retriever`: Provides data retrieval capabilities
  - `playbook`: Provides workflow automation
  - `channel`: Communication channel integration
  - `workflow`: Advanced workflow capabilities
  - `analytics`: Analytics and reporting
- [ ] **Category**: One of:
  - `integration`: External service integrations
  - `chat`: Chat and communication
  - `analytics`: Analytics and insights
  - `automation`: Automation tools
  - `utility`: Utility functions

### 3. MCP Connection Configuration

- [ ] **Connection Type**:
  - `local`: MCP server runs locally via stdio
  - `remote`: MCP server is accessed via HTTP/HTTPS URL
- [ ] **Remote URL** (if connection type is remote): Full URL to the MCP server
- [ ] **Transport Protocol**: `stdio`, `sse`, `websocket`, `http`, or combinations like `sse|websocket|http`

### 4. Authentication Configuration

- [ ] **Authentication Methods**: One or more of:
  - `oauth2`: OAuth 2.0 authentication
  - `apiKey`: API key authentication
  - `jwt`: JWT token authentication
  - None: Empty array `[]` for public/unauthenticated access

#### If OAuth 2.0 is used:

- [ ] **Authorization URL**: OAuth authorization endpoint
- [ ] **Token URL**: OAuth token endpoint
- [ ] **Scopes**: Array of required OAuth scopes
- [ ] **PKCE Enabled**: Boolean (true/false) for enhanced security
- [ ] **Client ID Environment Variable**: Name of env var for client ID (e.g., "STRIPE_CLIENT_ID")
- [ ] **Client Secret Environment Variable**: Name of env var for client secret (optional for CIMD flow)

#### If API Key is used:

- [ ] **API Key Environment Variable(s)**: Names of required env vars

### 5. Configuration Schema

For each configuration field users need to provide:

- [ ] **Field Name**: Camel case identifier (e.g., "shopifyAccessToken")
- [ ] **Type**: string, number, boolean, array, object
- [ ] **Label**: Display label for the UI
- [ ] **Description**: Help text explaining what the field is for
- [ ] **Placeholder**: Example value
- [ ] **Required**: Boolean - is this field mandatory?
- [ ] **Encrypted**: Boolean - should this be stored encrypted? (use for secrets)
- [ ] **Environment Variable**: Name of the env var to map to (e.g., "SHOPIFY_ACCESS_TOKEN")
- [ ] **Regex**: Optional regex pattern for validation
- [ ] **Default**: Optional default value

### 6. Build and Runtime Configuration

- [ ] **Install Command**: Command to install dependencies (default: "npm install")
- [ ] **Build Command**: Command to build the plugin (if needed)
- [ ] **Start Command**: Command to start the MCP server (e.g., "node mcp/index.js")

### 7. Permissions

- [ ] **Environment Variables**: Array of all env var names required by the plugin
- [ ] **Scopes**: Array of permission scopes (default: `["org:<organizationId>:mcp:invoke"]`)

### 8. Marketplace Configuration

- [ ] **Featured**: Boolean - should this be featured in the marketplace?
- [ ] **Tags**: Array of searchable tags (e.g., ["ecommerce", "payments", "billing"])

## Workflow Steps

### Step 1: Clone the MCP Server Repository

```bash
# Navigate to the plugins directory
cd /Users/rogerjunior/Documents/code/hay/hay-core/plugins

# Create plugin directory
mkdir -p {plugin-name}
cd {plugin-name}

# Clone the MCP server into the mcp subdirectory
git clone {github-url} mcp

# If the repo structure requires it, move files to the correct location
# Some repos might need the actual MCP server files to be in a subdirectory
```

### Step 2: Analyze the MCP Server

#### Extract Tool Definitions

The MCP server should expose its tools through the MCP protocol. Analyze the code to extract:

- Tool names
- Tool descriptions
- Input schemas (JSON Schema format)
- Tool labels (human-readable names)

Look for:

- `server.listTools()` implementations
- Tool definitions in the codebase
- README documentation about available tools

#### Determine Dependencies

Check `package.json` in the MCP server directory for:

- Required npm packages
- Node.js version requirements
- Build scripts

### Step 3: Generate manifest.json

Using the information gathered, create `manifest.json` following this template:

```json
{
  "$schema": "../base/plugin-manifest.schema.json",
  "id": "hay-plugin-{name}",
  "name": "{Display Name}",
  "description": "{Description}",
  "version": "1.0.0",
  "author": "Hay",
  "type": ["{type}"],
  "entry": "./dist/index.js",
  "enabled": true,
  "category": "{category}",
  "icon": "{icon}",
  "marketplace": {
    "featured": false,
    "tags": ["{tag1}", "{tag2}"]
  },
  "capabilities": {
    "mcp": {
      "connection": {
        "type": "{local|remote}",
        "url": "{url if remote}"
      },
      "tools": [
        {
          "name": "{tool_name}",
          "label": "{Tool Label}",
          "description": "{Description}",
          "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
          }
        }
      ],
      "transport": "{stdio|sse|websocket|http}",
      "auth": ["{oauth2|apiKey|jwt}"],
      "installCommand": "npm install",
      "startCommand": "node mcp/index.js"
    }
  },
  "permissions": {
    "env": ["{ENV_VAR_NAME}"],
    "scopes": ["org:<organizationId>:mcp:invoke"]
  },
  "configSchema": {
    "{fieldName}": {
      "type": "string",
      "description": "{Description}",
      "label": "{Label}",
      "placeholder": "{Placeholder}",
      "required": true,
      "encrypted": false,
      "env": "{ENV_VAR_NAME}"
    }
  },
  "ui": {
    "auth": "{oauth2|apiKey}",
    "settings": true
  }
}
```

#### For OAuth Authentication, add to capabilities.mcp.auth:

```json
"auth": {
  "methods": ["oauth2", "apiKey"],
  "oauth": {
    "authorizationUrl": "{auth_url}",
    "tokenUrl": "{token_url}",
    "scopes": ["{scope1}", "{scope2}"],
    "pkce": true,
    "clientIdEnvVar": "{CLIENT_ID_ENV}",
    "clientSecretEnvVar": "{CLIENT_SECRET_ENV}"
  }
}
```

### Step 4: Set Up Plugin Structure

Create the necessary files:

```bash
# Navigate to plugin directory
cd /Users/rogerjunior/Documents/code/hay/hay-core/plugins/{plugin-name}

# Create package.json
cat > package.json <<EOF
{
  "name": "hay-plugin-{name}",
  "version": "1.0.0",
  "description": "{Description}",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {}
}
EOF

# Create src directory for TypeScript plugin code
mkdir -p src

# Create a basic index.ts
cat > src/index.ts <<EOF
// Plugin entry point
// This file will be compiled to dist/index.js
export default function() {
  console.log('Plugin loaded: {name}');
}
EOF

# Create tsconfig.json
cat > tsconfig.json <<EOF
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

### Step 5: Install Dependencies and Build

```bash
# Install plugin dependencies
npm install

# Install MCP server dependencies
cd mcp
npm install
cd ..

# Build the plugin
npm run build
```

### Step 6: Run Type Check and Validation

```bash
# Run type check on the entire project
cd /Users/rogerjunior/Documents/code/hay/hay-core
npm run typecheck

# Validate the manifest.json against the schema
# This should be done programmatically using a JSON Schema validator
```

### Step 7: Test the Plugin

1. Ensure the Hay application can load the plugin
2. Test that the MCP server can start
3. Verify that tools are correctly exposed
4. Test authentication flow if applicable

## Interactive Questions for AI Agent

When running this workflow autonomously, the AI agent should ask these questions:

### Essential Questions (Always Required)

1. "What is the GitHub repository URL for the MCP server?"
2. "What should we name this plugin? (This will be used to create the plugin ID as hay-plugin-{name})"
3. "What is the primary purpose of this plugin? (One sentence description)"
4. "What category does this plugin belong to? (integration/chat/analytics/automation/utility)"

### Authentication Questions

5. "What authentication method(s) does this MCP server use?"
   - If OAuth: "Please provide the OAuth authorization URL, token URL, and required scopes"
   - If API Key: "What environment variables are needed for API keys?"
   - If JWT: "What JWT configuration is required?"
   - If None: "Confirmed - no authentication required"

### Configuration Questions

6. "What configuration fields do users need to provide?"
   - For each field: name, label, description, placeholder, required (yes/no), encrypted (yes/no), environment variable name

### Connection Questions

7. "Does this MCP server run locally or is it accessed via a remote URL?"
   - If remote: "What is the remote URL?"
8. "What transport protocol does it use? (stdio/sse/websocket/http)"

### Optional Questions

9. "Should this plugin be featured in the marketplace? (yes/no)"
10. "What tags should be added for searchability?" (comma-separated list)

## Decision Tree for Common Scenarios

### Scenario 1: Remote MCP Server (like Stripe)

- Connection type: remote
- Entry point: ./dist/index.js (minimal wrapper)
- No local MCP server execution
- Focus on OAuth/API key configuration

### Scenario 2: Local MCP Server with API Key (like Shopify, WooCommerce)

- Connection type: local
- Transport: sse|websocket|http
- Install and build MCP server in `mcp/` directory
- Start command: `node mcp/index.js`
- API key configuration in configSchema

### Scenario 3: Simple Local Server (like Hello World)

- Connection type: local
- Transport: stdio
- Minimal authentication (empty array)
- Simple configuration or no configuration

## Error Handling and Edge Cases

### Clone Failures

- Verify GitHub URL is accessible and public
- Check if repository requires authentication
- Handle repository structures where MCP server is in a subdirectory

### Tool Extraction Failures

- Parse README for tool documentation
- Look for OpenAPI/Swagger specs
- Manually inspect server code for tool definitions
- Ask user for tool list if automated extraction fails

### Build Failures

- Check Node.js version compatibility
- Verify all dependencies are available
- Look for build scripts in MCP server's package.json
- Fall back to runtime-only if build not required

### Missing Information

- Use sensible defaults where possible
- Ask user for critical missing information
- Reference similar existing plugins for patterns

## Output Checklist

After completing the workflow, verify:

- [ ] Plugin directory created at `/plugins/{plugin-name}/`
- [ ] MCP server cloned into `/plugins/{plugin-name}/mcp/`
- [ ] `manifest.json` created and follows schema
- [ ] `package.json` created with correct scripts
- [ ] `tsconfig.json` configured correctly
- [ ] `src/index.ts` created with basic plugin entry point
- [ ] All dependencies installed (`node_modules/` exists)
- [ ] Plugin compiled successfully (`dist/` directory exists)
- [ ] Type check passes with no errors
- [ ] All required environment variables documented
- [ ] Tools array populated with all MCP tools
- [ ] Authentication configuration is complete
- [ ] Configuration schema matches required env vars

## Example: Complete Workflow for a GitHub MCP Server

```bash
# Input: https://github.com/example/github-mcp-server

# Questions answered:
# - Plugin name: github
# - Description: Connect to GitHub to manage repositories, issues, and pull requests
# - Category: integration
# - Auth: OAuth + API Key
# - OAuth URL: https://github.com/login/oauth/authorize
# - Token URL: https://github.com/login/oauth/access_token
# - Scopes: ["repo", "user"]
# - Config fields: githubToken (encrypted), githubUsername (not encrypted)

# Execute workflow:
cd /Users/rogerjunior/Documents/code/hay/hay-core/plugins
mkdir -p github
cd github
git clone https://github.com/example/github-mcp-server mcp
# Create manifest.json with all gathered information
# Create package.json, tsconfig.json, src/index.ts
npm install
cd mcp && npm install && cd ..
npm run build
cd ../..
npm run typecheck
```

## Integration with Hay Plugin System

Once the plugin is generated:

1. The plugin will be automatically discovered by the Hay plugin manager
2. Users can enable/configure it through the dashboard
3. The MCP server will be started when the plugin is activated
4. Tools will be available to the AI assistant through the MCP connection

## References

- Plugin manifest schema: `/plugins/base/plugin-manifest.schema.json`
- Example plugins: `/plugins/shopify/`, `/plugins/stripe/`, `/plugins/zendesk/`
- MCP specification: Model Context Protocol documentation
