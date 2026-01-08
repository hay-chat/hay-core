/**
 * HTML sanitization utilities for the dashboard
 *
 * IMPORTANT: This is a basic sanitizer for trusted plugin templates.
 * For user-generated content, use a more robust library like DOMPurify.
 */

/**
 * Allowed HTML tags for plugin templates
 */
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
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "br",
  "hr",
];

/**
 * Allowed attributes for HTML elements
 */
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height"],
  div: ["class", "id"],
  span: ["class", "id"],
  p: ["class", "id"],
  h1: ["class", "id"],
  h2: ["class", "id"],
  h3: ["class", "id"],
  h4: ["class", "id"],
  h5: ["class", "id"],
  h6: ["class", "id"],
  table: ["class", "id"],
  td: ["class", "id", "colspan", "rowspan"],
  th: ["class", "id", "colspan", "rowspan"],
};

/**
 * Sanitize HTML content by removing dangerous tags and attributes.
 *
 * This is a basic implementation for trusted plugin templates.
 * It removes:
 * - Script tags and event handlers
 * - Potentially dangerous protocols (javascript:, data:, etc.)
 * - Unauthorized tags and attributes
 *
 * @param html - HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  // Create a temporary DOM element to parse HTML
  const template = document.createElement("template");
  template.innerHTML = html;

  // Recursively sanitize all nodes
  sanitizeNode(template.content);

  return template.innerHTML;
}

/**
 * Recursively sanitize a DOM node and its children
 */
function sanitizeNode(node: Node): void {
  // Process all child nodes
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      const tagName = element.tagName.toLowerCase();

      // Remove disallowed tags
      if (!ALLOWED_TAGS.includes(tagName)) {
        child.remove();
        continue;
      }

      // Sanitize attributes
      sanitizeAttributes(element);

      // Recursively sanitize children
      sanitizeNode(child);
    } else if (child.nodeType === Node.TEXT_NODE) {
      // Text nodes are safe, keep them
      continue;
    } else {
      // Remove other node types (comments, etc.)
      child.remove();
    }
  }
}

/**
 * Sanitize element attributes
 */
function sanitizeAttributes(element: Element): void {
  const tagName = element.tagName.toLowerCase();
  const allowedAttrs = ALLOWED_ATTRS[tagName] || [];

  // Get all attributes
  const attrs = Array.from(element.attributes);

  for (const attr of attrs) {
    const attrName = attr.name.toLowerCase();

    // Remove event handlers (onclick, onerror, etc.)
    if (attrName.startsWith("on")) {
      element.removeAttribute(attr.name);
      continue;
    }

    // Remove style attribute (can contain javascript:)
    if (attrName === "style") {
      element.removeAttribute(attr.name);
      continue;
    }

    // Check if attribute is allowed for this tag
    if (!allowedAttrs.includes(attrName)) {
      element.removeAttribute(attr.name);
      continue;
    }

    // Sanitize href and src attributes
    if (attrName === "href" || attrName === "src") {
      const value = attr.value.toLowerCase().trim();

      // Remove dangerous protocols
      if (
        value.startsWith("javascript:") ||
        value.startsWith("data:") ||
        value.startsWith("vbscript:") ||
        value.startsWith("file:")
      ) {
        element.removeAttribute(attr.name);
        continue;
      }
    }

    // Sanitize target attribute (prevent tabnabbing)
    if (attrName === "target" && attr.value === "_blank") {
      // Ensure rel="noopener noreferrer" is set
      if (!element.getAttribute("rel")?.includes("noopener")) {
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
  }
}

/**
 * Check if HTML string is safe (basic validation)
 *
 * @param html - HTML string to check
 * @returns true if HTML appears safe
 */
export function isHtmlSafe(html: string): boolean {
  if (!html || typeof html !== "string") {
    return true;
  }

  // Check for obvious script tags
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(html)) {
    return false;
  }

  // Check for event handlers
  if (/on\w+\s*=/gi.test(html)) {
    return false;
  }

  // Check for javascript: protocol
  if (/javascript:/gi.test(html)) {
    return false;
  }

  return true;
}
