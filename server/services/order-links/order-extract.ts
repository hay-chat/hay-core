/**
 * Finds the orders a tool call or a message is about (D2-4). Generic: reads
 * common field names (order_id, order_number, increment_id, an `order` object,
 * an order tool's own id/name/number), never a plugin id. Conservative: a tool
 * answer naming more than MAX_OUTPUT_ORDERS orders (a list) links none of them,
 * and message text only counts "#1234" or "order/pedido/encomenda 1234".
 */
import type { OrderLinkSource } from "@server/database/entities/order-conversation-link.entity";
import { asRecord, parseToolOutput, type JsonRecord } from "../dispute-evidence/tool-output";

export interface OrderRef {
  /** Platform order id when known, else the order number. */
  key: string;
  /** Human order number, when known. */
  label: string | null;
  source: OrderLinkSource;
}

const MAX_OUTPUT_ORDERS = 3;
const MAX_TEXT_ORDERS = 3;

const ORDER_ID_KEYS = ["order_id", "orderId", "order_gid", "orderGid"];
const ORDER_LABEL_KEYS = [
  "order_number",
  "orderNumber",
  "order_name",
  "orderName",
  "increment_id",
  "incrementId",
];
const OWN_ID_KEYS = ["id", "entity_id", "order_id", "orderId"];
const OWN_LABEL_KEYS = ["order_number", "orderNumber", "number", "increment_id", "incrementId"];

/**
 * "#1001" -> "1001", "gid://shopify/Order/55" -> "55", " AB-77 " -> "ab-77".
 * Null unless it looks like an order reference (has a digit, 1-64 safe chars).
 */
export function normalizeOrderToken(value: unknown): string | null {
  let raw: string;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) raw = String(value);
  else if (typeof value === "string") raw = value.trim();
  else return null;
  raw = (raw.split("/").pop() ?? raw).split("?")[0].replace(/^#\s*/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw) || !/\d/.test(raw)) return null;
  return raw;
}

function first(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeOrderToken(record[key]);
    if (value) return value;
  }
  return null;
}

function isOrderTool(toolName: string): boolean {
  return /order/i.test(toolName);
}

/** An order object's own id and number. */
function ownRef(record: JsonRecord, source: OrderLinkSource): OrderRef | null {
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const label =
    first(record, OWN_LABEL_KEYS) ?? (name.startsWith("#") ? normalizeOrderToken(name) : null);
  const key = first(record, OWN_ID_KEYS) ?? label;
  return key ? { key, label, source } : null;
}

/** Looks like an order: an id plus an order number, or an Order gid. */
function looksLikeOrder(record: JsonRecord): boolean {
  const hasLabel =
    Boolean(first(record, OWN_LABEL_KEYS)) ||
    (typeof record.name === "string" && record.name.trim().startsWith("#"));
  const gid = typeof record.id === "string" && /\/Order\/[^/]+$/.test(record.id);
  return hasLabel || gid;
}

function dedupe(refs: OrderRef[]): OrderRef[] {
  const seen = new Map<string, OrderRef>();
  for (const ref of refs) {
    const id = `${ref.key}|${ref.label ?? ""}`;
    if (!seen.has(id)) seen.set(id, ref);
  }
  // A bare key that another ref already carries as id or label adds nothing.
  const all = [...seen.values()];
  return all.filter(
    (ref) =>
      ref.label !== null ||
      !all.some((other) => other !== ref && (other.key === ref.key || other.label === ref.key)),
  );
}

export function ordersFromToolInput(toolName: string, input: unknown): OrderRef[] {
  const record = asRecord(input);
  if (!record) return [];
  const id = first(record, ORDER_ID_KEYS);
  const label = first(record, ORDER_LABEL_KEYS);
  if (id || label) return [{ key: (id ?? label)!, label, source: "tool_input" }];
  if (!isOrderTool(toolName)) return [];
  // An order tool's own arguments: get_order({ id }), get_order_by_name({ name: "#1001" }).
  const ref = ownRef(record, "tool_input");
  return ref ? [ref] : [];
}

export function ordersFromToolOutput(toolName: string, output: unknown): OrderRef[] {
  const parsed = parseToolOutput(output);
  const refs: OrderRef[] = [];
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const underOrderKey = /^orders?$/i.test(key);
    const isRootOrder = depth === 0 && isOrderTool(toolName) && looksLikeOrder(record);
    if (underOrderKey || isRootOrder) {
      const ref = ownRef(record, "tool_output");
      if (ref) refs.push(ref);
    } else {
      const id = first(record, ORDER_ID_KEYS);
      const label = first(record, ORDER_LABEL_KEYS);
      if (id || label) refs.push({ key: (id ?? label)!, label, source: "tool_output" });
    }
    for (const [childKey, child] of Object.entries(record)) {
      if (child && typeof child === "object") walk(child, childKey, depth + 1);
    }
  };
  walk(parsed, "", 0);
  const unique = dedupe(refs);
  return unique.length > MAX_OUTPUT_ORDERS ? [] : unique;
}

const TEXT_PATTERNS = [
  /(?:^|[^\w#&])#\s?(\d{3,12})\b/g,
  /\b(?:order|pedido|encomenda)\s*(?:n(?:o|º|°|r|úmero|umero)?\.?\s*|number\s*|#\s*)?(\d{3,12})\b/gi,
];

export function ordersFromText(text: string | null | undefined): OrderRef[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const pattern of TEXT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[1]);
      if (found.size >= MAX_TEXT_ORDERS) break;
    }
  }
  return [...found]
    .slice(0, MAX_TEXT_ORDERS)
    .map((digits) => ({ key: digits, label: digits, source: "message_text" as const }));
}
