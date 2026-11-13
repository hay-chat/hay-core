/** Pure helpers for the Webchat settings page and the Webchat card in the channel list. */

export type WebchatTab = "appearance" | "content" | "install" | "security";
export const WEBCHAT_TABS: WebchatTab[] = ["appearance", "content", "install", "security"];

export type WebchatThemeMode = "light" | "dark" | "system";
export type WebchatInstallStatus = "live" | "notInstalled" | "off";

/** Live once the widget has been seen on a website; off when it is switched off. */
export function webchatInstallStatus(
  isEnabled: boolean,
  lastSeenAt: string | null | undefined,
): WebchatInstallStatus {
  if (!isEnabled) return "off";
  return lastSeenAt ? "live" : "notInstalled";
}

/** Where the Webchat card opens: Install until the widget runs somewhere, Appearance after. */
export function webchatLandingTab(lastSeenAt: string | null | undefined): WebchatTab {
  return lastSeenAt ? "appearance" : "install";
}

export function parseWebchatTab(value: unknown): WebchatTab {
  return WEBCHAT_TABS.includes(value as WebchatTab) ? (value as WebchatTab) : "appearance";
}

/** "https://www.acme.com/shop" → "www.acme.com"; a bare host passes through; junk gives null. */
export function websiteHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).host || null;
  } catch {
    return null;
  }
}

/** A link to the page the widget was last seen on (the server stores a host or an origin). */
export function websiteUrl(value: string | null | undefined): string | null {
  const host = websiteHost(value);
  if (!host) return null;
  return /^http:\/\//i.test(value!.trim()) ? `http://${host}` : `https://${host}`;
}

/** "#14532d", "14532D" or "#1a3" → "#14532d"; anything else → null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const raw = value?.trim().replace(/^#/, "").toLowerCase() ?? "";
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`;
  return null;
}

/** "2 minutes ago", "yesterday", in the dashboard's language. */
export function formatSince(date: string | Date, locale: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/** The config the dashboard preview hands the widget (contract C4). */
export interface WebchatPreviewConfig {
  organizationId: string;
  baseUrl: string;
  position: "left" | "right";
  brandColor: string;
  themeMode: WebchatThemeMode;
  logoUrl: string | null;
  homeHeading: string | null;
  widgetTitle: string;
  greetingMessage: string;
  showGreeting: boolean;
  csatEnabled: boolean;
  csatQuestion: string;
  teaserMessage: string;
  preview: { state: "home" | "chat" | "ended"; device: "desktop" | "mobile" };
}

/**
 * The page inside the preview iframe: the real widget.js, configured like an embed.
 *
 * A srcdoc frame inherits the dashboard's Content-Security-Policy, which allows no inline
 * scripts. So the config travels as a JSON data block (not executed, so CSP lets it through)
 * that widget.js reads. `<` is escaped so settings text cannot close the block.
 */
export function buildPreviewSrcdoc(config: WebchatPreviewConfig, background: string): string {
  const json = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:${background}}</style></head>
<body><${"script"} type="application/json" id="hay-chat-config">${json}</${"script"}>
<${"script"} src="${config.baseUrl}/v1/webchat/widget.js" async></${"script"}></body></html>`;
}
