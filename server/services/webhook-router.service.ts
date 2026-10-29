import crypto from "crypto";
import type { Request, Response } from "express";
import { pluginManagerService } from "./plugin-manager.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginWebhookRouteRepository } from "../repositories/plugin-webhook-route.repository";
import { verifyHmacSha256 } from "./plugin-route.service";
import { normalizeEmailAddressKey, verifySvixSignature } from "@server/lib/svix-signature";
import type {
  WebhookDeauthorizationDescriptor,
  WebhookRouteKeyPathDescriptor,
  WebhookRoutingDescriptor,
} from "../types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";
import { parseSignedRequest } from "@server/lib/signed-request";
import { isValidUuid } from "@server/lib/validation/uuid";
import { getApiUrl } from "@server/config/env";

const logger = createLogger("webhook-router");

/** Budget for the worker to handle one forwarded webhook. */
const WORKER_WEBHOOK_TIMEOUT_MS = 30_000;

/**
 * Headers that must never be forwarded to a plugin worker (credential leakage)
 * or that the proxy re-encodes. Mirrors proxy.ts.
 */
const STRIPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-forwarded-for",
  "x-real-ip",
  "proxy-authorization",
  "content-length",
]);

type RouteOwner = { organizationId: string; pluginInstanceId: string } | null;

/**
 * Generic, plugin-declared webhook router.
 *
 * A plugin can declare (as plain data, in its metadata) how Hay Core should
 * route a SINGLE shared webhook URL — one that carries no org identifier — out
 * to the right per-org workers. Core executes the declared strategy blindly and
 * never learns which provider this is. All provider-specific knowledge lives in
 * the plugin's declaration.
 *
 * @see WebhookRoutingDescriptor
 */
