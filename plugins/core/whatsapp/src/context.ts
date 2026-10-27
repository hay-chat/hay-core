import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import type { WhatsAppConnection } from "./connection.js";
import type { PluginApi } from "./plugin-api.js";
import type { TemplateStore } from "./templates.js";

/** What route handlers need: the live connection, a Graph client and the Hay plugin API. */
export interface ChannelContext {
  /** Null until the org finishes Embedded Signup or fills in manual mode. */
  getConnection: () => WhatsAppConnection | null;
  graph: GraphClient;
  api: PluginApi;
  logger: HayLogger;
  /** This worker's message templates (absent in tests that do not need them). */
  templates?: TemplateStore;
  /** Template sent when an AI hand-off lands outside the 24-hour window. */
  handoffTemplateName?: string;
}
