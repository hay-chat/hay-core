/**
 * Stripe disputes (D2-7): intake + evidence attached as a DRAFT.
 *
 * - Intake: `charge.dispute.*` webhooks on a per-org endpoint the plugin
 *   registers with the merchant's key, plus a sync of recent disputes on start
 *   and on a cron. A webhook body is only a hint: the dispute is re-read from
 *   Stripe with the merchant's key, so a forged call can at most trigger a read.
 * - Evidence: upload the pack PDF (purpose `dispute_evidence`), put it in
 *   `customer_communication` (or `uncategorized_file`) and add a note to
 *   `uncategorized_text`, with `submit=false`. Never submits: the merchant
 *   reviews and submits on Stripe. Files the merchant added are never replaced.
 */
import type {
  CanonicalDispute,
  DisputeEvidenceRequest,
  DisputeEvidenceResponse,
  DisputeStatusName,
} from "@hay/plugin-sdk";

const API = "https://api.stripe.com";
const FILES_API = "https://files.stripe.com";

export const DISPUTE_EVENTS = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
];

/** Disputes opened within this window are reported on sync (older history is left out). */
const SYNC_WINDOW_DAYS = 120;

/** Stripe's limit for `evidence[uncategorized_text]`. */
const UNCATEGORIZED_TEXT_MAX = 20_000;

/** Currencies Stripe amounts carry without minor units. */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const EDITABLE = new Set(["needs_response", "warning_needs_response"]);

const ORDER_ID_KEYS = ["order_id", "orderId", "order", "woocommerce_order_id", "shopify_order_id"];
const ORDER_NUMBER_KEYS = ["order_number", "orderNumber", "order_name", "orderName"];

type Json = Record<string, any>;
type FetchImpl = typeof fetch;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface StripeClient {
  request(method: "GET" | "POST", path: string, params?: Array<[string, string]>): Promise<Json>;
  uploadFile(file: { name: string; mimeType: string; base64: string }): Promise<Json>;
}

export function createStripeClient(apiKey: string, fetchImpl: FetchImpl = fetch): StripeClient {
  const headers = { Authorization: `Bearer ${apiKey}` };
  async function parse(response: Response): Promise<Json> {
    const json = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      throw new StripeApiError(response.status, json?.error?.message ?? `HTTP ${response.status}`);
    }
    return json;
  }
  return {
    async request(method, path, params = []) {
      const body = new URLSearchParams(params).toString();
      const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
      const response = await fetchImpl(url, {
        method,
        headers:
          method === "POST"
            ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" }
            : headers,
        body: method === "POST" ? body : undefined,
      });
      return parse(response);
    },
    async uploadFile(file) {
      const form = new FormData();
      form.append("purpose", "dispute_evidence");
      form.append(
        "file",
        new Blob([Buffer.from(file.base64, "base64")], { type: file.mimeType }),
        file.name,
      );
      const response = await fetchImpl(`${FILES_API}/v1/files`, {
        method: "POST",
        headers,
        body: form,
      });
      return parse(response);
    },
  };
}

function normalizeStatus(status: string): DisputeStatusName {
  if (status === "needs_response" || status === "warning_needs_response") return "needs_response";
  if (status === "under_review" || status === "warning_under_review") return "under_review";
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  return "closed";
}

function majorUnits(amount: unknown, currency: string | undefined): string | undefined {
  if (typeof amount !== "number") return undefined;
  if (currency && ZERO_DECIMAL.has(currency.toLowerCase())) return String(amount);
  return (amount / 100).toFixed(2);
}

const iso = (unix: unknown) =>
  typeof unix === "number" && unix > 0 ? new Date(unix * 1000).toISOString() : undefined;

const str = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

