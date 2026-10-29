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
 * - customers/redact and customers/data_request: logged (ids only) and
 *   acknowledged. Hay.chat does not copy Nuvemshop customer records; the agent
 *   reads them live through the API. A shopper's chats in Hay.chat follow
 *   Hay.chat's own privacy flow (request by email, verified), which a store
 *   webhook cannot trigger without a new flow. TODO: map these once Hay.chat
 *   has a merchant-initiated customer export/erase.
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

export interface LgpdDeps {
  /** This org's store id, when known (a body for another store is ignored). */
  storeId: () => string | undefined;
  /** Ask core to disconnect this org's store. */
  revokeConnection: (reason: string) => Promise<void>;
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
  const customer = payload.customer as Record<string, unknown> | undefined;
  const dataRequest = payload.data_request as Record<string, unknown> | undefined;
  deps.logger.info(
    `Nuvemshop ${kind}: acknowledged. Hay.chat keeps no copy of Nuvemshop customer records`,
    {
      kind,
      storeId,
      customerId: customer?.id,
      dataRequestId: dataRequest?.id,
      orders: count(payload.orders_to_redact) ?? count(payload.orders_requested),
    },
  );
  res.status(200).json({ received: true, handled: true });
}
