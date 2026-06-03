/**
 * Plugin Metadata Service
 *
 * Handles fetching and validation of plugin metadata from SDK workers.
 * Implements retry logic with AbortController-based timeouts.
 */

import type { PluginMetadata } from "../types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-metadata");

/**
 * Validate plugin metadata structure
 * Ensures the metadata response from /metadata endpoint is well-formed
 */
export function validateMetadata(metadata: unknown): metadata is PluginMetadata {
  // Basic structure validation
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Metadata must be an object");
  }

  const meta = metadata as Record<string, unknown>;

  // Validate configSchema
  if (meta.configSchema !== undefined) {
    if (typeof meta.configSchema !== "object" || Array.isArray(meta.configSchema)) {
      throw new Error("configSchema must be an object");
    }

    // Validate each config field descriptor
    for (const [key, field] of Object.entries(meta.configSchema as Record<string, unknown>)) {
      if (!field || typeof field !== "object") {
        throw new Error(`Config field "${key}" must be an object`);
      }
      const f = field as Record<string, unknown>;
      if (typeof f.type !== "string" || !["string", "number", "boolean", "json"].includes(f.type)) {
        throw new Error(`Config field "${key}" has invalid type: ${f.type}`);
      }
      if (!f.label || typeof f.label !== "string") {
        throw new Error(`Config field "${key}" must have a string label`);
      }
    }
  }

  // Validate authMethods
  if (meta.authMethods !== undefined) {
    if (!Array.isArray(meta.authMethods)) {
      throw new Error("authMethods must be an array");
    }

    for (const entry of meta.authMethods) {
      const method = entry as Record<string, unknown>;
      if (!method.id || typeof method.id !== "string") {
        throw new Error("Auth method must have a string id");
      }
      if (typeof method.type !== "string" || !["apiKey", "oauth2"].includes(method.type)) {
        throw new Error(`Auth method "${method.id}" has invalid type: ${String(method.type)}`);
      }
      if (!method.label || typeof method.label !== "string") {
        throw new Error(`Auth method "${method.id}" must have a string label`);
      }
    }
  }

  // Validate uiExtensions
  if (meta.uiExtensions !== undefined) {
    if (!Array.isArray(meta.uiExtensions)) {
      throw new Error("uiExtensions must be an array");
    }

    for (const entry of meta.uiExtensions) {
      const ext = entry as Record<string, unknown>;
      if (!ext.slot || typeof ext.slot !== "string") {
        throw new Error(`UI extension must have a string slot`);
      }
      if (!ext.component || typeof ext.component !== "string") {
        throw new Error(`UI extension must have a string component`);
      }
      // id is optional - may be auto-generated from slot+component
    }
  }

  // Validate routes
  if (meta.routes !== undefined) {
    if (!Array.isArray(meta.routes)) {
      throw new Error("routes must be an array");
    }

    for (const entry of meta.routes) {
      const route = entry as Record<string, unknown>;
      if (!route.path || typeof route.path !== "string") {
        throw new Error("Route must have a string path");
      }
      if (
        typeof route.method !== "string" ||
        !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(route.method)
      ) {
        throw new Error(`Route "${route.path}" has invalid method: ${String(route.method)}`);
      }
    }
  }

  // Validate mcp
  if (meta.mcp !== undefined) {
    if (!meta.mcp || typeof meta.mcp !== "object") {
      throw new Error("mcp must be an object");
    }

    const mcp = meta.mcp as Record<string, unknown>;

    if (mcp.local !== undefined) {
      if (!Array.isArray(mcp.local)) {
        throw new Error("mcp.local must be an array");
      }

      for (const entry of mcp.local) {
        const server = entry as Record<string, unknown>;
        if (!server.serverId || typeof server.serverId !== "string") {
          throw new Error("Local MCP server must have a string serverId");
        }
        if (
          typeof server.status !== "string" ||
          !["available", "unavailable"].includes(server.status)
        ) {
          throw new Error(
            `Local MCP server "${server.serverId}" has invalid status: ${String(server.status)}`,
          );
        }
      }
    }

    if (mcp.external !== undefined) {
      if (!Array.isArray(mcp.external)) {
        throw new Error("mcp.external must be an array");
      }

      for (const entry of mcp.external) {
        const server = entry as Record<string, unknown>;
        if (!server.serverId || typeof server.serverId !== "string") {
          throw new Error("External MCP server must have a string serverId");
        }
        if (
          typeof server.status !== "string" ||
          !["available", "unavailable"].includes(server.status)
        ) {
          throw new Error(
            `External MCP server "${server.serverId}" has invalid status: ${String(server.status)}`,
          );
        }
      }
    }
  }

  return true;
}

/**
 * Fetch plugin metadata from worker with retry logic
 *
 * @param port - Worker port
 * @param pluginId - Plugin ID (for logging)
 * @returns Plugin metadata
 * @throws Error if fetch fails after all retries
 */
export async function fetchMetadataFromWorker(
  port: number,
  pluginId: string,
): Promise<PluginMetadata> {
  const maxRetries = 3;
  const timeoutMs = 5000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Create AbortController for timeout (Node.js standard)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      logger.debug({ pluginId, attempt, maxRetries, port }, "Fetching metadata");

      const response = await fetch(`http://localhost:${port}/metadata`, {
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const metadata = await response.json();

      // Validate metadata structure
      validateMetadata(metadata);

      logger.info({ pluginId }, "Successfully fetched metadata");

      return metadata;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      if (error instanceof Error && error.name === "AbortError") {
        logger.warn({ pluginId, attempt, maxRetries }, "Metadata fetch timeout");
      } else {
        logger.warn(
          {
            pluginId,
            attempt,
            maxRetries,
            error: error instanceof Error ? error.message : String(error),
          },
          "Metadata fetch failed",
        );
      }

      // Exponential backoff between retries
      if (attempt < maxRetries) {
        const backoffMs = 1000 * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries failed
  throw new Error(
    `Failed to fetch metadata after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`,
  );
}
