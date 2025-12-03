import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { judoTools } from "./tools/judo-tools.js";

/**
 * Judo in Cloud MCP Server
 *
 * This is a demo/fake Model Context Protocol (MCP) server that simulates
 * Judo in Cloud API operations for testing purposes.
 *
 * All tools wait 1 second and return successful responses.
 */

// Create an MCP server instance
const server = new McpServer({
  name: "Judo in Cloud MCP",
  version: "1.0.0",
  description: "Judo in Cloud MCP plugin for customer support operations",
});

// Register all tools from the judo-tools module
judoTools.forEach((tool) => {
  server.tool(
    tool.name,
    tool.schema,
    tool.handler,
    { description: tool.description }
  );
});

// Log when the server is ready
console.error("[Judo in Cloud MCP] Server initialized with tools:", judoTools.map(t => t.name).join(', '));

export { server };
