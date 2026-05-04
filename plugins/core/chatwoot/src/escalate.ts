import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { ChatwootApi } from "./chatwoot-api.js";
import { ChatwootApiError } from "./chatwoot-api.js";

export interface EscalateContext {
  getChatwootApi: () => ChatwootApi | null;
  getDefaultEscalationTeamId: () => string | null;
  logger: HayLogger;
}

interface EscalatePayload {
  conversationId: string;
  conversationMetadata?: Record<string, any> | null;
  reason?: string;
}

/**
 * Escalation handler — called by Hay's ChannelDeliveryService when a
 * conversation flips to `pending-human` (i.e. the orchestrator emitted a
 * HANDOFF). Chatwoot handoff is three steps:
 *
 *   1. Optional internal note with the handoff reason so the human agent has
 *      context about what the bot already tried.
 *   2. toggle_status → "open" so the conversation exits the bot's `pending`
 *      queue and enters the normal human agent queue.
 *   3. Optional team assignment if the plugin config has a default team set.
 *
 * Failure is non-fatal — we log and return 200 so Hay doesn't retry-storm us.
 */
export async function escalateHandler(
  req: Request,
  res: Response,
  ctx: EscalateContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const api = ctx.getChatwootApi();
    if (!api) {
      logger.warn("Escalate called but Chatwoot API client not configured");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const { conversationId, conversationMetadata, reason } = req.body as EscalatePayload;

    const chatwootConversationId =
      conversationMetadata?.chatwoot?.conversationId ??
      conversationMetadata?.chatwoot?.chatwootConversationId;

    if (!chatwootConversationId) {
      logger.warn("Escalate: missing chatwoot conversation id — skipping", { conversationId });
      res.status(200).json({ success: false, error: "missing_chatwoot_conversation_id" });
      return;
    }

    logger.info("Escalating Chatwoot conversation to human", {
      chatwootConversationId,
      conversationId,
      reason,
    });

    // Step 1 — internal note (best-effort; don't fail escalation if note fails)
    try {
      const note =
        `🤖 Hay AI handed this conversation off to a human agent.` +
        (reason ? ` Reason: ${reason}.` : "");
      await api.sendMessage(chatwootConversationId, note, { private: true });
    } catch (noteErr: any) {
      logger.warn("Failed to post handoff internal note — continuing", {
        error: noteErr?.message,
      });
    }

    // Step 2 — move conversation out of bot's `pending` into the normal queue
    await api.toggleStatus(chatwootConversationId, "open");

    // Step 3 — optional team assignment
    const teamId = ctx.getDefaultEscalationTeamId();
    if (teamId) {
      try {
        await api.assignTeam(chatwootConversationId, teamId);
      } catch (assignErr: any) {
        logger.warn("Failed to assign Chatwoot conversation to escalation team", {
          error: assignErr?.message,
          teamId,
          chatwootConversationId,
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    if (error instanceof ChatwootApiError) {
      logger.error("Chatwoot API returned error on escalate", {
        status: error.status,
        message: error.message,
      });
      res.status(200).json({ success: false, error: `chatwoot_${error.status}` });
      return;
    }

    logger.error("Failed to escalate Chatwoot conversation", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}
