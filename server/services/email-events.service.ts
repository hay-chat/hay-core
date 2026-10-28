import type {
  MessageProviderError,
  MessageProviderStatus,
} from "@server/database/entities/message.entity";
import { messageRepository } from "@server/repositories/message.repository";
import { createLogger } from "@server/lib/logger";

/**
 * Resend email events (D13-10): bounces, complaints and deliveries of email
 * the email channel sent. The webhook is account-wide (no organization), so
 * the message is found by its RFC Message-ID across organizations; core
 * verifies the svix signature before anything here runs.
 *
 *   email.bounced    → providerStatus failed, providerError {code:"bounced"}
 *   email.complained → providerError {code:"complained"} (status unchanged:
 *                      the mail was delivered, the shopper marked it spam)
 *   email.delivered  → providerStatus delivered, unless already further along
 */

const logger = createLogger("email-events");

export interface ResendEmailEvent {
  type?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    headers?: Array<{ name?: string; value?: string }>;
    bounce?: {
      type?: string;
      subType?: string;
      message?: string;
      diagnosticCode?: string[] | string;
    };
  };
}

const STATUS_RANK: Record<MessageProviderStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** Message-ID candidates as stored: with and without angle brackets. */
export function messageIdCandidates(event: ResendEmailEvent): string[] {
  const header = event.data?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value;
  const raw = [event.data?.message_id, header].filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  const ids = new Set<string>();
  for (const value of raw) {
    const bare = value.trim().replace(/^<|>$/g, "");
    ids.add(bare);
    ids.add(`<${bare}>`);
  }
  return [...ids];
}

function bounceError(event: ResendEmailEvent): MessageProviderError {
  const bounce = event.data?.bounce ?? {};
  const title = [bounce.type, bounce.subType].filter(Boolean).join(" / ") || "Bounced";
  return { code: "bounced", title, message: bounce.message?.slice(0, 500) };
}

export type EmailEventOutcome =
  | {
      handled: false;
      reason: "ignored_type" | "no_message_id" | "message_not_found" | "status_not_newer";
    }
  | {
      handled: true;
      organizationId: string;
      conversationId: string;
      messageId: string;
      channel: string;
      providerStatus: MessageProviderStatus | null;
      providerError: MessageProviderError | null;
    };

export async function applyEmailEvent(event: ResendEmailEvent): Promise<EmailEventOutcome> {
  const type = event.type;
  if (type !== "email.bounced" && type !== "email.complained" && type !== "email.delivered") {
    return { handled: false, reason: "ignored_type" };
  }
  const ids = messageIdCandidates(event);
  if (ids.length === 0) return { handled: false, reason: "no_message_id" };

  const found = await messageRepository.findOutboundByProviderMessageIds(ids);
  if (!found) return { handled: false, reason: "message_not_found" };
  const { message, organizationId, channel } = found;

  let providerStatus = message.providerStatus;
  let providerError = message.providerError;
  if (type === "email.bounced") {
    providerStatus = "failed";
    providerError = bounceError(event);
  } else if (type === "email.complained") {
    providerError = { code: "complained", title: "Marked as spam" };
  } else {
    if (providerStatus && STATUS_RANK[providerStatus] >= STATUS_RANK.delivered) {
      return { handled: false, reason: "status_not_newer" };
    }
    providerStatus = "delivered";
  }

  await messageRepository.update(message.id, { providerStatus, providerError });

  try {
    const { redisService } = await import("./redis.service");
    await redisService.publish("websocket:events", {
      type: "message_status_updated",
      organizationId,
      payload: {
        conversationId: message.conversation_id,
        messageId: message.id,
        providerStatus,
        providerError,
      },
    });
  } catch (error) {
    logger.warn({ err: error, messageId: message.id }, "Failed to publish email status update");
  }

  return {
    handled: true,
    organizationId,
    conversationId: message.conversation_id,
    messageId: message.id,
    channel,
    providerStatus,
    providerError,
  };
}
