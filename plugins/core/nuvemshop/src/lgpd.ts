/**
 * The three LGPD webhooks Nuvemshop requires from partner apps.
 *
 * Nuvemshop sends all of them to the app's webhook URL, signed with the app
 * secret (`x-linkedstore-hmac-sha256`, HMAC-SHA256 hex of the raw body). Core
 * verifies that signature, routes the body to the org whose connection
 * returned the payload's `store_id` as a routing key, and forwards it here
 * with `x-hay-webhook-verified: true`. The bodies carry no event name, so the
 * kind is read from their shape:
 *
 *   store/redact            { store_id }
 *   customers/redact        { store_id, customer, orders_to_redact }
 *   customers/data_request  { store_id, customer, orders_requested, …, data_request }
 *
 * What Hay.chat does with each:
 * - store/redact: disconnect the store (core clears the token, the store id and
 *   the routing key, and stops the worker).
 * - customers/redact: core erases every Hay.chat customer of this org matching
 *   the shopper's email or phone (their conversations, messages and media), as
 *   a background job. Nuvemshop customer records themselves are never copied;
 *   the agent reads them live through the API.
 * - customers/data_request: core queues the same data export a verified
 *   self-service request produces and emails its download link to the
 *   store's owners and admins in Hay.chat, asking them to forward it: under
 *   LGPD the store is the controller and answers its shopper, so the shopper
 *   is never emailed. No match, or no owner/admin email, is logged here and
 *   recorded by core.
 *
 * Both are idempotent while the job is in flight, so a retried delivery does
 * not queue a second job.
 *
 * @see https://tiendanube.github.io/api-documentation/resources/webhook
 */

export type LgpdKind = "store/redact" | "customers/redact" | "customers/data_request";

/** Read the LGPD kind from a webhook body, or null for anything else. */
export function classifyLgpdWebhook(body: unknown): LgpdKind | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  if (payload.store_id === undefined || payload.store_id === null) return null;
  // Regular store webhooks (order/created, app/uninstalled…) name their event.
  if (typeof payload.event === "string") return null;
  if ("data_request" in payload || "orders_requested" in payload) {
    return "customers/data_request";
  }
  if ("orders_to_redact" in payload || "customer" in payload) return "customers/redact";
  return "store/redact";
}

interface LgpdRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface LgpdResponse {
  status(code: number): { json(body: unknown): void };
}

/** How the shopper is identified to core: the contact details Nuvemshop sends. */
export interface PrivacySubject {
  emails: string[];
  phones: string[];
  reference?: string;
}

export interface LgpdDeps {
  /** This org's store id, when known (a body for another store is ignored). */
  storeId: () => string | undefined;
  /** Ask core to disconnect this org's store. */
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

function count(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

/** POST /webhook handler. Always answers 2xx for verified LGPD bodies (Nuvemshop retries otherwise). */
export async function handleLgpdWebhook(
  req: LgpdRequest,
  res: LgpdResponse,
  deps: LgpdDeps,
): Promise<void> {
  if (req.headers["x-hay-webhook-verified"] !== "true") {
    res.status(401).json({ error: "unverified" });
    return;
  }

  const kind = classifyLgpdWebhook(req.body);
  if (!kind) {
    res.status(200).json({ received: true, handled: false });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const storeId = String(payload.store_id);
  const ownStoreId = deps.storeId();
  if (ownStoreId && ownStoreId !== storeId) {
    deps.logger.warn("Nuvemshop LGPD webhook for another store; ignored", { kind, storeId });
    res.status(200).json({ received: true, handled: false });
    return;
  }

  if (kind === "store/redact") {
    try {
      await deps.revokeConnection("nuvemshop store/redact");
      deps.logger.info("Nuvemshop store/redact: store disconnected", { storeId });
      res.status(200).json({ received: true, handled: true });
    } catch (error) {
      deps.logger.error("Nuvemshop store/redact: disconnect failed", {
        storeId,
        error: error instanceof Error ? error.message : String(error),
      });
      // 5xx makes Nuvemshop retry; the revoke is idempotent.
      res.status(500).json({ error: "disconnect failed" });
    }
    return;
  }

  // Ids and counts only: the body also carries the shopper's email, phone and CPF.
  const customer = (payload.customer ?? {}) as Record<string, unknown>;
  const dataRequest = payload.data_request as Record<string, unknown> | undefined;
  const meta = {
    kind,
    storeId,
    customerId: customer.id,
    dataRequestId: dataRequest?.id,
    orders: count(payload.orders_to_redact) ?? count(payload.orders_requested),
  };
  const subject: PrivacySubject = {
    emails: typeof customer.email === "string" && customer.email ? [customer.email] : [],
    phones: typeof customer.phone === "string" && customer.phone ? [customer.phone] : [],
    reference:
      dataRequest?.id !== undefined
        ? `nuvemshop:data_request:${String(dataRequest.id)}`
        : customer.id !== undefined
          ? `nuvemshop:customer:${String(customer.id)}`
          : undefined,
  };
  if (subject.emails.length === 0 && subject.phones.length === 0) {
    deps.logger.warn(`Nuvemshop ${kind}: no email or phone to match; nothing held`, meta);
    res.status(200).json({ received: true, handled: true });
    return;
  }

  try {
    const action = kind === "customers/redact" ? "erase" : "export";
    const result = await deps.requestPrivacy(action, subject);
    if (action === "export" && (result.matched === 0 || result.undeliverable)) {
      deps.logger.warn(
        result.matched === 0
          ? `Nuvemshop ${kind}: no Hay.chat customer matches; nothing to export`
          : `Nuvemshop ${kind}: no store owner or admin email to send the export to`,
        { ...meta, ...result },
      );
    } else {
      deps.logger.info(`Nuvemshop ${kind}: ${action} queued`, { ...meta, ...result });
    }
    res.status(200).json({ received: true, handled: true });
  } catch (error) {
    deps.logger.error(`Nuvemshop ${kind}: request failed`, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    // 5xx makes Nuvemshop retry; core keeps one job per customer while in flight.
    res.status(500).json({ error: "privacy request failed" });
  }
}
