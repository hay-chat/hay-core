import type { ChannelContext } from "./context.js";

export interface WebhookSummary {
  processed: number;
  ignored: number;
  statuses: number;
}

// Placeholder — replaced by the inbound normaliser (slice 2).
export async function handleWebhook(_body: unknown, _ctx: ChannelContext): Promise<WebhookSummary> {
  return { processed: 0, ignored: 0, statuses: 0 };
}
