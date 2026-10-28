/**
 * Team notification copy (push, alert emails) exists in English, Brazilian
 * Portuguese and Spanish. Organization languages are short codes ("pt", "es",
 * see types/language.types.ts); anything without copy falls back to English.
 */
export type NotificationLocale = "en" | "pt-BR" | "es";

export function notificationLocale(language: string | null | undefined): NotificationLocale {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  if (base === "es") return "es";
  return "en";
}

/** Users have no language of their own yet, so the organization's language decides. */
export async function organizationNotificationLocale(
  organizationId: string,
): Promise<NotificationLocale> {
  const { getOrganizationLocale } = await import("./email.service");
  return notificationLocale(await getOrganizationLocale(organizationId));
}
