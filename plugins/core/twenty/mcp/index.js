#!/usr/bin/env node
/**
 * Local Node MCP server for Twenty CRM.
 *
 * Calls the Twenty REST API directly (`${TWENTY_URL}/rest`) using a workspace
 * API key. Generic: works against any Twenty Cloud or self-hosted workspace —
 * no workspace-specific fields are hardcoded. Standard objects get friendly
 * typed tools; custom objects/fields are reachable via the generic record and
 * metadata tools.
 *
 * Env (injected by the plugin worker):
 *   TWENTY_URL      workspace base URL (without /rest)
 *   TWENTY_API_KEY  workspace API key
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { registerPeopleTools } = require("./tools/people");
const { registerCompanyTools } = require("./tools/companies");
const { registerNoteTools } = require("./tools/notes");
const { registerTaskTools } = require("./tools/tasks");
const { registerMetadataTools } = require("./tools/metadata");
const { registerRecordTools } = require("./tools/records");

const server = new McpServer({ name: "twenty-crm", version: "1.0.0" });

registerPeopleTools(server);
registerCompanyTools(server);
registerNoteTools(server);
registerTaskTools(server);
registerMetadataTools(server);
registerRecordTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[twenty] MCP server started");
}

main().catch((err) => {
  console.error("Twenty CRM MCP server failed to start:", err);
  process.exit(1);
});
