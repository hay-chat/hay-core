import { headerValue, parseAddress, type HeaderMap } from "./mime.js";

/**
 * Decide what an inbound email is before it reaches the orchestrator.
 *
 *   - echo: our own outbound copy forwarded back (X-Hay-Conversation header)
 *   - forwarding-confirmation: Gmail's "confirm forwarding" mail — surfaced in
 *     the setup UI, never a conversation
 *   - bounce / auto-reply / bulk: stored nowhere, logged — answering them
 *     would start a loop or spam a list
 *   - customer: a real message; `hold` asks core to park it for a human
 *     (DMARC failure on the sender's domain)
 */

export type InboundKind =
  | "customer"
  | "echo"
  | "forwarding-confirmation"
  | "bounce"
  | "auto-reply"
  | "bulk";

export interface Classification {
  kind: InboundKind;
  /** Store the message but keep the AI off it (pending-human). */
  hold: boolean;
  reason?: string;
}

export interface AuthenticationResults {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

export interface ClassifyInput {
  from: string;
  subject: string;
  headers: HeaderMap;
  authentication?: AuthenticationResults | null;
}

const GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google.com";
const BOUNCE_LOCAL_PARTS = new Set(["mailer-daemon", "postmaster", "mail-daemon"]);
const AUTO_REPLY_SUBJECT =
  /^(automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|resposta automática|respuesta automática|réponse automatique|abwesenheit)/i;

export function classifyInbound(input: ClassifyInput): Classification {
  const { headers } = input;
  const sender = parseAddress(input.from)?.address ?? input.from.trim().toLowerCase();
  const local = sender.split("@")[0] ?? "";

  if (headerValue(headers, "x-hay-conversation")) {
    return { kind: "echo", hold: false, reason: "x-hay-conversation" };
  }

  if (sender === GOOGLE_FORWARDING_SENDER) {
    return { kind: "forwarding-confirmation", hold: false };
  }

  const contentType = headerValue(headers, "content-type") ?? "";
  const returnPath = headerValue(headers, "return-path") ?? "";
  if (
    BOUNCE_LOCAL_PARTS.has(local) ||
    /multipart\/report/i.test(contentType) ||
    headerValue(headers, "x-failed-recipients") !== undefined ||
    /^<\s*>$/.test(returnPath.trim())
  ) {
    return { kind: "bounce", hold: false, reason: "bounce" };
  }

  const autoSubmitted = headerValue(headers, "auto-submitted")?.trim().toLowerCase();
  if (
    (autoSubmitted && autoSubmitted !== "no") ||
    headerValue(headers, "x-autoreply") !== undefined ||
    headerValue(headers, "x-autorespond") !== undefined ||
    AUTO_REPLY_SUBJECT.test(input.subject.trim())
  ) {
    return { kind: "auto-reply", hold: false, reason: autoSubmitted ?? "auto-reply" };
  }

  const precedence = headerValue(headers, "precedence")?.trim().toLowerCase();
  if (
    (precedence && ["bulk", "list", "junk"].includes(precedence)) ||
    headerValue(headers, "list-id") !== undefined ||
    headerValue(headers, "list-unsubscribe") !== undefined
  ) {
    return { kind: "bulk", hold: false, reason: precedence ?? "list" };
  }

  if (input.authentication?.dmarc === "fail") {
    return { kind: "customer", hold: true, reason: "dmarc-fail" };
  }

  return { kind: "customer", hold: false };
}

export interface ForwardingConfirmation {
  code?: string;
  link?: string;
}

/** Pull the confirmation code and link out of Gmail's forwarding verification email. */
export function extractForwardingConfirmation(text: string): ForwardingConfirmation {
  const code = text.match(/\b(\d{6,12})\b/)?.[1];
  const link = text
    .match(/https:\/\/mail-settings\.google\.com\/\S+/)?.[0]
    ?.replace(/[)>.,]+$/, "");
  return { code, link };
}
