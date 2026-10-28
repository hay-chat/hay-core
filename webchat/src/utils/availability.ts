import type { HayChatConfig } from "@/types";
import type { TranslationKey } from "@/i18n";

/** `webchat.getAvailability` (D5-7, D5-10). */
export interface WidgetAvailability {
  state: "open" | "open_nobody_online" | "closed";
  nextOpening: string | null;
  timezone: string;
  hasSchedule: boolean;
  /** Median first human reply; null when there is not enough data. */
  typicalReplyMinutes: number | null;
}

type Translate = (key: TranslationKey) => string;

/** Resolves to null on any failure: availability is a hint, never a blocker. */
export async function fetchAvailability(config: HayChatConfig): Promise<WidgetAvailability | null> {
  try {
    const input = JSON.stringify({ organizationId: config.organizationId });
    const response = await fetch(
      `${config.baseUrl}/v1/webchat.getAvailability?input=${encodeURIComponent(input)}`,
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.result?.data ?? null;
  } catch {
    return null;
  }
}

/** The next opening in the shopper's own clock, e.g. "Mon 09:00". */
export function formatOpening(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatWait(minutes: number, t: Translate): string {
  if (minutes < 60) return t("waiting.minutes").replace("{n}", String(minutes));
  return t("waiting.hours").replace("{n}", String(Math.round(minutes / 60)));
}

/** Header line: "Open now" / "Back Mon 09:00". Only for orgs that set business hours. */
export function headerStatus(
  availability: WidgetAvailability | null,
  t: Translate,
  locale: string,
): string | null {
  if (!availability?.hasSchedule) return null;
  if (availability.state !== "closed") return t("availability.open");
  if (!availability.nextOpening) return t("availability.closed");
  return t("availability.backAt").replace(
    "{when}",
    formatOpening(availability.nextOpening, locale),
  );
}

/** The line under "Waiting for a person"; null when there is nothing worth saying. */
export function waitingDetail(
  availability: WidgetAvailability | null,
  t: Translate,
  locale: string,
): string | null {
  if (!availability) return null;
  if (availability.state === "closed" && availability.nextOpening) {
    return t("waiting.closed").replace("{when}", formatOpening(availability.nextOpening, locale));
  }
  const typical =
    availability.state !== "closed" && availability.typicalReplyMinutes
      ? t("waiting.typical").replace("{time}", formatWait(availability.typicalReplyMinutes, t))
      : null;
  if (availability.state === "open_nobody_online") {
    return typical ? `${t("waiting.alerted")} ${typical}` : t("waiting.alerted");
  }
  return typical;
}
