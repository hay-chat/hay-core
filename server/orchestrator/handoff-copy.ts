/**
 * Fixed shopper-facing hand-off lines, used when no LLM-written or
 * merchant-configured message is available.
 *
 * Honesty rules: never promise a response time ("shortly", "soon") and never
 * say someone is available when we don't know that. Business-hours-aware copy
 * ("we're closed, back at 9:00") replaces these in D5-6/D5-7.
 */

export type HandoffCopyKey =
  /** Handed to the team; we don't know whether anyone is online. */
  | "handoffQueued"
  /** Handed to the team and nobody is online right now. */
  | "handoffNobodyOnline"
  /** Stale-message recovery gave up and handed the chat to the team. */
  | "recoveryEscalation";

type CopyLanguage = "en" | "pt" | "es";

const HANDOFF_COPY: Record<CopyLanguage, Record<HandoffCopyKey, string>> = {
  en: {
    handoffQueued: "I've passed this to the team. They'll reply to you here in this chat.",
    handoffNobodyOnline:
      "No one from the team is online right now. I've passed your message on, and they'll reply to you here in this chat.",
    recoveryEscalation:
      "Sorry, I ran into a problem with your message. I've passed it to the team, and they'll reply to you here in this chat.",
  },
  pt: {
    handoffQueued: "Encaminhei sua mensagem para a equipe. Eles vão te responder aqui neste chat.",
    handoffNobodyOnline:
      "Ninguém da equipe está online agora. Encaminhei sua mensagem, e eles vão te responder aqui neste chat.",
    recoveryEscalation:
      "Desculpe, tive um problema com a sua mensagem. Encaminhei para a equipe, e eles vão te responder aqui neste chat.",
  },
  es: {
    handoffQueued: "Le pasé tu mensaje al equipo. Te responderán aquí, en este chat.",
    handoffNobodyOnline:
      "Ahora mismo no hay nadie del equipo conectado. Les pasé tu mensaje y te responderán aquí, en este chat.",
    recoveryEscalation:
      "Lo siento, tuve un problema con tu mensaje. Se lo pasé al equipo y te responderán aquí, en este chat.",
  },
};

/**
 * Pick the line in the first language we have copy for, in priority order
 * (customer's detected language, conversation language, organization default).
 * Region tags are ignored ("pt-BR" uses "pt"). Falls back to English.
 */
export function handoffCopy(
  key: HandoffCopyKey,
  ...languages: Array<string | null | undefined>
): string {
  for (const language of languages) {
    const base = language?.toLowerCase().split(/[-_]/)[0];
    if (base && base in HANDOFF_COPY) {
      return HANDOFF_COPY[base as CopyLanguage][key];
    }
  }
  return HANDOFF_COPY.en[key];
}
