import type { ChannelContext, ChannelState } from "./context.js";
import { tokenAddress } from "./thread.js";

/** What the settings page shows. */
export interface ChannelStatus {
  /** Env + support address present: the channel can receive and send. */
  configured: boolean;
  /** Which prerequisites are missing (env names or "supportAddress"). */
  missing: string[];
  alias: string | null;
  supportAddress: string | null;
  storeName: string | null;
  fromAddress: string | null;
  replyToExample: string | null;
  bccArchive: boolean;
  forwarding: ChannelState["forwarding"];
  lastInboundAt: string | null;
  inboundCount: number;
  lastError: string | null;
}

export function getChannelStatus(ctx: ChannelContext, missingEnv: string[]): ChannelStatus {
  const settings = ctx.getSettings();
  const missing = [...missingEnv];
  if (!settings?.supportAddress) {
    missing.push("supportAddress");
  }
  return {
    configured: missing.length === 0 && ctx.getResend() !== null,
    missing,
    alias: settings?.alias ?? null,
    supportAddress: settings?.supportAddress ?? null,
    storeName: settings?.storeName ?? null,
    fromAddress: settings?.fromAddress ?? null,
    replyToExample: settings
      ? tokenAddress(settings.alias, "00000000-0000-4000-8000-000000000000")
      : null,
    bccArchive: settings?.bccArchive ?? false,
    forwarding: ctx.state.forwarding,
    lastInboundAt: ctx.state.lastInboundAt,
    inboundCount: ctx.state.inboundCount,
    lastError: ctx.state.lastError,
  };
}
