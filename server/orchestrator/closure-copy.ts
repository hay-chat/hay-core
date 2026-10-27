/**
 * Fixed shopper-facing closing lines, used when the LLM-written closing
 * message is unavailable. They say the conversation is closed, never that it
 * was "resolved": an unhappy or abandoned chat is not (D5-5).
 */

export type ClosureCopyKey =
  /** The shopper closed the chat happy. */
  | "closeSatisfied"
  /** The shopper closed the chat unhappy. */
  | "closeUnsatisfied"
  /** No reply after the inactivity warning. */
  | "inactivityClose";

type CopyLanguage = "en" | "pt" | "es";

const CLOSURE_COPY: Record<CopyLanguage, Record<ClosureCopyKey, string>> = {
  en: {
    closeSatisfied:
      "Glad I could help. I'll close this conversation now. Write again any time if you need anything else.",
    closeUnsatisfied:
      "I'm sorry I couldn't sort this out for you. I'll close this conversation now. Write again any time and we'll pick it up.",
    inactivityClose:
      "Since I haven't heard back from you, I'll close this conversation for now. Write again any time if you need help.",
  },
  pt: {
    closeSatisfied:
      "Que bom que pude ajudar. Vou encerrar esta conversa agora. Escreva de novo quando precisar.",
    closeUnsatisfied:
      "Sinto muito não ter conseguido resolver isso para você. Vou encerrar esta conversa agora. Escreva de novo quando quiser e retomamos.",
    inactivityClose:
      "Como não tive resposta, vou encerrar esta conversa por enquanto. Escreva de novo quando precisar de ajuda.",
  },
  es: {
    closeSatisfied:
      "Me alegra haber podido ayudarte. Cierro esta conversación ahora. Escríbenos de nuevo cuando lo necesites.",
    closeUnsatisfied:
      "Siento no haber podido resolverlo. Cierro esta conversación ahora. Escríbenos de nuevo cuando quieras y lo retomamos.",
    inactivityClose:
      "Como no he recibido respuesta, cierro esta conversación por ahora. Escríbenos de nuevo cuando necesites ayuda.",
  },
};

/**
 * Pick the line in the first language we have copy for, in priority order.
 * Region tags are ignored ("pt-BR" uses "pt"). Falls back to English.
 */
export function closureCopy(
  key: ClosureCopyKey,
  ...languages: Array<string | null | undefined>
): string {
  for (const language of languages) {
    const base = language?.toLowerCase().split(/[-_]/)[0];
    if (base && base in CLOSURE_COPY) {
      return CLOSURE_COPY[base as CopyLanguage][key];
    }
  }
  return CLOSURE_COPY.en[key];
}
