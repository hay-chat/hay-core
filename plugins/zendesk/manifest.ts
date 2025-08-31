import type { HayPluginManifest } from "../base";

export const manifest: HayPluginManifest = {
  name: "hay-plugin-zendesk",
  version: "1.2.0",
  type: ["mcp-connector", "retriever", "playbook"],
  entry: "./dist/index.js",
  capabilities: {
    mcp: {
      tools: [
        { name: "create_invoice", input_schema: "JSONSchemaRefOrInline" },
        { name: "get_balance", input_schema: "JSONSchemaRefOrInline" },
      ],
      transport: "sse|websocket|http",
      auth: ["oauth2", "jwt", "apiKey"],
      installCommand: "cd zendesk-mcp-server && npm install",
      buildCommand: "cd zendesk-mcp-server && npm run build",
      startCommand: "cd zendesk-mcp-server && npm run start",
    },
  },
  permissions: {
    env: ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"],
    scopes: ["org:<orgId>:mcp:invoke"],
  },
  configSchema: {
    zendeskSubdomain: {
      type: "string",
      description: "The subdomain of the Zendesk account",
      label: "Zendesk Subdomain",
      required: true,
      regex: "^[a-z0-9]+",
      env: "ZENDESK_SUBDOMAIN",
    },
    zendeskEmail: {
      type: "string",
      description: "The email of the Zendesk account",
      label: "Zendesk Email",
      required: true,
      regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      env: "ZENDESK_EMAIL",
    },
    zendeskApiToken: {
      type: "string",
      description: "The API token of the Zendesk account",
      label: "Zendesk API Token",
      required: true,
      encrypted: true,
      env: "ZENDESK_API_TOKEN",
    },
  },
  ui: { auth: "oauth2", settings: true },
};
