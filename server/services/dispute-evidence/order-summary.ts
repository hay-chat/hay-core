/**
 * The order shown on the evidence pack cover (D2-5): number, total and date
 * from the latest plugin tool answer that described this order. Generic field
 * names only; whatever is missing is left off the cover.
 */
import { asRecord, parseToolOutput, type JsonRecord } from "./tool-output";
import { normalizeOrderToken } from "../order-links/order-extract";

export interface OrderSummary {
  total: string | null;
  placedAt: string | null;
}

const ID_KEYS = ["id", "entity_id", "order_id", "orderId"];
const LABEL_KEYS = ["name", "number", "order_number", "orderNumber", "increment_id", "incrementId"];
const DATE_KEYS = ["createdAt", "created_at", "date_created", "dateCreated", "processedAt"];

function money(record: JsonRecord): string | null {
  // { totalPriceSet: { shopMoney: { amount, currencyCode } } } and similar.
  const set = asRecord(record.totalPriceSet) ?? asRecord(record.currentTotalPriceSet);
  const shop = asRecord(set?.shopMoney);
  if (shop && shop.amount !== undefined) {
    return `${shop.amount}${shop.currencyCode ? ` ${shop.currencyCode}` : ""}`;
  }
  for (const key of ["total", "grand_total", "total_price", "totalPrice", "total_amount"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const currency = record.currency ?? record.currency_code ?? record.order_currency_code;
      return `${value}${typeof currency === "string" ? ` ${currency}` : ""}`;
    }
  }
  return null;
}

function matches(record: JsonRecord, tokens: Set<string>): boolean {
  return [...ID_KEYS, ...LABEL_KEYS].some((key) => {
    const token = normalizeOrderToken(record[key]);
    return token !== null && tokens.has(token);
  });
}

/** Searches one tool answer for the order (root, `order`, or an `orders` item). */
export function orderSummaryFrom(output: unknown, tokens: Set<string>): OrderSummary | null {
  const parsed = parseToolOutput(output);
  const candidates: unknown[] = [parsed];
  const root = asRecord(parsed);
  if (root?.order) candidates.push(root.order);
  if (Array.isArray(root?.orders)) candidates.push(...root.orders);
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record || !matches(record, tokens)) continue;
    const total = money(record);
    const date = DATE_KEYS.map((key) => record[key]).find((value) => typeof value === "string");
    if (!total && !date) continue;
    return { total, placedAt: (date as string | undefined) ?? null };
  }
  return null;
}
