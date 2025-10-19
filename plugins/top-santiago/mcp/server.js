import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addressTools } from "./tools/address.js";
import { subscriptionTools } from "./tools/subscription.js";
import { adminTools } from "./tools/admin.js";

/**
 * Top Santiago MCP Server
 *
 * This MCP server provides tools to interact with the Top Santiago API
 * for managing addresses, subscriptions, and administrative functions.
 *
 * API Documentation: https://api.sandbox.topsantiago.com
 */

// Create an MCP server instance
const server = new McpServer({
  name: "Top Santiago API",
  version: "1.0.0",
  description: "MCP Server for interacting with the Top Santiago Services API",
});

// Combine all tools
const allTools = [
  ...addressTools,
  ...subscriptionTools,
  ...adminTools
];

// Register each tool with the server
allTools.forEach((tool) => {
  server.tool(
    tool.name,
    tool.schema,
    tool.handler,
    { description: tool.description }
  );
});

// Log when the server is ready
console.error('[Top Santiago MCP] Server initialized with tools:', allTools.map(t => t.name).join(', '));

export { server };
