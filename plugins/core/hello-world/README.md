# Hello World MCP Plugin

A simple demonstration of how to create a Model Context Protocol (MCP) plugin for Hay. This plugin shows the basic structure and patterns for building MCP tools.

## What is MCP?

Model Context Protocol (MCP) is an open standard that enables AI assistants to securely connect to external tools and data sources. An MCP plugin consists of:

- **Tools**: Functions that the AI can call to perform actions
- **Resources**: Data that the AI can read
- **Prompts**: Pre-written templates for common tasks

This Hello World plugin demonstrates the **tools** capability with two simple examples.

## Plugin Structure

```
hello-world/
├── manifest.json              # Plugin metadata and configuration
├── package.json               # NPM package configuration
├── README.md                  # This file
└── mcp/
    ├── index.js              # Entry point - starts the MCP server
    ├── server.js             # MCP server setup and tool registration
    └── tools/
        └── greetings.js      # Tool implementations
```

## How It Works

### 1. Entry Point (`mcp/index.js`)

This file starts the MCP server using stdio transport:

```javascript
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { server } from './server.js';

const transport = new StdioServerTransport();
await server.connect(transport);
```

The `#!/usr/bin/env node` shebang makes this file executable, and stdio transport allows communication through standard input/output streams.

### 2. Server Setup (`mcp/server.js`)

Creates the MCP server instance and registers tools:

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { greetingsTools } from "./tools/greetings.js";

const server = new McpServer({
  name: "Hello World MCP",
  version: "1.0.0",
  description: "A simple Hello World MCP server"
});

greetingsTools.forEach((tool) => {
  server.tool(tool.name, tool.schema, tool.handler, {
    description: tool.description
  });
});
```

### 3. Tool Implementations (`mcp/tools/greetings.js`)

Contains two types of tools:

#### List Tool (like GET)
Returns data without modifying anything:

```javascript
{
  name: "list_greetings",
  description: "List available greetings in different languages",
  schema: {
    language: z.string().optional()
  },
  handler: async ({ language }) => {
    // Return data
    return {
      content: [{
        type: "text",
        text: JSON.stringify(greetings, null, 2)
      }]
    };
  }
}
```

#### Post Tool (like POST)
Accepts input and creates/modifies data:

```javascript
{
  name: "create_greeting",
  description: "Create a personalized Hello World greeting",
  schema: {
    name: z.string().describe("Name to include in the greeting"),
    language: z.string().optional()
  },
  handler: async ({ name, language = 'en' }) => {
    // Process input and return result
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ greeting: `Hello World, ${name}!` })
      }]
    };
  }
}
```

### 4. Plugin Manifest (`manifest.json`)

Defines plugin metadata and capabilities:

- **Basic Info**: ID, name, version, description
- **Type**: `mcp-connector` indicates this is an MCP plugin
- **Tools**: List of available tools with their schemas
- **Configuration**: Optional settings for the plugin

## Creating Your Own MCP Plugin

Follow these steps to create your own MCP plugin:

### Step 1: Create Directory Structure

```bash
mkdir -p plugins/your-plugin/mcp/tools
```

### Step 2: Create package.json

```json
{
  "name": "@hay/your-plugin-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "mcp/index.js",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.4.5",
    "zod": "^3.25.76"
  }
}
```

### Step 3: Install Dependencies

```bash
cd plugins/your-plugin
npm install
```

### Step 4: Create Your Tools

Create `mcp/tools/your-tools.js`:

```javascript
import { z } from 'zod';

