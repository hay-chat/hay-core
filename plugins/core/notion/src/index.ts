/**
 * Notion Plugin
 *
 * Imports Notion pages and database entries as documents into Hay's knowledge
 * base. The actual import work runs through the tRPC router declared in
 * router.ts (consumed by the core document-source sync engine via
 * createCaller). This entry only registers the connection config + auth and
 * validates the integration token with a live round-trip.
 *
 * Auth: a single internal-integration token (Bearer). The integration only
 * sees the pages/databases a workspace member has shared with it — that sharing
 * is the import scope boundary.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import { NotionClient } from "./notion-client.js";

export default defineHayPlugin((globalCtx) => ({
  name: "Notion",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Notion plugin");

    // Per-org connection settings (shown as a form to users). MUST be
    // registered here for ctx.config.getOptional() to resolve them inside the
    // worker — the package.json `config` block alone is not enough.
    ctx.register.config({
      apiToken: {
        type: "string",
        label: "Internal Integration Token",
        description:
          "Create an internal integration at notion.so/my-integrations, then share the pages " +
          "and databases you want to import with it. Token starts with 'ntn_' or 'secret_'.",
        required: true,
        encrypted: true,
      },
      notionVersion: {
        type: "string",
        label: "Notion API version",
        description: "The Notion-Version header sent with every request.",
        required: false,
        encrypted: false,
        default: "2022-06-28",
      },
    });

    // API-key auth tied to the encrypted `apiToken` config field.
    ctx.register.auth.apiKey({
      id: "notion-apikey",
      label: "Notion Integration Token",
      configField: "apiToken",
    });

    globalCtx.logger.info("Notion plugin registered (document importer)");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Notion integration token");

    const apiToken = ctx.config.getOptional<string>("apiToken");
    if (!apiToken) {
      throw new Error("No Notion integration token configured.");
    }
    const notionVersion = ctx.config.getOptional<string>("notionVersion");

    const client = new NotionClient(apiToken, notionVersion);
    const result = await client.ping();
    if (!result.ok) {
      throw new Error(
        `Could not reach Notion with the provided token: ${result.error}. ` +
          "Check the token is valid and at least one page or database is shared with the integration.",
      );
    }
    return true;
  },

  async onStart(ctx) {
    // Document import runs entirely through the tRPC router (createCaller), so
    // there is nothing to start here. Gate on credentials and surface a clear
    // log line instead of crashing the worker when unconfigured.
    const apiToken = ctx.config.getOptional<string>("apiToken");
    if (!apiToken) {
      ctx.logger.warn("Notion plugin started without an integration token; import is inactive.");
      return;
    }
    ctx.logger.info("Notion plugin ready for document import", { orgId: ctx.org.id });
  },

  async onConfigUpdate(ctx) {
    ctx.logger.info("Notion plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Notion plugin disabled for org", { orgId: ctx.org.id });
  },
}));
