import { ref } from "vue";
import { parseUTCDate } from "~/utils/date";

// Module-level reactive state (shared across all components, same pattern as useToast)
const orgDateFormat = ref("MM/DD/YYYY");
const orgTimeFormat = ref("12h");
const orgTimezone = ref("UTC");

type DateInput = Date | string | null | undefined;

interface DateFormatMapping {
  locale: string;
  options: Intl.DateTimeFormatOptions;
}

function getDateLocaleAndOptions(format: string): DateFormatMapping {
  switch (format) {
    case "DD/MM/YYYY":
      return { locale: "en-GB", options: { day: "2-digit", month: "2-digit", year: "numeric" } };
    case "YYYY-MM-DD":
      return { locale: "sv-SE", options: { year: "numeric", month: "2-digit", day: "2-digit" } };
    case "DD MMM YYYY":
      return { locale: "en-GB", options: { day: "2-digit", month: "short", year: "numeric" } };
    case "MM/DD/YYYY":
    default:
      return { locale: "en-US", options: { month: "2-digit", day: "2-digit", year: "numeric" } };
  }
}

function getTimeOptions(format: string): Intl.DateTimeFormatOptions {
  return {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12h",
  };
}

export function useOrgDateTime() {
  function setOrgDateTimeSettings(settings: {
    dateFormat?: string;
    timeFormat?: string;
    timezone?: string;
  }) {
    if (settings.dateFormat) orgDateFormat.value = settings.dateFormat;
    if (settings.timeFormat) orgTimeFormat.value = settings.timeFormat;
    if (settings.timezone) orgTimezone.value = settings.timezone;
  }

  function formatDate(date: DateInput): string {
    const parsed = parseUTCDate(date);
    if (!parsed) return "Unknown";

    const { locale, options } = getDateLocaleAndOptions(orgDateFormat.value);
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: orgTimezone.value,
    }).format(parsed);
  }

  function formatTime(date: DateInput): string {
    const parsed = parseUTCDate(date);
    if (!parsed) return "Unknown";

    const { locale } = getDateLocaleAndOptions(orgDateFormat.value);
    return new Intl.DateTimeFormat(locale, {
      ...getTimeOptions(orgTimeFormat.value),
      timeZone: orgTimezone.value,
    }).format(parsed);
  }

  function formatDateTime(date: DateInput): string {
    const parsed = parseUTCDate(date);
    if (!parsed) return "Unknown";

    const { locale, options } = getDateLocaleAndOptions(orgDateFormat.value);
    return new Intl.DateTimeFormat(locale, {
      ...options,
      ...getTimeOptions(orgTimeFormat.value),
      timeZone: orgTimezone.value,
    }).format(parsed);
  }

  function formatShortDate(date: DateInput): string {
    const parsed = parseUTCDate(date);
    if (!parsed) return "Unknown";

    const { locale } = getDateLocaleAndOptions(orgDateFormat.value);
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: orgTimezone.value,
    }).format(parsed);
  }

  return {
    formatDate,
    formatTime,
    formatDateTime,
    formatShortDate,
    setOrgDateTimeSettings,
  };
}
