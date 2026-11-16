// The accessible names of the button and of the teaser's dismiss button, the
// only translated strings the loader needs.
//
// Kept as literals instead of importing the locale files: the bundler does not
// reliably drop the unused keys of an imported object, and the loader is on
// every page view (10 KB budget). loader/__tests__/labels.spec.ts keeps these
// in sync with src/i18n/locales.
import type { Locale } from "@/i18n/resolve";

export interface LauncherLabels {
  open: string;
  dismissTeaser: string;
}

export const launcherLabels: Record<Locale, LauncherLabels> = {
  "en-us": { open: "Open chat", dismissTeaser: "Dismiss message" },
  "pt-br": { open: "Abrir chat", dismissTeaser: "Dispensar mensagem" },
  "pt-pt": { open: "Abrir chat", dismissTeaser: "Dispensar mensagem" },
  "es-es": { open: "Abrir chat", dismissTeaser: "Descartar mensaje" },
  "de-de": { open: "Chat öffnen", dismissTeaser: "Nachricht schließen" },
  "it-it": { open: "Apri chat", dismissTeaser: "Chiudi messaggio" },
  "fr-fr": { open: "Ouvrir le chat", dismissTeaser: "Fermer le message" },
  "nl-nl": { open: "Chat openen", dismissTeaser: "Bericht sluiten" },
  "pl-pl": { open: "Otwórz czat", dismissTeaser: "Zamknij wiadomość" },
  "ja-jp": { open: "チャットを開く", dismissTeaser: "メッセージを閉じる" },
  "zh-cn": { open: "打开聊天", dismissTeaser: "关闭消息" },
  "ko-kr": { open: "채팅 열기", dismissTeaser: "메시지 닫기" },
  "tr-tr": { open: "Sohbeti aç", dismissTeaser: "Mesajı kapat" },
};
