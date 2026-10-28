import type { Conversation } from "@server/database/entities/conversation.entity";
import { createLogger } from "@server/lib/logger";
import { config } from "@server/config/env";
import { notificationLocale, type NotificationLocale } from "./notification-locale";
import { matchesAllowedDomains } from "./webchat/webchat-settings.service";

const logger = createLogger("web-follow-up");

/** One follow-up email per conversation in this window, however many replies the team sends. */
export const FOLLOW_UP_THROTTLE_SECONDS = 30 * 60;

/** Query parameter the widget reads to reopen the conversation (webchat/src/utils/resume.ts). */
export const RESUME_PARAM = "hay_conversation";

const COPY: Record<
  NotificationLocale,
  {
    subject: (company: string) => string;
    title: string;
    message: (sender: string) => string;
    button: string;
    footer: string;
    footerNoLink: string;
  }
> = {
  en: {
    subject: (company) => `${company} replied to your message`,
    title: "You have a reply",
    message: (sender) => `${sender} answered you in the chat:`,
    button: "Continue the conversation",
    footer:
      "Replies to this email don't reach the team. Open the chat to keep talking. The link only works in the browser where you started the chat.",
    footerNoLink:
      "Replies to this email don't reach the team. Open the chat on our website to keep talking.",
  },
  "pt-BR": {
    subject: (company) => `${company} respondeu à sua mensagem`,
    title: "Você recebeu uma resposta",
    message: (sender) => `${sender} respondeu você no chat:`,
    button: "Continuar a conversa",
    footer:
      "Respostas a este e-mail não chegam à equipe. Abra o chat para continuar a conversa. O link só funciona no navegador onde você iniciou o chat.",
    footerNoLink:
      "Respostas a este e-mail não chegam à equipe. Abra o chat no nosso site para continuar a conversa.",
  },
  es: {
    subject: (company) => `${company} respondió a tu mensaje`,
    title: "Tienes una respuesta",
    message: (sender) => `${sender} te respondió en el chat:`,
    button: "Continuar la conversación",
    footer:
      "Las respuestas a este correo no llegan al equipo. Abre el chat para seguir hablando. El enlace solo funciona en el navegador donde iniciaste el chat.",
    footerNoLink:
      "Las respuestas a este correo no llegan al equipo. Abre el chat en nuestro sitio web para seguir hablando.",
  },
};

/**
 * The page the shopper chatted on, with the resume parameter. The URL comes
 * from the widget, so it is only used when its host is one of the org's
 * explicitly allowed domains ("*" does not count): the email goes out from the
 * platform address and must never link to a page the org does not own.
 */
export function resumeUrl(
  pageUrl: unknown,
  allowedDomains: string[],
  conversationId: string,
): string | null {
  if (typeof pageUrl !== "string" || !pageUrl) return null;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const explicit = allowedDomains.filter((entry) => entry.trim() !== "*");
  if (!matchesAllowedDomains(explicit, url.hostname)) return null;
  url.hash = "";
  url.searchParams.set(RESUME_PARAM, conversationId);
  return url.toString();
}

/** Atomically claim the follow-up slot; true when this caller may send. */
async function claimFollowUp(conversationId: string): Promise<boolean> {
  const { redisService } = await import("./redis.service");
  const client = redisService.getClient();
  // Without Redis there is no cross-instance throttle; don't risk flooding the shopper.
  if (!client) return false;
  const result = await client.set(
    `webchat:follow-up:${conversationId}`,
    "1",
    "EX",
    FOLLOW_UP_THROTTLE_SECONDS,
    "NX",
  );
  return result === "OK";
}

/**
 * D5-9: a human answered a web conversation and the shopper is gone (no widget
 * connected). Email the reply from the platform address with a link back to the
 * chat, if the shopper left an email address.
 */
export async function emailHumanReplyIfAway(
  conversation: Conversation,
  message: { content?: string | null; sender?: string | null },
): Promise<boolean> {
  if (conversation.channel !== "web" || conversation.metadata?.isPlayground === true) return false;
  const email = conversation.customer?.email;
  if (!email || !message.content) return false;

  const { websocketService } = await import("./websocket.service");
  if (websocketService.getConversationCount(conversation.id) > 0) return false;
  if (!(await claimFollowUp(conversation.id))) return false;

  const { webchatSettingsService } = await import("./webchat/webchat-settings.service");
  const settings = await webchatSettingsService.getSettings(conversation.organization_id);
  const company = conversation.organization?.name || "Support";
  const locale = notificationLocale(conversation.language);
  const copy = COPY[locale];
  const link = resumeUrl(
    conversation.metadata?.url,
    settings?.allowedDomains ?? [],
    conversation.id,
  );

  try {
    const { emailService } = await import("./email.service");
    const result = await emailService.sendTemplateEmail({
      to: email,
      subject: copy.subject(company),
      template: "notification",
      locale,
      from: { name: company, email: config.smtp.from.email },
      variables: {
        companyName: company,
        notificationTitle: copy.title,
        notificationSubtitle: copy.message(message.sender || company),
        notificationMessage: message.content,
        actionButton: link ? { url: link, text: copy.button } : undefined,
        additionalInfo: link ? copy.footer : copy.footerNoLink,
      },
    });
    if (!result.success) {
      logger.warn({ conversationId: conversation.id, error: result.error }, "Follow-up not sent");
    }
    return result.success;
  } catch (error) {
    logger.error({ err: error, conversationId: conversation.id }, "Follow-up email failed");
    return false;
  }
}
