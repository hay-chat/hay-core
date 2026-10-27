import type { HayLogger } from "@hay/plugin-sdk/types";
import type { ChannelSettings } from "./context.js";
import { parseAddressList } from "./mime.js";
import type { PluginApi } from "./plugin-api.js";

/**
 * Team notifications — the agent-facing `send-email` action.
 *
 * The AI can email the merchant's team (e.g. "tell the team a customer asked
 * for a refund"), never an arbitrary address: recipients come from config
 * only, so a shopper cannot talk the agent into mailing someone else. Mail
 * goes through the same platform relay as channel replies, from the same
 * sender. If the support mailbox forwards it back to Hay, the From address
 * marks it as our own echo and it is dropped (classify.ts), so the fallback
 * to the support address cannot loop.
 */

export const NOTIFY_SERVER_ID = "email-mcp";

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface NotificationRecipients {
  /** Addresses the tool sends to: the configured list, else the support address. */
  recipients: string[];
  /** Entries in the configured list that are not valid addresses (ignored). */
  invalid: string[];
}

/** Resolve recipients from the comma-separated config value, falling back to the support address. */
export function resolveNotificationRecipients(
  configured: string | undefined,
  supportAddress: string | null,
): NotificationRecipients {
  const raw = (configured ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const parsed = raw.map((item) => ({ item, address: parseAddressList(item)[0]?.address }));
  const invalid = parsed
    .filter(({ address }) => !address || !EMAIL_PATTERN.test(address))
    .map(({ item }) => item);
  const valid = Array.from(
    new Set(
      parsed
        .map(({ address }) => address)
        .filter((address): address is string => !!address && EMAIL_PATTERN.test(address)),
    ),
  );
  if (valid.length > 0) {
    return { recipients: valid, invalid };
  }
  return { recipients: supportAddress ? [supportAddress] : [], invalid };
}

export interface ToolDescriptor {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const SEND_EMAIL_TOOL: ToolDescriptor = {
  name: "send-email",
  description:
    "Email the store's team (the notification addresses set in the Email inbox settings, or the support address). " +
    "Use it to alert staff about something that needs a person, e.g. a refund request or an angry customer. " +
    "It cannot email customers or any other address.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
    },
    required: ["subject", "body"],
  },
};

export interface NotifyDeps {
  /** Channel settings; null when the host lacks inbound email env (mail then uses the platform default sender). */
  getSettings: () => ChannelSettings | null;
  getRecipients: () => string[];
  api: PluginApi;
  logger: HayLogger;
}

export interface SendEmailToolResult {
  success: true;
  message: string;
  messageId?: string;
  recipients: string[];
  subject: string;
}

/** Run the send-email tool. Throws with a user-facing message on any failure. */
export async function sendTeamEmail(
  args: Record<string, unknown>,
  deps: NotifyDeps,
): Promise<SendEmailToolResult> {
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!subject || !body) {
    throw new Error("Subject and body are required");
  }
  const recipients = deps.getRecipients();
  if (recipients.length === 0) {
    throw new Error(
      "No team address configured — set notification addresses or the support address in the Email inbox settings",
    );
  }
  const settings = deps.getSettings();
  const sent = await deps.api.sendEmail({
    to: recipients,
    subject,
    body,
    from: settings ? { email: settings.fromAddress, name: settings.storeName } : undefined,
    headers: { "Auto-Submitted": "auto-generated" },
  });
  if (!sent.success) {
    deps.logger.error("Team email send failed", { error: sent.error });
    throw new Error(`Failed to send email: ${sent.error ?? "unknown error"}`);
  }
  deps.logger.info("Team email sent", { messageId: sent.messageId, count: recipients.length });
  return {
    success: true,
    message: `Email sent to ${recipients.length} recipient(s)`,
    messageId: sent.messageId,
    recipients,
    subject,
  };
}

/** In-process MCP server for `ctx.mcp.startLocal`. Reads settings at call time, so config edits apply without a restart. */
export function createNotifyServer(deps: NotifyDeps) {
  return {
    async listTools(): Promise<ToolDescriptor[]> {
      return [SEND_EMAIL_TOOL];
    },
    async callTool(toolName: string, args: Record<string, unknown>): Promise<SendEmailToolResult> {
      if (toolName !== SEND_EMAIL_TOOL.name) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return sendTeamEmail(args, deps);
    },
    async stop(): Promise<void> {},
  };
}
