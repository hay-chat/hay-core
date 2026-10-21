import type { ChannelContext } from "./context.js";

export interface DeliverResult {
  status: number;
  body: { success: boolean; providerMessageId?: string; error?: string };
}

// Placeholder — replaced by outbound delivery (slice 4).
export async function deliver(_payload: unknown, _ctx: ChannelContext): Promise<DeliverResult> {
  return { status: 503, body: { success: false, error: "not_implemented" } };
}
