/**
 * Channel-aware rendering (D13-12).
 *
 * The AI writes Markdown and the web chat shows product cards. Channels that
 * can't show either declare it in their package.json `hay-plugin.rendering`:
 *
 *   "rendering": { "markdown": "plain" | "whatsapp", "productRecommendations": "text" }
 *
 * - markdown "plain": Markdown is stripped (links become "text (url)").
 * - markdown "whatsapp": converted to WhatsApp's own *bold* / _italic_ / ~strike~.
 * - productRecommendations "text": product cards go out as a text list with links.
 *   Without it, product cards are not sent to the channel (the AI's reply is).
 *
 * Core never checks plugin ids: only the declaration.
 */

export interface ChannelRendering {
  markdown?: "markdown" | "plain" | "whatsapp";
  productRecommendations?: "text";
}

/** The product fields the text list reads (a `recommend_products` result item). */
export interface RecommendedProductLike {
  title?: unknown;
  sourceUrl?: unknown;
  available?: unknown;
  topVariant?: { price?: unknown; currency?: unknown } | null;
}

/** Most products listed in one message (the tool already caps its results). */
const MAX_LISTED_PRODUCTS = 10;

function formatPrice(price: unknown, currency: unknown, language: string | null): string | null {
  if (typeof price !== "string" && typeof price !== "number") return null;
  const amount = typeof price === "number" ? price : parseFloat(price);
  if (!Number.isFinite(amount)) return null;
  if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(language || "en", { style: "currency", currency }).format(
        amount,
      );
    } catch {
      return `${amount} ${currency}`;
    }
  }
  return String(price);
}

/**
 * Product cards as plain text, one product per block:
 *   • Blue running shoe · R$ 299,90
 *   https://store.example/products/blue-shoe
 * No translated words, so it reads the same in every language.
 */
export function renderProductList(
  products: RecommendedProductLike[],
  language: string | null,
): string {
  return products
    .filter((product) => typeof product.title === "string" && product.title.trim())
    .slice(0, MAX_LISTED_PRODUCTS)
    .map((product) => {
      const price = formatPrice(product.topVariant?.price, product.topVariant?.currency, language);
      const head = `• ${(product.title as string).trim()}${price ? ` · ${price}` : ""}`;
      const url = typeof product.sourceUrl === "string" ? product.sourceUrl.trim() : "";
      return /^https?:\/\//i.test(url) ? `${head}\n${url}` : head;
    })
    .join("\n\n");
}

/** "[text](url)" → "text (url)", or just the url when the text is the url. */
function inlineLinks(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, _alt: string, url: string) => url)
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) =>
      label.trim() === url ? url : `${label} (${url})`,
    );
}

/** Line-level Markdown: headings, quotes, rules and bullets. */
function stripBlocks(text: string, heading: (title: string) => string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) // horizontal rules
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, (_m, title: string) => heading(title))
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^(\s*)[-*+]\s+/, "$1• "),
    )
    .join("\n");
}

// `*x*` / `_x_` only at word edges, so snake_case and URLs are left alone.
const STAR_EMPHASIS = /(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/gm;
const UNDERSCORE_EMPHASIS = /(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s).,!?:;]|$)/gm;

/** Markdown → plain text. */
export function stripMarkdown(text: string): string {
  let out = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code: string) => code.trimEnd());
  out = inlineLinks(out);
  out = stripBlocks(out, (title) => title);
  out = out
    .replace(/\*\*(?!\s)([^*\n]+?)\*\*/g, "$1")
    .replace(/__(?!\s)([^_\n]+?)__/g, "$1")
    .replace(/~~(?!\s)([^~\n]+?)~~/g, "$1")
    .replace(STAR_EMPHASIS, "$1$2")
    .replace(UNDERSCORE_EMPHASIS, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
  return out;
}

/** Markdown → WhatsApp formatting (*bold*, _italic_, ~strike~; code is native). */
export function markdownToWhatsApp(text: string): string {
  const BOLD = "\u0000B\u0000";
  let out = inlineLinks(text);
  out = stripBlocks(out, (title) => `${BOLD}${title}${BOLD}`);
  out = out
    .replace(/\*\*(?!\s)([^*\n]+?)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/__(?!\s)([^_\n]+?)__/g, `${BOLD}$1${BOLD}`)
    .replace(/~~(?!\s)([^~\n]+?)~~/g, "~$1~")
    .replace(STAR_EMPHASIS, "$1_$2_");
  return out.split(BOLD).join("*");
}

/** Text as the channel can show it. */
export function renderForChannel(text: string, rendering: ChannelRendering | undefined): string {
  if (!text) return text;
  switch (rendering?.markdown) {
    case "plain":
      return stripMarkdown(text);
    case "whatsapp":
      return markdownToWhatsApp(text);
    default:
      return text;
  }
}
