/**
 * i18n keys explaining why a conversation is held as spam (D9-7): the
 * detector's signals when it recorded them, otherwise who flagged it.
 */
const KNOWN_SIGNALS = new Set([
  "links",
  "link_only",
  "repeated",
  "too_long",
  "no_text",
  "known_pattern",
  "unverified",
]);
const KNOWN_SOURCES = new Set(["detector", "staff", "close_classifier"]);

export function spamSourceOf(reason: string | null | undefined): string {
  if (!reason) return "other";
  if (reason.startsWith("detector:")) return "detector";
  return KNOWN_SOURCES.has(reason) ? reason : "other";
}

export function spamReasonKeys(source: string, signals: readonly string[] = []): string[] {
  const known = signals.filter((signal) => KNOWN_SIGNALS.has(signal));
  if (known.length > 0) return known.map((signal) => `home.spam.signals.${signal}`);
  return [`home.spam.sources.${KNOWN_SOURCES.has(source) ? source : "other"}`];
}