/** Order references the merchant's checkout left on the charge or payment intent. */
export function orderRefsFrom(dispute: Json): { refs: string[]; label?: string } {
  const sources: Json[] = [dispute.charge, dispute.payment_intent].filter(
    (s): s is Json => Boolean(s) && typeof s === "object",
  );
  const refs: string[] = [];
  let label: string | undefined;
  for (const source of sources) {
    const metadata: Json = source.metadata ?? {};
    for (const key of ORDER_ID_KEYS) if (str(metadata[key])) refs.push(str(metadata[key]));
    for (const key of ORDER_NUMBER_KEYS) {
      const value = str(metadata[key]);
      if (value) {
        refs.push(value);
        label ??= value.startsWith("#") ? value : `#${value}`;
      }
    }
  }
  for (const source of sources) {
    const match = /order\s*(?:no\.?|number)?\s*#?\s*([A-Za-z0-9-]{2,40})/i.exec(
      str(source.description),
    );
    if (match) refs.push(match[1]);
  }
  return { refs: [...new Set(refs)].slice(0, 10), label };
}

export function dashboardUrl(dispute: Json): string {
  return `https://dashboard.stripe.com/${dispute.livemode ? "" : "test/"}disputes/${dispute.id}`;
}

export function toCanonical(dispute: Json): CanonicalDispute {
  const { refs, label } = orderRefsFrom(dispute);
  const currency = typeof dispute.currency === "string" ? dispute.currency : undefined;
  return {
    externalId: dispute.id,
    status: normalizeStatus(String(dispute.status)),
    amount: majorUnits(dispute.amount, currency),
    currency: currency?.toUpperCase(),
    reason: typeof dispute.reason === "string" ? dispute.reason : undefined,
    evidenceDueBy: iso(dispute.evidence_details?.due_by),
    initiatedAt: iso(dispute.created),
    orderRefs: refs.length ? refs : undefined,
    orderLabel: label,
    providerUrl: dashboardUrl(dispute),
  };
}

const EXPAND: Array<[string, string]> = [
  ["expand[]", "charge"],
  ["expand[]", "payment_intent"],
];

export async function fetchDispute(client: StripeClient, id: string): Promise<Json> {
  return client.request("GET", `/v1/disputes/${encodeURIComponent(id)}`, EXPAND);
}

/** Report disputes opened in the sync window (newest first, one page). */
export async function syncRecentDisputes(
  client: StripeClient,
  report: (d: CanonicalDispute) => Promise<unknown>,
  now: Date = new Date(),
): Promise<number> {
  const since = Math.floor(now.getTime() / 1000) - SYNC_WINDOW_DAYS * 86_400;
  const page = await client.request("GET", "/v1/disputes", [
    ["limit", "100"],
    ["created[gte]", String(since)],
    ["expand[]", "data.charge"],
    ["expand[]", "data.payment_intent"],
  ]);
  let count = 0;
  for (const dispute of (page.data as Json[]) ?? []) {
    await report(toCanonical(dispute));
    count += 1;
  }
  return count;
}

/** Create (or widen) the per-org endpoint for dispute events. Idempotent. */
export async function ensureWebhookEndpoint(
  client: StripeClient,
  url: string,
  orgId: string,
): Promise<"created" | "updated" | "exists"> {
  const list = await client.request("GET", "/v1/webhook_endpoints", [["limit", "100"]]);
  const existing = ((list.data as Json[]) ?? []).find((endpoint) => endpoint.url === url);
  if (existing) {
    const events: string[] = existing.enabled_events ?? [];
    const missing = DISPUTE_EVENTS.filter((e) => !events.includes(e) && !events.includes("*"));
    if (missing.length === 0 && existing.status !== "disabled") return "exists";
    await client.request("POST", `/v1/webhook_endpoints/${existing.id}`, [
      ...[...new Set([...events, ...DISPUTE_EVENTS])].map((e): [string, string] => [
        "enabled_events[]",
        e,
      ]),
      ["disabled", "false"],
    ]);
    return "updated";
  }
  await client.request("POST", "/v1/webhook_endpoints", [
    ["url", url],
    ...DISPUTE_EVENTS.map((e): [string, string] => ["enabled_events[]", e]),
    ["description", "Hay.chat: chargeback alerts and evidence drafts"],
    ["metadata[hay_organization_id]", orgId],
  ]);
  return "created";
}

