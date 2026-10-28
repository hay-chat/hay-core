#!/usr/bin/env node
/**
 * Local Node MCP server for Mercado Pago: the payment_provider contract
 * (@hay/plugin-sdk/payment-provider) over the Mercado Pago REST API.
 *
 * Plain CommonJS on native fetch, spawned over stdio by src/index.ts.
 * stdout carries JSON-RPC only — log to stderr.
 *
 * Env (injected by the plugin worker): MERCADOPAGO_ACCESS_TOKEN (OAuth).
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { applyToolRisk } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("./tool-risk");
const { registerPaymentTools } = require("./tools/payments");

function createServer() {
  const server = applyToolRisk(new McpServer({ name: "mercadopago", version: "1.0.0" }), toolRisk);
  registerPaymentTools(server);
  return server;
}

async function main() {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
    console.error("ERROR: MERCADOPAGO_ACCESS_TOKEN is required");
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
  console.error("[mercadopago] MCP server started");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Mercado Pago MCP server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { createServer };
