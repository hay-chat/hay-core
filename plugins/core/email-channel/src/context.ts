import type { HayLogger } from "@hay/plugin-sdk/types";
import type { PluginApi } from "./plugin-api.js";
import type { ResendClient } from "./resend.js";
import type { ForwardingConfirmation } from "./classify.js";

/** Per-org settings resolved from config + env in onStart / onConfigUpdate. */
export interface ChannelSettings {
  /** Ingest address the merchant forwards to, e.g. in-3f9a2b7c1d@inbound.hay.chat. */
  alias: string;
  inboundDomain: string;
  /** The merchant's public support address (what shoppers write to). */
  supportAddress: string | null;
  /** Display name on outbound email. */
  storeName: string;
  /** From address on outbound email; must be on the platform sending domain. */
  fromAddress: string;
  /** BCC the support address on every reply so the merchant's inbox has the archive. */
  bccArchive: boolean;
}

/** Worker-lifetime state surfaced on the settings page. */
export interface ChannelState {
  forwarding: (ForwardingConfirmation & { receivedAt: string; recipient?: string }) | null;
  lastInboundAt: string | null;
  inboundCount: number;
  lastError: string | null;
}

export function emptyState(): ChannelState {
  return { forwarding: null, lastInboundAt: null, inboundCount: 0, lastError: null };
}

/** What route handlers need. */
export interface ChannelContext {
  /** Null until the env and the support address are configured. */
  getSettings: () => ChannelSettings | null;
  /** Null when RESEND_API_KEY is not configured. */
  getResend: () => ResendClient | null;
  api: PluginApi;
  logger: HayLogger;
  state: ChannelState;
}