/**
 * The webhook URL core proxies to this org's worker, or null when the API is
 * not publicly reachable over https (local development): Stripe only delivers
 * to public https URLs.
 */
export function webhookUrl(
  apiUrl: string | undefined,
  pluginId: string,
  orgId: string,
): string | null {
  if (!apiUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || /^(localhost|127\.|0\.0\.0\.0)/.test(parsed.hostname)) {
    return null;
  }
  const base = apiUrl.replace(/\/$/, "");
  return `${base}/v1/plugins/${encodeURIComponent(pluginId)}/webhook?organizationId=${encodeURIComponent(orgId)}`;
}

/** Dispute id from a Stripe event body, when it is a dispute event. */
export function disputeIdFromEvent(body: unknown): string | null {
  const event = body as Json;
  if (typeof event?.type !== "string" || !event.type.startsWith("charge.dispute.")) return null;
  const id = event?.data?.object?.id;
  return typeof id === "string" && /^(dp|du)_[A-Za-z0-9]+$/.test(id) ? id : null;
}

/** Replace our earlier note (from the marker to the next blank line), else append. */
export function mergeNote(
  existing: string | null | undefined,
  note: string,
  marker: string,
): string {
  const current = existing ?? "";
  const start = current.indexOf(marker);
  if (start === -1) return current.trim() ? `${current.trimEnd()}\n\n${note}` : note;
  const end = current.indexOf("\n\n", start);
  return `${current.slice(0, start)}${note}${end === -1 ? "" : current.slice(end)}`;
}

function errorResponse(error: unknown): DisputeEvidenceResponse {
  if (error instanceof StripeApiError) {
    if (error.status === 404) return { ok: false, code: "NOT_FOUND", message: error.message };
    if (error.status === 401) return { ok: false, code: "NOT_CONNECTED", message: error.message };
    if (error.status === 403) return { ok: false, code: "SCOPE_MISSING", message: error.message };
    return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  }
  return {
    ok: false,
    code: "PROVIDER_ERROR",
    message: (error as Error)?.message ?? "Unknown error",
  };
}

/** Attach the pack as a draft (`submit=false`). Never submits, never replaces merchant files. */
export async function attachEvidence(
  client: StripeClient,
  request: DisputeEvidenceRequest,
  filePrefix: string,
): Promise<DisputeEvidenceResponse> {
  try {
    const dispute = await fetchDispute(client, request.disputeId);
    if (!EDITABLE.has(dispute.status) || dispute.evidence_details?.past_due) {
      return { ok: false, code: "NOT_EDITABLE", message: `Dispute status is ${dispute.status}` };
    }

    const evidence: Json = dispute.evidence ?? {};
    const slot = await pickSlot(client, evidence, filePrefix);
    if (!slot) {
      return {
        ok: false,
        code: "SLOT_TAKEN",
        message: "customer_communication and uncategorized_file already hold the merchant's files",
      };
    }

    const file = await client.uploadFile(request.file);
    const params: Array<[string, string]> = [
      [`evidence[${slot}]`, file.id],
      ["submit", "false"],
    ];
    const text = mergeNote(evidence.uncategorized_text, request.text, request.marker);
    if (text.length <= UNCATEGORIZED_TEXT_MAX) params.push(["evidence[uncategorized_text]", text]);
    await client.request("POST", `/v1/disputes/${encodeURIComponent(dispute.id)}`, params);
    return { ok: true, providerUrl: dashboardUrl(dispute) };
  } catch (error) {
    return errorResponse(error);
  }
}

async function pickSlot(
  client: StripeClient,
  evidence: Json,
  filePrefix: string,
): Promise<"customer_communication" | "uncategorized_file" | null> {
  for (const slot of ["customer_communication", "uncategorized_file"] as const) {
    const current = evidence[slot];
    if (!current) return slot;
    const fileId = typeof current === "string" ? current : current.id;
    const file =
      typeof current === "object" && current.filename
        ? current
        : await client.request("GET", `/v1/files/${encodeURIComponent(fileId)}`);
    if (typeof file.filename === "string" && file.filename.startsWith(filePrefix)) return slot;
  }
  return null;
}
