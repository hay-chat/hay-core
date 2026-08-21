#!/usr/bin/env node
// Local MCP server for Nuvemshop / Tiendanube.
//
// Plain CommonJS runtime JS (not TS-compiled; the plugin tsconfig excludes
// mcp/). Spawned over stdio by src/index.ts via ctx.mcp.startLocalStdio with
// NUVEMSHOP_* env credentials. stdout carries JSON-RPC only — log to stderr.

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerStoreTools } = require("./tools/store");
const { registerProductTools } = require("./tools/products");
const { registerOrderTools } = require("./tools/orders");
const { registerCustomerTools } = require("./tools/customers");

const server = new McpServer({ name: "nuvemshop", version: "1.0.0" });

registerStoreTools(server);
registerProductTools(server);
registerOrderTools(server);
registerCustomerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[nuvemshop] MCP server started");
}

main().catch((err) => {
  console.error("Nuvemshop MCP server failed to start:", err);
  process.exit(1);
});
