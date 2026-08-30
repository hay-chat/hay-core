#!/usr/bin/env node
/**
 * Local Node MCP server for Salesforce.
 *
 * Calls the Salesforce REST API directly using the OAuth 2.0 Client Credentials
 * Flow (see lib/client.js). Generic: works against any Salesforce org — Contacts
 * and Cases out of the box, plus any other standard or custom object via the
 * SOQL, metadata and record tools. No org-specific fields are hardcoded.
 *
 * Env (injected by the plugin worker):
 *   SALESFORCE_INSTANCE_URL    My Domain URL (e.g. https://acme.my.salesforce.com)
 *   SALESFORCE_CLIENT_ID       Connected App consumer key
 *   SALESFORCE_CLIENT_SECRET   Connected App consumer secret
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerQueryTools } = require("./tools/query");
const { registerMetadataTools } = require("./tools/metadata");
const { registerRecordTools } = require("./tools/records");

const server = new McpServer({ name: "salesforce", version: "1.0.0" });

registerQueryTools(server);
registerMetadataTools(server);
registerRecordTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[salesforce] MCP server started");
}

main().catch((err) => {
  console.error("Salesforce MCP server failed to start:", err);
  process.exit(1);
});
