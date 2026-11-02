/**
 * Shopify's mandatory compliance webhooks (customers/data_request,
 * customers/redact, shop/redact).
 *
 * The app's compliance URI is core's shared `/v1/plugins/<id>/webhook`. Core
 * verifies `x-shopify-hmac-sha256` (base64 HMAC-SHA256 of the raw body with the
 * app secret), routes the body to the org whose connection registered the
 * payload's `shop_domain` as a routing key, and forwards it here with
 * `x-hay-webhook-verified: true`. The topic is in `x-shopify-topic`.
 *
 * What Hay.chat does with each:
 * - customers/redact: core erases every Hay.chat customer of this org matching
 *   the shopper's email or phone (conversations, messages, media) as a
 *   background job. Shopify customer records are never copied; the agent reads
 *   them live through the Admin API.
 * - customers/data_request: core queues the data export a verified
 *   self-service request produces and emails its download link to the address
 *   on the matching Hay.chat customer record.
 * - shop/redact: disconnect the shop (core clears the token and routing keys
 *   and stops the worker).
 *
 * @see https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */

export const COMPLIANCE_TOPICS = [
  "customers/data_request",
  "customers/redact",
  "shop/redact",
] as const;
export type ComplianceTopic = (typeof COMPLIANCE_TOPICS)[number];

type Headers = Record<string, string | string[] | undefined>;

/** The compliance topic of a request, or null for any other webhook. */
export function complianceTopic(headers: Headers): ComplianceTopic | null {
  const raw = headers["x-shopify-topic"];
  const topic = Array.isArray(raw) ? raw[0] : raw;
  return (COMPLIANCE_TOPICS as readonly string[]).includes(topic ?? "")
    ? (topic as ComplianceTopic)
    : null;
}

export interface PrivacySubject {
  emails: string[];
  phones: string[];
  reference?: string;
}

export interface ComplianceDeps {
  /** This org's shop domain, when known (a body for another shop is ignored). */
  shopDomain: () => string | undefined;
  /** Ask core to disconnect this org's shop. */
  revokeConnection: (reason: string) => Promise<void>;
  /** Ask core to erase or export the matching customers (core's privacy.* plugin-api). */
  requestPrivacy: (
    action: "erase" | "export",
    subject: PrivacySubject,
  ) => Promise<{ matched: number; undeliverable?: number }>;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

interface ComplianceRequest {
  headers: Headers;
  body: unknown;
}

interface ComplianceResponse {
  status(code: number): { json(body: unknown): void };
}

/** Handle a compliance webhook. 2xx once handled; 5xx makes Shopify retry. */
export async function handleComplianceWebhook(
  topic: ComplianceTopic,
  req: ComplianceRequest,
  res: ComplianceResponse,
  deps: ComplianceDeps,
): Promise<void> {
  if (req.headers["x-hay-webhook-verified"] !== "true") {
    res.status(401).json({ error: "unverified" });
    return;
  }

  const payload = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
    string,
    unknown
  >;
  const shop = typeof payload.shop_domain === "string" ? payload.shop_domain : undefined;
  const ownShop = deps.shopDomain();
  if (!shop || (ownShop && ownShop !== shop)) {
    deps.logger.warn("Shopify compliance webhook for another shop; ignored", { topic, shop });
    res.status(200).json({ received: true, handled: false });
    return;
  }

  if (topic === "shop/redact") {
    try {
      await deps.revokeConnection("shopify shop/redact");
      deps.logger.info("Shopify shop/redact: shop disconnected", { shop });
      res.status(200).json({ received: true, handled: true });
    } catch (error) {
      deps.logger.error("Shopify shop/redact: disconnect failed", {
        shop,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "disconnect failed" });
    }
    return;
  }

  // Ids only: the body also carries the shopper's email and phone.
  const customer = (payload.customer ?? {}) as Record<string, unknown>;
  const dataRequest = payload.data_request as Record<string, unknown> | undefined;
  const meta = { topic, shop, customerId: customer.id, dataRequestId: dataRequest?.id };
  const subject: PrivacySubject = {
    emails: typeof customer.email === "string" && customer.email ? [customer.email] : [],
    phones: typeof customer.phone === "string" && customer.phone ? [customer.phone] : [],
    reference:
      dataRequest?.id !== undefined
        ? `shopify:data_request:${String(dataRequest.id)}`
        : customer.id !== undefined
          ? `shopify:customer:${String(customer.id)}`
          : undefined,
  };
  if (subject.emails.length === 0 && subject.phones.length === 0) {
    deps.logger.warn(`Shopify ${topic}: no email or phone to match; nothing held`, meta);
    res.status(200).json({ received: true, handled: true });
    return;
  }

  try {
    const action = topic === "customers/redact" ? "erase" : "export";
    const result = await deps.requestPrivacy(action, subject);
    deps.logger.info(`Shopify ${topic}: ${action} queued`, { ...meta, ...result });
    res.status(200).json({ received: true, handled: true });
  } catch (error) {
    deps.logger.error(`Shopify ${topic}: request failed`, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "privacy request failed" });
  }
}

/**
 * Call a plugin-api mutation on Hay core with the worker's org- and
 * plugin-scoped token (HAY_API_URL / HAY_API_TOKEN from the plugin runner).
 */
export async function pluginApiMutation(
  procedure: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const apiUrl = env.HAY_API_URL;
  const token = env.HAY_API_TOKEN;
  if (!apiUrl || !token) throw new Error("HAY_API_URL / HAY_API_TOKEN not set");

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/pluginApi.${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Plugin API ${procedure} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { result?: { data?: unknown } };
  return data?.result?.data ?? data;
}
