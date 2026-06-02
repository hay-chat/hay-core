import sanitizeHtmlLib from "sanitize-html";
import TurndownService from "turndown";
import { sanitizeContent } from "./sanitize";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "hr",
];

const ALLOWED_SCHEMES = ["http", "https", "mailto"];

export function sanitizeEditorHtml(html: string): string {
  if (!html) return "";

  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
    },
    allowedSchemes: ALLOWED_SCHEMES,
    // Allow internal document links: /documents/<uuid>
    allowedSchemesByTag: {
      a: ALLOWED_SCHEMES,
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || "";
        const isInternal = href.startsWith("/documents/");
        const isExternal = /^https?:\/\//i.test(href) || href.startsWith("mailto:");

        if (!isInternal && !isExternal) {
          // Drop unsafe links by stripping href
          return { tagName, attribs: {} };
        }

        const safeAttribs: Record<string, string> = { href };
        if (isExternal) {
          safeAttribs.target = "_blank";
          safeAttribs.rel = "noopener noreferrer";
        }
        return { tagName, attribs: safeAttribs };
      },
    },
  });
}

// Product descriptions get a tighter allowlist — no headings (cards render
// inline), no editor-specific link transforms.
const PRODUCT_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "hr",
];

function sanitizeProductHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtmlLib(html, {
    allowedTags: PRODUCT_ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
    },
    allowedSchemes: ALLOWED_SCHEMES,
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || "";
        const isExternal = /^https?:\/\//i.test(href) || href.startsWith("mailto:");
        if (!isExternal) {
          const dropped: Record<string, string> = {};
          return { tagName, attribs: dropped };
        }
        const safe: Record<string, string> = {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
        };
        return { tagName, attribs: safe };
      },
    },
    exclusiveFilter: (frame) => {
      // Drop images whose src is not an http(s)/protocol-relative URL.
      // base64 data URIs and relative paths are useless for embeddings.
      if (frame.tag !== "img") return false;
      const src = (frame.attribs.src as string | undefined) || "";
      return !/^https?:\/\//i.test(src) && !src.startsWith("//");
    },
  });
}

let _productTurndown: TurndownService | null = null;
function getProductTurndown(): TurndownService {
  if (_productTurndown) return _productTurndown;
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    hr: "---",
  });
  // Strip images whose src is not an http(s) URL, mirroring HtmlProcessor.
  td.addRule("removeNonUrlImages", {
    filter: (node) => {
      if (node.nodeName !== "IMG") return false;
      const src = node.getAttribute("src") || "";
      return !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("//");
    },
    replacement: () => "",
  });
  _productTurndown = td;
  return td;
}

/**
 * Convert untrusted product HTML to sanitized markdown.
 *
 * Pipeline: sanitize HTML allowlist → Turndown → strip null bytes & control
 * chars. Used at every ingestion boundary (plugin adapters, public ingestion
 * API) so the catalog never persists raw HTML — product cards render markdown,
 * not v-html, removing the stored-XSS surface and keeping embeddings clean.
 */
export function htmlToSanitizedMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  const safeHtml = sanitizeProductHtml(html);
  if (!safeHtml.trim()) return "";
  const markdown = getProductTurndown().turndown(safeHtml);
  return sanitizeContent(markdown);
}
