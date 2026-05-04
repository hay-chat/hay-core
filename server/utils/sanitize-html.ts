import sanitizeHtmlLib from "sanitize-html";

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
