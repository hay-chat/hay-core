/**
 * Shopify Payments disputes (D2-8): intake + evidence attached, never submitted.
 *
 * See DISPUTES.md (D2-1 spike). In short:
 * - Intake: per-shop `DISPUTES_CREATE` / `DISPUTES_UPDATE` webhook
 *   subscriptions pointing at this org's worker, plus a sync of recent
 *   disputes on start. A webhook body is only a hint: the dispute is re-read
 *   with the shop's own token, so a forged call can at most trigger a read.
 * - Evidence: REST dispute file upload into `customer_communication_file` (or
 *   `uncategorized_file`), then `disputeEvidenceUpdate` with the file and a note
 *   in `uncategorizedText`. `submitEvidence` is deprecated and has no effect;
 *   Hay.chat never sends it. Files the merchant added are never replaced.
 */
import type {
  CanonicalDispute,
  DisputeEvidenceRequest,
  DisputeEvidenceResponse,
  DisputeStatusName,
} from "@hay/plugin-sdk";

type Json = Record<string, any>;
type FetchImpl = typeof fetch;

const SYNC_WINDOW_DAYS = 120;
const WEBHOOK_TOPICS = ["DISPUTES_CREATE", "DISPUTES_UPDATE"] as const;

const DISPUTE_FIELDS = `
  id
  legacyResourceId
  status
  type
  initiatedAt
  evidenceDueBy
  evidenceSentOn
  amount { amount currencyCode }
  reasonDetails { reason networkReasonCode }
  order { id name legacyResourceId }
`;

// Intake reads only the dispute: `disputeEvidence` needs the protected evidence scopes,
// which Shopify only grants to dispute-management apps, and asking for it would fail
// the whole query.
export const DISPUTE_SHOW = `query DisputeShow($id: ID!) {
  dispute(id: $id) { ${DISPUTE_FIELDS} }
}`;

export const DISPUTE_EVIDENCE_SHOW = `query DisputeEvidenceShow($id: ID!) {
  dispute(id: $id) {
    ${DISPUTE_FIELDS}
    disputeEvidence {
      id
      uncategorizedText
      customerCommunicationFile { id originalFileName }
      uncategorizedFile { id originalFileName }
    }
  }
}`;

export const DISPUTE_LIST = `query DisputeList($first: Int!, $query: String) {
  disputes(first: $first, query: $query, reverse: true) {
    nodes { ${DISPUTE_FIELDS} }
  }
}`;

export const DISPUTE_WEBHOOKS = `query DisputeWebhooks {
  webhookSubscriptions(first: 50, topics: [DISPUTES_CREATE, DISPUTES_UPDATE]) {
    nodes { id topic uri }
  }
}`;

export const DISPUTE_WEBHOOK_CREATE = `mutation DisputeWebhookCreate($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

export const DISPUTE_EVIDENCE_ATTACH = `mutation DisputeEvidenceAttach($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
  disputeEvidenceUpdate(id: $id, input: $input) {
    disputeEvidence { id }
    userErrors { field message }
  }
}`;

export class ShopifyApiError extends Error {
  constructor(
    readonly kind: "ACCESS_DENIED" | "NOT_FOUND" | "UNAUTHORIZED" | "OTHER",
    message: string,
  ) {
    super(message);
  }
}

export interface ShopifyClient {
  shop: string;
  graphql<T = Json>(query: string, variables?: Record<string, unknown>): Promise<T>;
  rest(method: "POST", path: string, body: unknown): Promise<Json>;
}

function kindForStatus(status: number): ShopifyApiError["kind"] {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  return "OTHER";
}

export function createShopifyClient(
  shop: string,
  accessToken: string,
  apiVersion: string,
  fetchImpl: FetchImpl = fetch,
): ShopifyClient {
  const base = `https://${shop}/admin/api/${apiVersion}`;
  const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" };
  return {
    shop,
    async graphql(query, variables = {}) {
      const res = await fetchImpl(`${base}/graphql.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new ShopifyApiError(kindForStatus(res.status), `HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: any;
        errors?: Array<{ message: string; extensions?: { code?: string } }>;
      };
      if (json.errors?.length) {
        const denied = json.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
        throw new ShopifyApiError(
          denied ? "ACCESS_DENIED" : "OTHER",
          json.errors.map((e) => e.message).join("; "),
        );
      }
      return json.data;
    },
    async rest(method, path, body) {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Json;
      if (!res.ok) {
        const message =
          typeof json.errors === "string" ? json.errors : JSON.stringify(json.errors ?? {});
        throw new ShopifyApiError(kindForStatus(res.status), `HTTP ${res.status}: ${message}`);
      }
      return json;
    },
  };
}

