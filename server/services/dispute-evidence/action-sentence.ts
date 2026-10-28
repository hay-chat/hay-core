/**
 * A store action (one tool call) as a plain sentence a bank reviewer can read
 * (D2-3): "Refund issued: 42.00 EUR. Reference: 998877." Generic: it reads the
 * tool's write category (from the plugin's own risk annotation), the call's
 * outcome and common field names in its input and output. Never a plugin id.
 */
import type { ActionOutcome } from "@server/database/entities/action-log.entity";
import { extractAmount } from "@server/services/core/action-policy";
import { formatZonedDateTime } from "@server/utils/zoned-datetime";
import { evidenceCopy, fillCopy, type EvidenceLocale } from "./copy";
import { asRecord, parseToolOutput, shortId, toolPhrase, type JsonRecord } from "./tool-output";

export interface ActionRecord {
  pluginId: string | null;
  toolName: string;
  /** Write category from the action log; null for reads or unknown. */
  category: string | null;
  /** True for reads; null when no action-log row says either way. */
  readOnly: boolean | null;
  outcome: ActionOutcome;
  errorCode: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: unknown;
}

export interface TrackingInfo {
  carrier: string | null;
  number: string | null;
  status: string | null;
  deliveredAt: string | null;
}

type NounKey = keyof ReturnType<typeof evidenceCopy>["noun"];
const NOUN_KEYS: readonly string[] = [
  "refund",
  "cancel",
  "return",
  "exchange",
  "discount",
  "address_change",
  "customer_update",
];

const TRACKING_NUMBER_KEYS = ["tracking_number", "trackingNumber", "number"];
const CARRIER_KEYS = ["company", "carrier", "tracking_company", "trackingCompany", "carrier_name"];
const DELIVERED_KEYS = ["deliveredAt", "delivered_at", "delivered_date", "deliveryDate"];
const STATUS_KEYS = ["displayStatus", "status", "shipment_status", "shipmentStatus"];
const CURRENCY_KEYS = ["currency", "currencyCode", "currency_code"];

