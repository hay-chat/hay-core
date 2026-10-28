/**
 * Copy for payment dispute alerts (team email + push, in the organization's
 * notification locale) and for the short note pushed to the platform with the
 * evidence pack (in the pack's locale).
 *
 * Guardrail: nothing here may say or imply that the evidence wins a dispute.
 * The note states facts about the attached file only.
 */
import type { NotificationLocale } from "../notification-locale";
import type { EvidenceLocale, EvidenceTemplate } from "../dispute-evidence/copy";

/** Starts every note Hay.chat writes, so a plugin can replace its own earlier note. */
export const EVIDENCE_NOTE_MARKER = "[Hay.chat]";

/** Every evidence file Hay.chat pushes starts with this, so a plugin can tell its own files apart (SDK: DISPUTE_EVIDENCE_FILE_PREFIX). */
export const EVIDENCE_FILE_PREFIX = "hay-chat-evidence";

export interface AlertFacts {
  order: string | null;
  platform: string;
  amount: string | null;
  reason: string | null;
  dueBy: string | null;
}

type AlertCopy = {
  subject: (facts: AlertFacts) => string;
  title: string;
  reminderSubject: (facts: AlertFacts) => string;
  reminderTitle: string;
  message: (facts: AlertFacts) => string;
  reminderMessage: (facts: AlertFacts) => string;
  labels: { order: string; platform: string; amount: string; reason: string; dueBy: string };
  button: string;
  footer: string;
};

const orderPart = (order: string | null, word: string) => (order ? ` ${word} ${order}` : "");

export const ALERT_COPY: Record<NotificationLocale, AlertCopy> = {
  en: {
    subject: (f) => `New chargeback${orderPart(f.order, "on order")} (${f.platform})`,
    title: "A customer opened a chargeback",
    reminderSubject: (f) => `Chargeback evidence due soon${orderPart(f.order, "for order")}`,
    reminderTitle: "Chargeback evidence is due soon",
    message: (f) =>
      `${f.platform} reported a chargeback${orderPart(f.order, "on order")}. Hay.chat can attach the customer conversations to it; review the response on ${f.platform} before the due date, since some platforms send saved evidence automatically on that date.`,
    reminderMessage: (f) =>
      `The evidence for the chargeback${orderPart(f.order, "on order")} is due${f.dueBy ? ` on ${f.dueBy}` : " soon"} and nothing has been attached yet.`,
    labels: {
      order: "Order",
      platform: "Platform",
      amount: "Amount",
      reason: "Reason",
      dueBy: "Evidence due by",
    },
    button: "Open the dispute",
    footer: "Sent to every owner and admin of this organization.",
  },
  "pt-BR": {
    subject: (f) => `Nova contestação${orderPart(f.order, "no pedido")} (${f.platform})`,
    title: "Um cliente abriu uma contestação",
    reminderSubject: (f) => `Prazo de evidências se aproximando${orderPart(f.order, "do pedido")}`,
    reminderTitle: "O prazo para enviar evidências está chegando",
    message: (f) =>
      `${f.platform} informou uma contestação${orderPart(f.order, "no pedido")}. O Hay.chat pode anexar as conversas com o cliente; revise a resposta em ${f.platform} antes do prazo, pois algumas plataformas enviam as evidências salvas automaticamente nessa data.`,
    reminderMessage: (f) =>
      `As evidências da contestação${orderPart(f.order, "do pedido")} vencem${f.dueBy ? ` em ${f.dueBy}` : " em breve"} e nada foi anexado ainda.`,
    labels: {
      order: "Pedido",
      platform: "Plataforma",
      amount: "Valor",
      reason: "Motivo",
      dueBy: "Prazo das evidências",
    },
    button: "Abrir a contestação",
    footer: "Enviado a todos os proprietários e administradores desta organização.",
  },
  es: {
    subject: (f) => `Nuevo contracargo${orderPart(f.order, "en el pedido")} (${f.platform})`,
    title: "Un cliente abrió un contracargo",
    reminderSubject: (f) => `Vence pronto la evidencia${orderPart(f.order, "del pedido")}`,
    reminderTitle: "La evidencia del contracargo vence pronto",
    message: (f) =>
      `${f.platform} informó un contracargo${orderPart(f.order, "en el pedido")}. Hay.chat puede adjuntarle las conversaciones con el cliente como borrador; revisa la respuesta en ${f.platform} antes de la fecha límite, porque algunas plataformas envían la evidencia guardada automáticamente ese día.`,
    reminderMessage: (f) =>
      `La evidencia del contracargo${orderPart(f.order, "del pedido")} vence${f.dueBy ? ` el ${f.dueBy}` : " pronto"} y todavía no se adjuntó nada.`,
    labels: {
      order: "Pedido",
      platform: "Plataforma",
      amount: "Importe",
      reason: "Motivo",
      dueBy: "Evidencia hasta",
    },
    button: "Abrir el contracargo",
    footer: "Enviado a todos los propietarios y administradores de esta organización.",
  },
};

/** Network reason → evidence pack template. Anything unknown gets the generic one. */
export function templateForReason(reason: string | null | undefined): EvidenceTemplate {
  switch ((reason ?? "").toLowerCase()) {
    case "product_not_received":
    case "not_received":
      return "item_not_received";
    case "product_unacceptable":
    case "not_as_described":
      return "not_as_described";
    case "credit_not_processed":
    case "subscription_canceled":
    case "subscription_cancelled":
    case "canceled":
    case "cancelled":
      return "cancelled_credit";
    default:
      return "generic";
  }
}

/** The free-text note pushed with the pack. Facts about the file only. */
export function evidenceNote(args: {
  locale: EvidenceLocale;
  fileName: string;
  orderLabel: string | null;
  conversationCount: number;
  generatedAt: string;
}): string {
  const { fileName, orderLabel, conversationCount, generatedAt } = args;
  if (args.locale === "pt-BR") {
    const order = orderLabel ? ` sobre o pedido ${orderLabel}` : "";
    return `${EVIDENCE_NOTE_MARKER} O arquivo anexado (${fileName}) contém o histórico completo de ${conversationCount} conversa(s) com o cliente${order}, exportado do Hay.chat em ${generatedAt}. Cada mensagem traz data, hora e fuso horário.`;
  }
  const order = orderLabel ? ` about order ${orderLabel}` : "";
  return `${EVIDENCE_NOTE_MARKER} The attached file (${fileName}) holds the complete history of ${conversationCount} customer conversation(s)${order}, exported from Hay.chat on ${generatedAt}. Every message shows its date, time and time zone.`;
}
