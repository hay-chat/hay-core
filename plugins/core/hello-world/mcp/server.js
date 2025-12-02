import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { greetingsTools } from "./tools/greetings.js";

/**
 * Hello World MCP Server
 *
 * This is a simple Model Context Protocol (MCP) server that demonstrates
 * how to create tools that can be used by AI assistants.
 *
 * The server exposes tools through the MCP protocol, allowing AI agents
 * to interact with your plugin's functionality.
 */

// Create an MCP server instance
const server = new McpServer({
  name: "Hello World MCP",
  version: "1.0.0",
  description: "A simple Hello World MCP server demonstrating list and post tools",
});

// Register all tools from the greetings module
greetingsTools.forEach((tool) => {
  server.tool(
    tool.name,
    tool.schema,
    tool.handler,
    { description: tool.description }
  );
});

// Log when the server is ready
console.error("[Hello World MCP] Server initialized with tools:", greetingsTools.map(t => t.name).join(', '));

export { server };
