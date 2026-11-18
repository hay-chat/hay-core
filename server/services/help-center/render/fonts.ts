/**
 * The typefaces a help center can use. Every option but "system" loads one
 * Google Fonts stylesheet on the site's pages, so a visitor's browser contacts
 * Google; "system" loads nothing, for sites that must not.
 *
 * Keep in step with HELP_CENTER_FONT_STACKS / HELP_CENTER_FONT_STYLESHEETS in
 * dashboard/utils/help-center.ts.
 */
import type { HelpCenterFont } from "@server/database/entities/help-center.entity";

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2?";

export interface SiteFont {
  /** Font stack for running text. */
  body: string;
  /** Font stack for headings and the site name. */
  heading: string;
  /** Fixed Google Fonts stylesheet address, or null when nothing is loaded. */
  stylesheet: string | null;
}

export const SITE_FONTS: Record<HelpCenterFont, SiteFont> = {
  sans: {
    body: `"Instrument Sans", ${SYSTEM_SANS}`,
    heading: `"Instrument Sans", ${SYSTEM_SANS}`,
    stylesheet: `${GOOGLE_FONTS_CSS}family=Instrument+Sans:wght@400..700&display=swap`,
  },
  serif: {
    body: `Newsreader, ${SYSTEM_SERIF}`,
    heading: `Newsreader, ${SYSTEM_SERIF}`,
    stylesheet: `${GOOGLE_FONTS_CSS}family=Newsreader:opsz,wght@6..72,400..700&display=swap`,
  },
  rounded: {
    body: `Nunito, ${SYSTEM_SANS}`,
    heading: `Nunito, ${SYSTEM_SANS}`,
    stylesheet: `${GOOGLE_FONTS_CSS}family=Nunito:wght@400..800&display=swap`,
  },
  mono: {
    body: `"Instrument Sans", ${SYSTEM_SANS}`,
    heading: `"JetBrains Mono", ${SYSTEM_MONO}`,
    stylesheet: `${GOOGLE_FONTS_CSS}family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@500..700&display=swap`,
  },
  system: {
    body: SYSTEM_SANS,
    heading: SYSTEM_SANS,
    stylesheet: null,
  },
};

/** Where Google Fonts serves stylesheets and font files from, for the page's policy. */
export const GOOGLE_FONTS_ORIGINS = {
  styles: "https://fonts.googleapis.com",
  files: "https://fonts.gstatic.com",
} as const;