export const disputeGid = (id: string | number) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/ShopifyPaymentsDispute/${id}`;

function normalizeStatus(status: string): DisputeStatusName {
  switch (status) {
    case "NEEDS_RESPONSE":
      return "needs_response";
    case "UNDER_REVIEW":
      return "under_review";
    case "WON":
      return "won";
    case "LOST":
      return "lost";
    default:
      return "closed"; // ACCEPTED, PREVENTED, CHARGE_REFUNDED
  }
}

/** Where the merchant reviews and submits: the order page shows the dispute. */
export function adminUrl(shop: string, dispute: Json): string {
  const orderId = dispute.order?.legacyResourceId;
  return orderId
    ? `https://${shop}/admin/orders/${orderId}`
    : `https://${shop}/admin/payments/payouts`;
}

export function toCanonical(shop: string, dispute: Json): CanonicalDispute {
  const order = dispute.order ?? null;
  const name: string | undefined = typeof order?.name === "string" ? order.name : undefined;
  const refs = [order?.legacyResourceId, name?.replace(/^#/, "")]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(String);
  return {
    externalId: dispute.id,
    status: normalizeStatus(String(dispute.status)),
    amount: dispute.amount?.amount !== undefined ? String(dispute.amount.amount) : undefined,
    currency: dispute.amount?.currencyCode ?? undefined,
    reason: dispute.reasonDetails?.reason
      ? String(dispute.reasonDetails.reason).toLowerCase()
      : undefined,
    evidenceDueBy: dispute.evidenceDueBy ?? undefined,
    initiatedAt: dispute.initiatedAt ?? undefined,
    orderRefs: refs.length ? [...new Set(refs)] : undefined,
    orderLabel: name,
    providerUrl: adminUrl(shop, dispute),
  };
}

/** Same rule as the Stripe plugin: only a public https API can receive Shopify webhooks. */
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
  return `${apiUrl.replace(/\/$/, "")}/v1/plugins/${encodeURIComponent(pluginId)}/webhook?organizationId=${encodeURIComponent(orgId)}`;
}

/** Dispute gid from a `disputes/create` / `disputes/update` webhook body. */
export function disputeIdFromWebhook(body: unknown): string | null {
  const id = (body as Json)?.id;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return disputeGid(id);
  if (typeof id === "string" && /^\d{1,20}$/.test(id)) return disputeGid(id);
  return null;
}

export async function fetchDispute(client: ShopifyClient, id: string): Promise<Json | null> {
  const data = await client.graphql<{ dispute: Json | null }>(DISPUTE_SHOW, { id: disputeGid(id) });
  return data.dispute;
}

async function fetchDisputeWithEvidence(client: ShopifyClient, id: string): Promise<Json | null> {
  const data = await client.graphql<{ dispute: Json | null }>(DISPUTE_EVIDENCE_SHOW, {
    id: disputeGid(id),
  });
  return data.dispute;
}

export async function syncRecentDisputes(
  client: ShopifyClient,
  report: (d: CanonicalDispute) => Promise<unknown>,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const data = await client.graphql<{ disputes: { nodes: Json[] } }>(DISPUTE_LIST, {
    first: 50,
    query: `initiated_at:>=${since}`,
  });
  let count = 0;
  for (const node of data.disputes?.nodes ?? []) {
    await report(toCanonical(client.shop, node));
    count += 1;
  }
  return count;
}

/** Subscribe this shop's dispute topics to the org's webhook URL. Idempotent. */
export async function ensureWebhooks(client: ShopifyClient, url: string): Promise<number> {
  const data = await client.graphql<{ webhookSubscriptions: { nodes: Json[] } }>(DISPUTE_WEBHOOKS);
  const existing = data.webhookSubscriptions?.nodes ?? [];
  let created = 0;
  for (const topic of WEBHOOK_TOPICS) {
    if (existing.some((s) => s.topic === topic && s.uri === url)) continue;
    const result = await client.graphql<{ webhookSubscriptionCreate: { userErrors: Json[] } }>(
      DISPUTE_WEBHOOK_CREATE,
      { topic, uri: url },
    );
    const errors = result.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length) throw new ShopifyApiError("OTHER", errors.map((e) => e.message).join("; "));
    created += 1;
  }
  return created;
}

