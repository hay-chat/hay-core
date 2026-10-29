import DOMPurify from "dompurify";

/**
 * HTML sanitization for rendered markdown (customer, AI and document content).
 */

/** Links and images may only point at http(s), mailto or same-origin paths. */
const SAFE_URI = /^(?:(?:https?|mailto):|\/(?![/\\])|#)/i;

const ALLOWED_TAGS = [
  "div",
  "span",
  "p",
  "a",
  "img",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "code",
  "pre",
  "blockquote",
  "del",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "br",
  "hr",
];

const ALLOWED_ATTR = [
  "href",
  "title",
  "src",
  "alt",
  "width",
  "height",
  "colspan",
  "rowspan",
  "align",
];

// A dedicated instance, so the hook below doesn't affect other DOMPurify users
// in the bundle. Created on first use: it needs the browser's `window`.
let purifier: ReturnType<typeof DOMPurify> | null = null;
// Classes the current sanitizeHtml call keeps (sanitize runs synchronously).
let keptClasses: ReadonlySet<string> = new Set();

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    purifier = DOMPurify(window);
    // Every link opens in a new tab without access to this window.
    purifier.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      const classes = node.getAttribute("class");
      if (classes !== null) {
        const kept = classes.split(/\s+/).filter((name) => keptClasses.has(name));
        if (kept.length > 0) node.setAttribute("class", kept.join(" "));
        else node.removeAttribute("class");
      }
    });
  }
  return purifier;
}

export interface SanitizeOptions {
  /** Keep `<img>` tags. Off for content a customer wrote. */
  allowImages?: boolean;
  /** Class names to keep (all others are dropped). Styling hooks for our own markup. */
  allowedClasses?: readonly string[];
}

/** Sanitize an HTML string for use with `v-html`. */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  const allowImages = options.allowImages ?? true;
  const allowedClasses = options.allowedClasses ?? [];
  const sanitizer = getPurifier();
  keptClasses = new Set(allowedClasses);
  try {
    return sanitizer.sanitize(html, {
      ALLOWED_TAGS: allowImages ? ALLOWED_TAGS : ALLOWED_TAGS.filter((tag) => tag !== "img"),
      ALLOWED_ATTR: allowedClasses.length > 0 ? [...ALLOWED_ATTR, "class"] : ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: SAFE_URI,
      FORBID_ATTR: allowedClasses.length > 0 ? ["id", "style"] : ["id", "class", "style"],
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    keptClasses = new Set();
  }
}

/**
 * Returns the URL if it is an absolute http(s) URL, otherwise undefined.
 * Use it for `:href` bound to URLs that come from plugins or the AI.
 */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