function str(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstKey(record: JsonRecord | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Tracking found anywhere in a tool's output: an object with a tracking
 * number next to a carrier or URL. Delivery date and status come from the
 * same object or its parent (a fulfilment holding `trackingInfo`).
 */
export function findTracking(output: unknown, limit = 3): TrackingInfo[] {
  const found: TrackingInfo[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, parent: JsonRecord | null, key: string, depth: number) => {
    if (depth > 6 || found.length >= limit) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, parent, key, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const isTrackingObject = /track/i.test(key) || Boolean(firstKey(record, CARRIER_KEYS));
    const number = firstKey(record, TRACKING_NUMBER_KEYS);
    const looksLikeTracking =
      number &&
      isTrackingObject &&
      (firstKey(record, CARRIER_KEYS) || str(record.url) || str(record.tracking_url));
    if (looksLikeTracking && !seen.has(number)) {
      seen.add(number);
      found.push({
        carrier: firstKey(record, CARRIER_KEYS),
        number,
        status: firstKey(record, STATUS_KEYS) ?? firstKey(parent, STATUS_KEYS),
        deliveredAt: firstKey(record, DELIVERED_KEYS) ?? firstKey(parent, DELIVERED_KEYS),
      });
      return;
    }
    for (const [childKey, child] of Object.entries(record)) {
      walk(child, record, childKey, depth + 1);
    }
  };
  walk(output, null, "", 0);
  return found;
}

function currencyOf(input: JsonRecord | null, output: unknown): string | null {
  const fromInput = firstKey(input, CURRENCY_KEYS);
  if (fromInput) return fromInput;
  let found: string | null = null;
  const walk = (value: unknown, depth: number) => {
    if (found || depth > 4) return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
    const record = asRecord(value);
    if (!record) return;
    found = firstKey(record, CURRENCY_KEYS);
    if (!found) Object.values(record).forEach((child) => walk(child, depth + 1));
  };
  walk(output, 0);
  return found;
}

function formatAmount(amount: number, currency: string | null): string {
  const value = amount.toFixed(2);
  return currency ? `${value} ${currency.toUpperCase()}` : value;
}

function trackingSentence(
  tracking: TrackingInfo,
  locale: EvidenceLocale,
  timeZone: string,
): string {
  const copy = evidenceCopy(locale).action;
  const parts: string[] = [];
  if (tracking.carrier) parts.push(fillCopy(copy.trackingCarrier, { carrier: tracking.carrier }));
  if (tracking.number) parts.push(fillCopy(copy.trackingNumber, { number: tracking.number }));
  if (tracking.status) parts.push(fillCopy(copy.trackingStatus, { status: tracking.status }));
  if (tracking.deliveredAt) {
    const at = formatZonedDateTime(tracking.deliveredAt, timeZone) || tracking.deliveredAt;
    parts.push(fillCopy(copy.trackingDelivered, { at }));
  }
  return `${copy.tracking} ${parts.join(", ")}.`;
}

function failureReason(record: ActionRecord, locale: EvidenceLocale): string | null {
  const errors = evidenceCopy(locale).toolErrors;
  const output = asRecord(parseToolOutput(record.toolOutput));
  let details: unknown = output?.details;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  const reason = str(asRecord(details)?.reason);
  if (reason && errors.reasons[reason]) return errors.reasons[reason];
  const code = str(output?.code) ?? record.errorCode;
  return code && errors.codes[code] ? errors.codes[code] : null;
}

function successSentence(record: ActionRecord, locale: EvidenceLocale): string {
  const copy = evidenceCopy(locale).action;
  const output = parseToolOutput(record.toolOutput);
  const input = record.toolInput ?? {};
  const reference = shortId(asRecord(output)?.id);
  const withReference = (sentence: string) =>
    reference ? `${sentence} ${fillCopy(copy.reference, { id: reference })}` : sentence;
  switch (record.category) {
    case "refund": {
      const amount = extractAmount(input);
      const sentence =
        amount !== null
          ? fillCopy(copy.refundAmount, {
              amount: formatAmount(amount, currencyOf(input, output)),
            })
          : copy.refund;
      return withReference(sentence);
    }
    case "cancel":
      return copy.cancel;
    case "return":
      return withReference(copy.return);
    case "exchange":
      return withReference(copy.exchange);
    case "discount":
      return copy.discount;
    case "address_change":
      return copy.addressChange;
    case "customer_update":
      return copy.customerUpdate;
    default:
      return fillCopy(copy.other, { action: toolPhrase(record.pluginId, record.toolName) });
  }
}

function nounFor(record: ActionRecord, locale: EvidenceLocale): string {
  const copy = evidenceCopy(locale);
  if (record.category && NOUN_KEYS.includes(record.category)) {
    return copy.noun[record.category as NounKey];
  }
  return toolPhrase(record.pluginId, record.toolName);
}

/**
 * The sentences for one tool call, or [] when it does not belong in a
 * dispute record: simulated (dry-run) calls, confirmation asks, core tools,
 * and reads that found no tracking.
 */
export function describeAction(
  record: ActionRecord,
  locale: EvidenceLocale,
  timeZone: string,
): string[] {
  if (!record.pluginId) return [];
  if (record.outcome === "simulated" || record.outcome === "confirming") return [];
  const copy = evidenceCopy(locale).action;

  // A read, or any call whose answer carried tracking: report the tracking.
  const tracking =
    record.outcome === "success" ? findTracking(parseToolOutput(record.toolOutput)) : [];
  const isRead = record.readOnly === true || (record.readOnly === null && !record.category);
  if (isRead) return tracking.map((item) => trackingSentence(item, locale, timeZone));

  if (record.outcome === "held") {
    return [fillCopy(copy.held, { noun: nounFor(record, locale) })];
  }
  if (record.outcome === "error") {
    const noun = nounFor(record, locale);
    const reason = failureReason(record, locale);
    return [
      reason ? fillCopy(copy.failedWithReason, { noun, reason }) : fillCopy(copy.failed, { noun }),
    ];
  }
  return [successSentence(record, locale)];
}