export class WebhookRouterService {
  /**
   * Load the webhook routing strategy a plugin declared in its metadata.
   *
   * @returns The descriptor, or null if the plugin does not declare one (the
   *   caller then falls back to the existing per-org webhook behavior).
   */
  async getRoutingDescriptor(pluginId: string): Promise<WebhookRoutingDescriptor | null> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return null;
    }
    if (plugin.metadataState === "fresh") {
      return plugin.metadata?.webhookRouting ?? null;
    }

    // Metadata is only (re)fetched when a worker starts, and a shared webhook
    // carries no org to start one for. Borrow any org that has the plugin
    // enabled: starting its worker refreshes the plugin-global metadata.
    const instances = await pluginInstanceRepository.findByPlugin(plugin.id);
    const enabled = instances.find((instance) => instance.enabled);
    if (enabled) {
      try {
        await pluginManagerService.startPluginWorker(enabled.organizationId, pluginId);
      } catch (err) {
        logger.warn({ err, pluginId }, "Metadata refresh for webhook routing failed");
      }
    }
    const refreshed = pluginManagerService.getPlugin(pluginId) ?? plugin;
    return refreshed.metadata?.webhookRouting ?? null;
  }

  /**
   * Handle a shared webhook request for a plugin that declares a routing
   * strategy. The caller has already confirmed the plugin declares
   * `webhookRouting` and that no org id is present in the request.
   */
  async handle(
    req: Request,
    res: Response,
    pluginId: string,
    routing: WebhookRoutingDescriptor,
  ): Promise<void> {
    // GET → verification handshake (no signature; echo the challenge).
    if (req.method === "GET") {
      await this.handleVerification(req, res, routing);
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // POST → verify HMAC once over the exact raw bytes, then fan out.
    const rawBody = this.getRawBody(req);
    if (!rawBody) {
      logger.warn({ pluginId }, "Shared webhook POST missing raw body; rejecting");
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    const secret = process.env[routing.signature.secretEnv];
    if (!secret) {
      logger.error(
        { pluginId, secretEnv: routing.signature.secretEnv },
        "Shared webhook signing secret not configured",
      );
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    if (!this.verifySignature(req, rawBody, routing, secret)) {
      logger.warn(
        { pluginId, format: routing.signature.format },
        "Shared webhook signature verification failed",
      );
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Signature is valid → parse the body and resolve routing keys.
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      logger.warn({ pluginId }, "Shared webhook body is not valid JSON");
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    // Always respond 200 promptly; fan-out happens asynchronously so a slow or
    // failing worker never blocks the provider's delivery pipeline.
    res.status(200).json({ received: true });

    void this.dispatch(pluginId, routing, body, req).catch((err) => {
      logger.error({ err, pluginId }, "Unexpected error during shared webhook dispatch");
    });
  }

  /**
   * Verify the shared-webhook signature with the declared format.
   */
  private verifySignature(
    req: Request,
    rawBody: Buffer,
    routing: WebhookRoutingDescriptor,
    secret: string,
  ): boolean {
    const header = (name: string): string | undefined => {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };

    if (routing.signature.format === "svix") {
      return verifySvixSignature(
        rawBody,
        {
          id: header("svix-id"),
          timestamp: header("svix-timestamp"),
          signature: header(routing.signature.header),
        },
        secret,
      );
    }

    return verifyHmacSha256(rawBody, header(routing.signature.header), secret);
  }

  /**
   * Handle a provider deauthorize / data-deletion callback for a plugin that
   * declares `webhookRouting.deauthorization`. Verifies the signed request,
   * resolves the owning org from the routing key in its payload, and
   * disconnects that org's instance: clears its credentials and routing keys
   * and stops its worker so no cached token survives.
   *
   * Data deletion answers `{ url, confirmation_code }` as the provider
   * requires; `url` is the status page served by `handleDataDeletionStatus`.
   * The deletion runs synchronously, so a returned code means it is done.
   * Conversations and customers stay with the org: they are the business's
   * records, not the connecting account's.
   */
  async handleDeauthorization(
    req: Request,
    res: Response,
    pluginId: string,
    descriptor: WebhookDeauthorizationDescriptor,
    kind: "deauthorize" | "data-deletion",
  ): Promise<void> {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const secret = process.env[descriptor.secretEnv];
    if (!secret) {
      logger.error(
        { pluginId, secretEnv: descriptor.secretEnv },
        "Deauthorization signing secret not configured",
      );
      res.status(500).json({ error: "Signing secret not configured" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload = parseSignedRequest(body[descriptor.param], secret);
    if (!payload) {
      logger.warn({ pluginId, kind }, "Deauthorization signed request invalid");
      res.status(400).json({ error: "Invalid signed request" });
      return;
    }

    const keyValue = getPath(payload, descriptor.keyPath);
    if (keyValue === undefined || keyValue === null) {
      res.status(400).json({ error: "Signed request missing routing key" });
      return;
    }

    const owner = await pluginWebhookRouteRepository.findByKey(pluginId, String(keyValue));
    if (owner) {
      await pluginInstanceRepository.clearAuthState(owner.pluginInstanceId, owner.organizationId);
      await pluginWebhookRouteRepository.clearForInstance(owner.pluginInstanceId);
      await pluginManagerService
        .stopPluginWorker(owner.organizationId, pluginId)
        .catch((err) => logger.warn({ err, pluginId }, "Failed to stop worker on deauthorize"));
      logger.info(
        { pluginId, organizationId: owner.organizationId, kind },
        "Plugin instance disconnected by provider callback",
      );
    } else {
      // Nothing stored for this key (never connected, or already removed).
      logger.info({ pluginId, kind }, "Deauthorization for unknown routing key; nothing to remove");
    }

    if (kind === "deauthorize") {
      res.status(200).json({ success: true });
      return;
    }

    const confirmationCode = crypto.randomUUID();
    logger.info({ pluginId, confirmationCode }, "Data deletion request completed");
    res.status(200).json({
      url: `${getApiUrl()}/v1/plugins/${encodeURIComponent(pluginId)}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  }

  /**
   * Public status page for a data-deletion confirmation code. Deletion runs
   * synchronously when the request is received, so any issued code is complete.
   */
  handleDataDeletionStatus(req: Request, res: Response): void {
    const code = req.query.code;
    if (typeof code !== "string" || !isValidUuid(code)) {
      res.status(400).send("Invalid confirmation code");
      return;
    }

    res
      .status(200)
      .type("html")
      .send(
        `<html><head><title>Data deletion status</title></head><body>` +
          `<h1>Data deletion completed</h1>` +
          `<p>Confirmation code: <code>${code}</code></p>` +
          `<p>Hay.chat removed the access token and account identifiers it stored for this connection.</p>` +
          `</body></html>`,
      );
  }

  /**
   * GET verification handshake. Echoes the challenge param when the mode is
   * "subscribe" and the supplied verify token matches the plugin's declared
   * token source (env var or — looked up per plugin — instance config field).
   */
  private async handleVerification(
    req: Request,
    res: Response,
    routing: WebhookRoutingDescriptor,
  ): Promise<void> {
    const challenge = routing.verificationChallenge;
    if (!challenge) {
      res.status(200).send("OK");
      return;
    }

    const mode = req.query[challenge.modeParam];
    const token = req.query[challenge.verifyTokenParam];
    const challengeValue = req.query[challenge.challengeParam];

    if (mode !== "subscribe" || typeof token !== "string") {
      res.status(403).send("Verification failed");
      return;
    }

    const expectedToken = await this.resolveVerifyToken(challenge);
    if (expectedToken && token === expectedToken && typeof challengeValue === "string") {
      res.status(200).send(challengeValue);
      return;
    }

    res.status(403).send("Verification failed");
  }

  /**
   * Resolve the expected verify token. The shared-app model uses a single env
   * token; `verifyTokenConfigField` exists for per-instance tokens but is not
   * resolvable on a no-org shared URL, so env takes precedence.
   */
  private async resolveVerifyToken(
    challenge: NonNullable<WebhookRoutingDescriptor["verificationChallenge"]>,
  ): Promise<string | undefined> {
    if (challenge.verifyTokenEnv) {
      const value = process.env[challenge.verifyTokenEnv];
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Resolve routing keys to orgs, group items per org, and forward each org's
   * reconstructed body to its worker.
   *
   * Without `routeKeyPath.nested`, every item goes whole to the org owning its
   * item-level key. With `nested`, each item's sub-array is split per sub-item
   * owner: known nested keys route to their org, unknown nested keys are
   * dropped (never falling back to the item owner), and sub-items without a
   * nested key go to the item-level owner. Each org receives one clone of the
   * item holding only its own sub-items.
   */
  private async dispatch(
    pluginId: string,
    routing: WebhookRoutingDescriptor,
    body: Record<string, unknown>,
    req: Request,
  ): Promise<void> {
    const { itemsPath, keyPath, nested } = routing.routeKeyPath;
    const extractKey = (source: unknown, path: string): string | undefined =>
      routingKey(source, path, routing.routeKeyPath.keyTransform);

    // "." = the body is one event (no array); it is routed and forwarded whole.
    const items = itemsPath === "." ? [body] : getPath(body, itemsPath);
    if (!Array.isArray(items)) {
      logger.warn({ pluginId, itemsPath }, "Shared webhook itemsPath did not resolve to an array");
      return;
    }

    // One repository lookup per distinct key within this dispatch.
    const ownerCache = new Map<string, Promise<RouteOwner>>();
    const resolveOwner = (routingKey: string): Promise<RouteOwner> => {
      let pending = ownerCache.get(routingKey);
      if (!pending) {
        pending = pluginWebhookRouteRepository.findByKey(pluginId, routingKey);
        ownerCache.set(routingKey, pending);
      }
      return pending;
    };

    // Group items by org, preserving the original top-level fields.
    const byOrg = new Map<string, unknown[]>();
    const addToOrg = (organizationId: string, item: unknown): void => {
      const list = byOrg.get(organizationId) ?? [];
      list.push(item);
      byOrg.set(organizationId, list);
    };

    for (const rawItem of items) {
      const itemKey = extractKey(rawItem, keyPath);
      let itemOwner: RouteOwner = null;
      if (itemKey === undefined) {
        logger.debug({ pluginId, keyPath }, "Shared webhook item missing routing key");
      } else {
        itemOwner = await resolveOwner(itemKey);
        if (!itemOwner) {
          logger.info({ pluginId, routingKey: itemKey }, "Unknown routing key for shared webhook");
        }
      }

      const subItems = nested ? getPath(rawItem, nested.itemsPath) : undefined;
      if (!nested || !Array.isArray(subItems)) {
        // No nested routing: the whole item goes to its item-level owner.
        if (itemOwner) {
          addToOrg(itemOwner.organizationId, rawItem);
        } else {
          logger.debug({ pluginId }, "Shared webhook item has no owner; dropping");
        }
        continue;
      }

      // Nested routing: split the sub-array by sub-item owner.
      const subItemsByOrg = new Map<string, unknown[]>();
      for (const subItem of subItems) {
        const subKey = extractKey(subItem, nested.keyPath);
        let owner: RouteOwner;
        if (subKey === undefined) {
          // Account-level sub-item: belongs to the item-level owner.
          owner = itemOwner;
        } else {
          owner = await resolveOwner(subKey);
          if (!owner) {
            logger.info(
              { pluginId, routingKey: subKey },
              "Unknown nested routing key for shared webhook; dropping sub-item",
            );
          }
        }
        if (!owner) {
          continue;
        }
        const list = subItemsByOrg.get(owner.organizationId) ?? [];
        list.push(subItem);
        subItemsByOrg.set(owner.organizationId, list);
      }

      for (const [organizationId, orgSubItems] of subItemsByOrg) {
        addToOrg(organizationId, withPath(rawItem, nested.itemsPath, orgSubItems));
      }
    }

    if (byOrg.size === 0) {
      return;
    }

    const results = await Promise.allSettled(
      Array.from(byOrg.entries()).map(([organizationId, orgItems]) =>
        this.forwardToOrg(pluginId, organizationId, itemsPath, body, orgItems, req),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const organizationId = Array.from(byOrg.keys())[index];
        logger.error(
          { err: result.reason, pluginId, organizationId },
          "Failed to forward shared webhook to org worker",
        );
      }
    });
  }

  /**
   * Start the org's worker and POST the reconstructed body (only that org's
   * items under `itemsPath`; with nested routing those items are already
   * filtered to the org's sub-items) to the worker's `/webhook` route. Reuses the
   * header-forwarding rules from proxy.ts and marks the request as already
   * signature-verified via an internal header.
   */
  private async forwardToOrg(
    pluginId: string,
    organizationId: string,
    itemsPath: string,
    originalBody: Record<string, unknown>,
    orgItems: unknown[],
    req: Request,
  ): Promise<void> {
    const worker = await pluginManagerService.startPluginWorker(organizationId, pluginId);
    pluginInstanceManagerService.updateActivityTimestamp(organizationId, pluginId).catch(() => {});

    const reconstructedBody =
      itemsPath === "." ? originalBody : setPath({ ...originalBody }, itemsPath, orgItems);
    const serialized = JSON.stringify(reconstructedBody);

    const headers: Record<string, string> = {};
    Object.entries(req.headers).forEach(([key, value]) => {
      if (STRIPPED_HEADERS.has(key.toLowerCase())) return;
      if (typeof value === "string") {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value[0];
      }
    });
    headers.host = `localhost:${worker.port}`;
    headers["content-type"] = "application/json";

    const externalProto = req.get("x-forwarded-proto") || req.protocol;
    headers["x-original-url"] = `${externalProto}://${req.get("host")}${req.originalUrl}`;

    // The worker still recomputes the per-org body, so its own signature would
    // not match. Core already verified the shared signature over the raw bytes,
    // so tell the worker to trust this request.
    headers["x-hay-webhook-verified"] = "true";

    const workerUrl = `http://localhost:${worker.port}/webhook`;

    const response = await fetch(workerUrl, {
      method: "POST",
      headers,
      body: serialized,
      signal: AbortSignal.timeout(WORKER_WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Worker returned ${response.status}: ${text}`);
    }
  }

  /**
   * Read the exact raw request bytes captured by the body-parser `verify`
   * hook in main.ts (`req.rawBody`).
   */
  private getRawBody(req: Request): Buffer | null {
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody === "string" && rawBody.length > 0) {
      return Buffer.from(rawBody, "utf8");
    }
    return null;
  }
}

/**
 * Extract and normalise one routing key. `"."` selects the item itself (for
 * plain-string arrays); `keyTransform` normalises the value so plugins can
 * register keys in a canonical form.
 */
function routingKey(
  source: unknown,
  path: string,
  transform: WebhookRouteKeyPathDescriptor["keyTransform"],
): string | undefined {
  const value = path === "." ? source : getPath(source, path);
  if (value === undefined || value === null) {
    return undefined;
  }
  const key = String(value);
  return transform === "email-address" ? normalizeEmailAddressKey(key) : key;
}

/**
 * Minimal, safe dot-path getter. No code execution. Traverses plain object
 * properties only; returns undefined on any missing/non-object segment.
 */
function getPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined) {
    return undefined;
  }
  const segments = path.split(".");
  let current: unknown = source;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

/**
 * Minimal dot-path setter that mutates and returns `target`, creating plain
 * intermediate objects as needed. Used to reconstruct a per-org body with only
 * that org's items under the declared itemsPath.
 */
function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const next = current[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
  return target;
}

/**
 * Immutable dot-path setter: returns a copy of `source` with `value` placed at
 * `path`, cloning every object along the path. Neither `source` nor any of its
 * nested objects is mutated, so per-org copies of the same item never share
 * the array that was replaced. Non-object segments are replaced by a fresh
 * object.
 */
function withPath(source: unknown, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const base: Record<string, unknown> =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? { ...(source as Record<string, unknown>) }
      : {};
  base[head] = rest.length === 0 ? value : withPath(base[head], rest.join("."), value);
  return base;
}

export const webhookRouterService = new WebhookRouterService();

// Exported for unit tests of the no-eval path extractor / body reconstruction.
export const __webhookRouterInternals = { getPath, setPath, withPath, routingKey };
