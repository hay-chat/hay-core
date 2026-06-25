import type { Request, Response } from "express";
import { pluginManagerService } from "./plugin-manager.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { pluginWebhookRouteRepository } from "../repositories/plugin-webhook-route.repository";
import { verifyHmacSha256 } from "./plugin-route.service";
import type { WebhookRoutingDescriptor } from "../types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("webhook-router");

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

interface ResolvedItem {
  routingKey: string;
  rawItem: unknown;
  organizationId: string;
}

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
    return plugin.metadata?.webhookRouting ?? null;
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

    const signatureHeader = req.headers[routing.signature.header.toLowerCase()];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!verifyHmacSha256(rawBody, signature, secret)) {
      logger.warn({ pluginId }, "Shared webhook signature verification failed");
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
   */
  private async dispatch(
    pluginId: string,
    routing: WebhookRoutingDescriptor,
    body: Record<string, unknown>,
    req: Request,
  ): Promise<void> {
    const { itemsPath, keyPath } = routing.routeKeyPath;

    const items = getPath(body, itemsPath);
    if (!Array.isArray(items)) {
      logger.warn({ pluginId, itemsPath }, "Shared webhook itemsPath did not resolve to an array");
      return;
    }

    // Resolve each item's routing key → owning org.
    const resolved: ResolvedItem[] = [];
    for (const rawItem of items) {
      const keyValue = getPath(rawItem, keyPath);
      if (keyValue === undefined || keyValue === null) {
        logger.debug({ pluginId, keyPath }, "Shared webhook item missing routing key; dropping");
        continue;
      }
      const routingKey = String(keyValue);

      const owner = await pluginWebhookRouteRepository.findByKey(pluginId, routingKey);
      if (!owner) {
        logger.info({ pluginId, routingKey }, "Unknown routing key for shared webhook; dropping");
        continue;
      }

      resolved.push({ routingKey, rawItem, organizationId: owner.organizationId });
    }

    if (resolved.length === 0) {
      return;
    }

    // Group items by org, preserving the original top-level fields.
    const byOrg = new Map<string, unknown[]>();
    for (const item of resolved) {
      const list = byOrg.get(item.organizationId) ?? [];
      list.push(item.rawItem);
      byOrg.set(item.organizationId, list);
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
   * items under `itemsPath`) to the worker's `/webhook` route. Reuses the
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

    const reconstructedBody = setPath({ ...originalBody }, itemsPath, orgItems);
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
    // Pass the reconstructed (per-org) body as the raw body too, so a worker
    // that reads x-original-body-base64 sees exactly what it is being given.
    headers["x-original-body-base64"] = Buffer.from(serialized, "utf8").toString("base64");

    const workerUrl = `http://localhost:${worker.port}/webhook`;

    const response = await fetch(workerUrl, {
      method: "POST",
      headers,
      body: serialized,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Worker returned ${response.status}: ${text}`);
    }
  }

  /**
   * Read the exact raw request bytes captured upstream. The body-parser
   * `verify` hook in main.ts populates `req.rawBody`; the proxy also forwards
   * it as base64 in `x-original-body-base64`.
   */
  private getRawBody(req: Request): Buffer | null {
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (typeof rawBody === "string" && rawBody.length > 0) {
      return Buffer.from(rawBody, "utf8");
    }

    const encoded = req.headers["x-original-body-base64"];
    const value = Array.isArray(encoded) ? encoded[0] : encoded;
    if (typeof value === "string" && value.length > 0) {
      return Buffer.from(value, "base64");
    }

    return null;
  }
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

export const webhookRouterService = new WebhookRouterService();

// Exported for unit tests of the no-eval path extractor / body reconstruction.
export const __webhookRouterInternals = { getPath, setPath };
