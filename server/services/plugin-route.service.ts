import { Request, Response } from "express";
import crypto from "crypto";
import { getPluginRunnerV2Service } from "./plugin-runner-v2.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { environmentManagerService } from "./environment-manager.service";
import type { HayPluginManifest } from "@server/types/plugin.types";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class PluginRouteService {
  private rateLimits = new Map<string, RateLimitEntry>();
  private readonly defaultRateLimit = 100; // requests per minute
  private readonly rateLimitWindow = 60 * 1000; // 1 minute

  /**
   * Handle webhook request for a plugin
   *
   * For SDK v2 plugins, webhooks are proxied to the worker's HTTP server.
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const { pluginName, webhookPath } = req.params;
    const fullPath = webhookPath || "";

    try {
      // Find the plugin
      const plugin = await pluginRegistryRepository.findByPluginId(pluginName);

      if (!plugin) {
        res.status(404).json({ error: "Plugin not found" });
        return;
      }

      // Check if plugin has webhook capability
      const manifest = plugin.manifest as HayPluginManifest;
      const webhookConfig = manifest.capabilities?.chat_connector?.webhooks?.find(
        (w) => w.path === `/${fullPath}` || w.path === fullPath,
      );

      if (!webhookConfig) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }

      // Verify method matches
      if (webhookConfig.method && webhookConfig.method !== req.method) {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      // Get organization from query or header
      const organizationId =
        (req.query.org as string) || (req.headers["x-organization-id"] as string);

      if (!organizationId) {
        res.status(400).json({ error: "Organization ID required" });
        return;
      }

      // Check rate limit
      if (!this.checkRateLimit(`${pluginName}:${organizationId}`)) {
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }

      // Find plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(
        organizationId,
        pluginName,
      );

      if (!instance || !instance.enabled) {
        res.status(404).json({ error: "Plugin instance not found or disabled" });
        return;
      }

      // Verify webhook signature if required
      if (webhookConfig.signatureHeader) {
        const signature = req.headers[webhookConfig.signatureHeader.toLowerCase()] as string;
        if (!signature) {
          res.status(401).json({ error: "Missing signature" });
          return;
        }

        const env = await environmentManagerService.prepareEnvironment(organizationId, instance);

        const webhookSecret = env.WEBHOOK_SECRET || instance.config?.webhookSecret;
        if (!webhookSecret) {
          console.error(`Webhook secret not configured for ${pluginName}`);
          res.status(500).json({ error: "Webhook secret not configured" });
          return;
        }

        if (
          !this.verifySignature(
            req.body,
            signature,
            webhookSecret as string,
            webhookConfig.signatureHeader,
          )
        ) {
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      }

      // Update activity timestamp when webhook is called
      await pluginInstanceManagerService.updateActivityTimestamp(organizationId, plugin.pluginId);

      // Get or start the worker and proxy the request to it
      const runnerV2 = getPluginRunnerV2Service();
      const worker = runnerV2.getWorker(organizationId, pluginName);

      if (!worker) {
        // Start the worker if not running
        await runnerV2.startWorker(organizationId, pluginName);
        const startedWorker = runnerV2.getWorker(organizationId, pluginName);
        if (!startedWorker) {
          res.status(500).json({ error: "Failed to start plugin worker" });
          return;
        }
      }

      const workerPort = runnerV2.getWorker(organizationId, pluginName)?.port;
      if (!workerPort) {
        res.status(500).json({ error: "Worker port not available" });
        return;
      }

      // Proxy the request to the worker's route endpoint
      const workerUrl = `http://localhost:${workerPort}/routes/${fullPath}`;

      const proxyResponse = await fetch(workerUrl, {
        method: req.method,
        headers: {
          "Content-Type": req.headers["content-type"] || "application/json",
          "X-Organization-Id": organizationId,
          ...Object.fromEntries(
            Object.entries(req.headers).filter(
              ([key]) => !["host", "connection", "content-length"].includes(key.toLowerCase()),
            ),
          ),
        },
        body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
      });

      // Forward the response
      const responseData = await proxyResponse.text();
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseData);
      } catch {
        responseBody = responseData;
      }

      // Copy response headers
      proxyResponse.headers.forEach((value, key) => {
        if (!["content-encoding", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });

      res.status(proxyResponse.status).json(responseBody);
    } catch (error) {
      console.error(`Webhook error for ${pluginName}/${fullPath}:`, error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(
    body: unknown,
    signature: string,
    secret: string,
    headerName: string,
  ): boolean {
    const payload = typeof body === "string" ? body : JSON.stringify(body);

    // Different services use different signature formats
    if (headerName.toLowerCase().includes("stripe")) {
      // Stripe format: t=timestamp,v1=signature
      const elements = signature.split(",");
      const timestamp = elements.find((e) => e.startsWith("t="))?.substring(2);
      const sig = elements.find((e) => e.startsWith("v1="))?.substring(3);

      if (!timestamp || !sig) return false;

      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");

      return sig === expectedSig;
    } else if (headerName.toLowerCase().includes("github")) {
      // GitHub format: sha256=signature
      const expectedSig =
        "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

      return signature === expectedSig;
    } else {
      // Default: plain HMAC
      const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

      return signature === expectedSig;
    }
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || entry.resetTime < now) {
      this.rateLimits.set(key, {
        count: 1,
        resetTime: now + this.rateLimitWindow,
      });
      return true;
    }

    if (entry.count >= this.defaultRateLimit) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Register webhook verification endpoint
   */
  async handleWebhookVerification(req: Request, res: Response): Promise<void> {
    const { pluginName } = req.params;

    // Handle common verification patterns
    // Facebook/Meta verification
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"]) {
      const plugin = await pluginRegistryRepository.findByPluginId(pluginName);

      if (plugin) {
        // Get verification token from environment or config
        const organizationId = req.query.org as string;
        if (organizationId) {
          const instance = await pluginInstanceRepository.findByOrgAndPlugin(
            organizationId,
            plugin.id,
          );

          const verifyToken = instance?.config?.verifyToken;
          if (verifyToken === req.query["hub.verify_token"]) {
            res.send(req.query["hub.challenge"]);
            return;
          }
        }
      }
      res.status(403).send("Verification failed");
      return;
    }

    // Default verification response
    res.status(200).send("OK");
  }

  /**
   * Clear expired rate limits (for cleanup)
   * Called by scheduled job: 'plugin-rate-limit-cleanup'
   */
  async clearRateLimits(): Promise<void> {
    const now = Date.now();
    let cleared = 0;

    for (const [key, entry] of this.rateLimits.entries()) {
      if (entry.resetTime < now) {
        this.rateLimits.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`[PluginRoute] Cleared ${cleared} expired rate limit entries`);
    }
  }

  /**
   * Start periodic cleanup
   * NOTE: Cleanup is now handled by the scheduler service
   * See: server/services/scheduled-jobs.registry.ts -> 'plugin-rate-limit-cleanup'
   */
  startCleanup(): void {
    // No-op: Cleanup is now handled by scheduler
    console.log("[PluginRoute] Rate limit cleanup handled by scheduler service");
  }
}

export const pluginRouteService = new PluginRouteService();