export const yourTools = [
  {
    name: "your_tool_name",
    description: "What your tool does",
    schema: {
      param1: z.string().describe("Description of param1"),
      param2: z.number().optional().describe("Optional param2")
    },
    handler: async ({ param1, param2 }) => {
      try {
        // Your tool logic here
        const result = await doSomething(param1, param2);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }
  }
];
```

### Step 5: Create Server Setup

Create `mcp/server.js`:

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { yourTools } from "./tools/your-tools.js";

const server = new McpServer({
  name: "Your Plugin MCP",
  version: "1.0.0",
  description: "Your plugin description"
});

yourTools.forEach((tool) => {
  server.tool(tool.name, tool.schema, tool.handler, {
    description: tool.description
  });
});

export { server };
```

### Step 6: Create Entry Point

Create `mcp/index.js`:

```javascript
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { server } from './server.js';
import dotenv from 'dotenv';

dotenv.config();
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Step 7: Create Plugin Manifest

Create `manifest.json` (see this plugin's manifest.json as an example).

### Step 8: Make Entry Point Executable

```bash
chmod +x mcp/index.js
```

## Testing Your Plugin

### Method 1: Using MCP Inspector

The MCP Inspector is a visual tool for testing MCP servers:

```bash
npm run inspect
```

This will open a web interface where you can:
- See all available tools
- Test tool calls with different parameters
- View responses in real-time

### Method 2: Command Line Testing

Run the server directly:

```bash
npm start
```

The server will wait for JSON-RPC messages on stdin.

### Method 3: Integration Testing

Install the plugin in Hay and test it through the Hay interface.

## Tool Best Practices

### 1. Use Descriptive Names
- Tool names should be clear: `list_users`, `create_ticket`, `search_documents`
- Use snake_case for tool names

### 2. Define Clear Schemas
```javascript
schema: {
  // Required parameters
  userId: z.string().describe("The unique ID of the user"),

  // Optional parameters with defaults
  limit: z.number().optional().describe("Max results (default: 10)"),

  // Enums for restricted values
  status: z.enum(["active", "inactive"]).describe("User status")
}
```

### 3. Return Structured Data
Always return JSON with consistent structure:

```javascript
return {
  content: [{
    type: "text",
    text: JSON.stringify({
      success: true,
      data: result,
      metadata: { timestamp: new Date().toISOString() }
    }, null, 2)
  }]
};
```

### 4. Handle Errors Gracefully
```javascript
try {
  // Tool logic
} catch (error) {
  return {
    content: [{
      type: "text",
      text: `Error: ${error.message}`
    }],
    isError: true
  };
}
```

### 5. Add Logging
Use `console.error()` for logs (stdout is reserved for MCP protocol):

```javascript
console.error(`[Your Plugin] Processing request for user: ${userId}`);
```

## Common Patterns

### Pagination
```javascript
schema: {
  page: z.number().optional().describe("Page number"),
  per_page: z.number().optional().describe("Items per page")
}
```

### Filtering
```javascript
schema: {
  status: z.enum(["all", "active", "archived"]).optional(),
  search: z.string().optional().describe("Search query")
}
```

### API Integration
```javascript
import axios from 'axios';

handler: async ({ userId }) => {
  const response = await axios.get(`https://api.example.com/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${process.env.API_KEY}`
    }
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify(response.data, null, 2)
    }]
  };
}
```

## Environment Variables

If your plugin needs API keys or configuration:

1. Add to `configSchema` in manifest.json:
```json
"configSchema": {
  "apiKey": {
    "type": "string",
    "description": "Your API key",
    "required": true,
    "encrypted": true,
    "env": "YOUR_PLUGIN_API_KEY"
  }
}
```

2. Access in code:
```javascript
const apiKey = process.env.YOUR_PLUGIN_API_KEY;
```

## Resources & References

- [MCP Specification](https://modelcontextprotocol.io/docs)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Zod Schema Validation](https://zod.dev/)
- Hay Plugin Guidelines: See `plugins/base/plugin-manifest.schema.json`

## Troubleshooting

### Plugin not loading
- Check `manifest.json` is valid JSON
- Ensure `entry` path points to `mcp/index.js`
- Verify all dependencies are installed

### Tools not appearing
- Check tool names match between `manifest.json` and implementation
- Verify tools are properly registered in `server.js`
- Check server logs for errors

### Tool execution fails
- Add error handling to your tool handlers
- Check parameter validation with Zod schemas
- Review environment variables are set correctly

## Next Steps

1. **Add more tools**: Follow the pattern in `tools/greetings.js`
2. **Add resources**: Expose data that AI can read
3. **Add prompts**: Create pre-written templates
4. **Add authentication**: Implement OAuth or API key auth
5. **Add persistence**: Store data in a database
6. **Add external APIs**: Integrate with third-party services

## License

This is a demo plugin for educational purposes.