/** Replace our earlier note (marker to next blank line), else append. */
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

type Slot = {
  documentType: "customer_communication_file" | "uncategorized_file";
  field: "customerCommunicationFile" | "uncategorizedFile";
};

const SLOTS: Slot[] = [
  { documentType: "customer_communication_file", field: "customerCommunicationFile" },
  { documentType: "uncategorized_file", field: "uncategorizedFile" },
];

function pickSlot(evidence: Json, filePrefix: string): Slot | null {
  for (const slot of SLOTS) {
    const file = evidence[slot.field];
    if (!file) return slot;
    if (typeof file.originalFileName === "string" && file.originalFileName.startsWith(filePrefix)) {
      return slot;
    }
  }
  return null;
}

function errorResponse(error: unknown): DisputeEvidenceResponse {
  if (error instanceof ShopifyApiError) {
    if (error.kind === "ACCESS_DENIED") {
      return {
        ok: false,
        code: "SCOPE_MISSING",
        message: "The store needs to re-approve Hay.chat to edit dispute evidence",
      };
    }
    if (error.kind === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: error.message };
    if (error.kind === "UNAUTHORIZED")
      return { ok: false, code: "NOT_CONNECTED", message: error.message };
    return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  }
  return {
    ok: false,
    code: "PROVIDER_ERROR",
    message: (error as Error)?.message ?? "Unknown error",
  };
}

/** Attach the pack to the dispute's evidence. Never submits (Shopify ignores it anyway). */
export async function attachEvidence(
  client: ShopifyClient,
  request: DisputeEvidenceRequest,
  filePrefix: string,
): Promise<DisputeEvidenceResponse> {
  try {
    const dispute = await fetchDisputeWithEvidence(client, request.disputeId);
    if (!dispute) return { ok: false, code: "NOT_FOUND", message: "Dispute not found" };
    const pastDue = dispute.evidenceDueBy && new Date(dispute.evidenceDueBy).getTime() < Date.now();
    if (dispute.status !== "NEEDS_RESPONSE" || dispute.evidenceSentOn || pastDue) {
      return { ok: false, code: "NOT_EDITABLE", message: `Dispute status is ${dispute.status}` };
    }
    const evidence: Json | null = dispute.disputeEvidence ?? null;
    if (!evidence?.id)
      return { ok: false, code: "NOT_EDITABLE", message: "Dispute has no evidence record" };

    const slot = pickSlot(evidence, filePrefix);
    if (!slot) {
      return {
        ok: false,
        code: "SLOT_TAKEN",
        message: "Customer communication and uncategorized file already hold the merchant's files",
      };
    }

    const upload = await client.rest(
      "POST",
      `/shopify_payments/disputes/${dispute.legacyResourceId}/dispute_file_uploads.json`,
      {
        dispute_file_upload: {
          document_type: slot.documentType,
          filename: request.file.name,
          mimetype: request.file.mimeType,
          data: request.file.base64,
        },
      },
    );
    const uploadId = upload.dispute_file_upload?.id;
    if (!uploadId)
      return { ok: false, code: "PROVIDER_ERROR", message: "Shopify returned no file id" };

    const result = await client.graphql<{ disputeEvidenceUpdate: { userErrors: Json[] } }>(
      DISPUTE_EVIDENCE_ATTACH,
      {
        id: evidence.id,
        input: {
          [slot.field]: { id: `gid://shopify/ShopifyPaymentsDisputeFileUpload/${uploadId}` },
          uncategorizedText: mergeNote(evidence.uncategorizedText, request.text, request.marker),
        },
      },
    );
    const errors = result.disputeEvidenceUpdate?.userErrors ?? [];
    if (errors.length) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: errors.map((e) => e.message).join("; "),
      };
    }
    return { ok: true, providerUrl: adminUrl(client.shop, dispute) };
  } catch (error) {
    return errorResponse(error);
  }
}
