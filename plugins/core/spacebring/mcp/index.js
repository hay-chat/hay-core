#!/usr/bin/env node
/**
 * Local Node MCP server for Spacebring (co-working member chat).
 *
 * Exposes the steps of a member-support playbook, not one tool per Spacebring
 * endpoint: each tool resolves the member/space/location from what the member
 * said, runs the requests it needs in order, enforces the rules (slot free,
 * booking is theirs) and answers with a relayable summary. See
 * .claude/skills/build-plugin/reference/tool-design.md.
 *
 * Env (injected by the plugin worker):
 *   SPACEBRING_API_KEY_ID, SPACEBRING_API_KEY_SECRET  HTTP Basic credentials
 *   SPACEBRING_LOCATION_REF  default location id (optional; the only location is used otherwise)
 *   SPACEBRING_TIME_ZONE     fallback IANA time zone when the location has none (optional)
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { applyToolRisk } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("./tool-risk");

const { registerMemberTools } = require("./tools/members");
const { registerBookingTools } = require("./tools/bookings");
const { registerGuestTools } = require("./tools/guests");
const { registerSupportTools } = require("./tools/support");
const { registerCommunityTools } = require("./tools/community");

function createServer() {
  const server = applyToolRisk(new McpServer({ name: "spacebring", version: "2.0.0" }), toolRisk);
  registerMemberTools(server);
  registerBookingTools(server);
  registerGuestTools(server);
  registerSupportTools(server);
  registerCommunityTools(server);
  return server;
}

async function main() {
  if (!process.env.SPACEBRING_API_KEY_ID || !process.env.SPACEBRING_API_KEY_SECRET) {
    console.error("ERROR: SPACEBRING_API_KEY_ID and SPACEBRING_API_KEY_SECRET are required");
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[spacebring] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Spacebring MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
