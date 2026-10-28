/**
 * The header subtitle Hay.chat used to ship as its default. It promises a reply
 * time Hay.chat cannot guarantee, and it is baked into existing embed snippets
 * and into stored webchat settings as if the merchant had typed it. Treat it as
 * "not set" so those installs get the neutral, localised default instead.
 * A subtitle the merchant actually wrote is always kept.
 */
const LEGACY_DEFAULT_SUBTITLE = "we typically reply within minutes";

export function resolveWidgetSubtitle(configured: string | undefined, fallback: string): string {
  const value = configured?.trim();
  if (!value || value.toLowerCase() === LEGACY_DEFAULT_SUBTITLE) return fallback;
  return value;
}
