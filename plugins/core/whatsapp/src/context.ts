import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import type { WhatsAppConnection } from "./connection.js";
import type { PluginApi } from "./plugin-api.js";

/** What route handlers need: the live connection, a Graph client and the Hay plugin API. */
export interface ChannelContext {
  /** Null until the org finishes Embedded Signup or fills in manual mode. */
  getConnection: () => WhatsAppConnection | null;
  graph: GraphClient;
  api: PluginApi;
  logger: HayLogger;
}
