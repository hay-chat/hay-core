// Import timezone display data from server types
// This ensures a single source of truth for timezone configuration

export const TIMEZONE_GROUPS = [
  {
    label: "Universal",
    options: [
      { value: "UTC", label: "UTC" },
    ],
  },
  {
    label: "Europe",
    options: [
      { value: "Europe/Lisbon", label: "Lisbon" },
      { value: "Europe/London", label: "London" },
      { value: "Europe/Dublin", label: "Dublin" },
      { value: "Europe/Madrid", label: "Madrid" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Europe/Berlin", label: "Berlin" },
      { value: "Europe/Amsterdam", label: "Amsterdam" },
      { value: "Europe/Rome", label: "Rome" },
      { value: "Europe/Zurich", label: "Zurich" },
      { value: "Europe/Stockholm", label: "Stockholm" },
      { value: "Europe/Helsinki", label: "Helsinki" },
      { value: "Europe/Athens", label: "Athens" },
      { value: "Europe/Prague", label: "Prague" },
      { value: "Europe/Warsaw", label: "Warsaw" },
      { value: "Europe/Bucharest", label: "Bucharest" },
      { value: "Europe/Moscow", label: "Moscow" },
    ],
  },
  {
    label: "Atlantic",
    options: [
      { value: "Atlantic/Azores", label: "Azores" },
      { value: "Atlantic/Madeira", label: "Madeira" },
      { value: "Atlantic/Canary", label: "Canary Islands" },
      { value: "Atlantic/Cape_Verde", label: "Cape Verde" },
    ],
  },
  {
    label: "Africa",
    options: [
      { value: "Africa/Casablanca", label: "Casablanca" },
      { value: "Africa/Cairo", label: "Cairo" },
      { value: "Africa/Lagos", label: "Lagos" },
      { value: "Africa/Algiers", label: "Algiers" },
      { value: "Africa/Abidjan", label: "Abidjan" },
      { value: "Africa/Accra", label: "Accra" },
      { value: "Africa/Johannesburg", label: "Johannesburg" },
      { value: "Africa/Nairobi", label: "Nairobi" },
    ],
  },
  {
    label: "Middle East",
    options: [
      { value: "Asia/Jerusalem", label: "Jerusalem" },
      { value: "Asia/Beirut", label: "Beirut" },
      { value: "Asia/Riyadh", label: "Riyadh" },
      { value: "Asia/Dubai", label: "Dubai" },
      { value: "Asia/Tehran", label: "Tehran" },
      { value: "Asia/Baghdad", label: "Baghdad" },
      { value: "Asia/Qatar", label: "Qatar" },
    ],
  },
  {
    label: "Asia",
    options: [
      { value: "Asia/Kolkata", label: "India (UTC+5:30)" },
      { value: "Asia/Kathmandu", label: "Nepal (UTC+5:45)" },
      { value: "Asia/Dhaka", label: "Dhaka" },
      { value: "Asia/Yangon", label: "Myanmar (UTC+6:30)" },
      { value: "Asia/Bangkok", label: "Bangkok" },
      { value: "Asia/Jakarta", label: "Jakarta" },
      { value: "Asia/Singapore", label: "Singapore" },
      { value: "Asia/Kuala_Lumpur", label: "Kuala Lumpur" },
      { value: "Asia/Manila", label: "Manila" },
      { value: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh" },
      { value: "Asia/Shanghai", label: "Shanghai/Beijing" },
      { value: "Asia/Hong_Kong", label: "Hong Kong" },
      { value: "Asia/Taipei", label: "Taipei" },
      { value: "Asia/Tokyo", label: "Tokyo" },
      { value: "Asia/Seoul", label: "Seoul" },
    ],
  },
  {
    label: "Oceania",
    options: [
      { value: "Australia/Perth", label: "Perth" },
      { value: "Australia/Adelaide", label: "Adelaide" },
      { value: "Australia/Brisbane", label: "Brisbane" },
      { value: "Australia/Sydney", label: "Sydney" },
      { value: "Australia/Melbourne", label: "Melbourne" },
      { value: "Pacific/Auckland", label: "Auckland" },
      { value: "Pacific/Fiji", label: "Fiji" },
      { value: "Pacific/Honolulu", label: "Honolulu" },
    ],
  },
  {
    label: "North America",
    options: [
      { value: "America/Anchorage", label: "Anchorage" },
      { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
      { value: "America/Vancouver", label: "Vancouver" },
      { value: "America/Phoenix", label: "Phoenix (no DST)" },
      { value: "America/Denver", label: "Denver (MT)" },
      { value: "America/Chicago", label: "Chicago (CT)" },
      { value: "America/Mexico_City", label: "Mexico City" },
      { value: "America/New_York", label: "New York (ET)" },
      { value: "America/Toronto", label: "Toronto" },
      { value: "America/Puerto_Rico", label: "Puerto Rico" },
    ],
  },
  {
    label: "South America",
    options: [
      { value: "America/Caracas", label: "Caracas" },
      { value: "America/Bogota", label: "Bogotá" },
      { value: "America/Quito", label: "Quito" },
      { value: "America/Lima", label: "Lima" },
      { value: "America/Santiago", label: "Santiago" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
      { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
      { value: "America/Montevideo", label: "Montevideo" },
    ],
  },
];

// Helper to get timezone with dynamic offset
export function getTimezoneWithOffset(tz: string, label: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    }).formatToParts(now);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value?.replace(/^UTC/, "GMT") ?? "";
    return offset ? `${label} (${offset})` : label;
  } catch {
    return label;
  }
}