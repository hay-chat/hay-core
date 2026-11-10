/**
 * Team notification copy (push, alert emails) exists in English, Brazilian
 * Portuguese, Spanish and Dutch. Organization languages are short codes ("pt",
 * "es", see types/language.types.ts), interface languages dashboard locales
 * ("pt-BR"); anything without copy falls back to English.
 */
export type NotificationLocale = "en" | "pt-BR" | "es" | "nl";

export function notificationLocale(language: string | null | undefined): NotificationLocale {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  if (base === "es") return "es";
  if (base === "nl") return "nl";
  return "en";
}

/**
 * A person's notification locale: their interface language, else the
 * organization's.
 */
export function recipientNotificationLocale(
  interfaceLanguage: string | null | undefined,
  organizationLocale: NotificationLocale,
): NotificationLocale {
  return interfaceLanguage ? notificationLocale(interfaceLanguage) : organizationLocale;
}

/**
 * Split already-loaded recipients by the locale each one reads, so a fan-out
 * builds each copy once and needs no query per person.
 */
export function groupByNotificationLocale<T>(
  recipients: readonly T[],
  interfaceLanguage: (recipient: T) => string | null | undefined,
  organizationLocale: NotificationLocale,
): Map<NotificationLocale, T[]> {
  const groups = new Map<NotificationLocale, T[]>();
  for (const recipient of recipients) {
    const locale = recipientNotificationLocale(interfaceLanguage(recipient), organizationLocale);
    groups.set(locale, [...(groups.get(locale) ?? []), recipient]);
  }
  return groups;
}

/** The organization's language, for recipients without one of their own (or not users at all). */
export async function organizationNotificationLocale(
  organizationId: string,
): Promise<NotificationLocale> {
  const { getOrganizationLocale } = await import("./email.service");
  return notificationLocale(await getOrganizationLocale(organizationId));
}

/** One person's notification locale; the organization is only looked up when they have no language. */
export async function userNotificationLocale(
  interfaceLanguage: string | null | undefined,
  organizationId: string,
): Promise<NotificationLocale> {
  return interfaceLanguage
    ? notificationLocale(interfaceLanguage)
    : organizationNotificationLocale(organizationId);
}
