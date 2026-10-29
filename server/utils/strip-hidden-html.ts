import * as cheerio from "cheerio";

/** Inline styles that hide an element from visitors. */
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;

/**
 * Remove markup a visitor cannot see (`hidden`, `aria-hidden="true"`,
 * `<template>`, inline `display:none` / `visibility:hidden`) so imported web
 * pages only carry visible text. Class-based hiding from stylesheets is not
 * detectable without rendering and is left as is.
 */
export function removeHiddenElements($: cheerio.CheerioAPI): void {
  $('[hidden], [aria-hidden="true" i], template').remove();
  $("[style]")
    .filter((_, element) => HIDDEN_STYLE.test($(element).attr("style") ?? ""))
    .remove();
}

/** `removeHiddenElements` for an HTML string. */
export function stripHiddenHtml(html: string): string {
  const $ = cheerio.load(html);
  removeHiddenElements($);
  return $.html();
}
