/**
 * Plugin Metadata Service
 *
 * Handles fetching and validation of plugin metadata from SDK v2 workers.
 * Implements retry logic with AbortController-based timeouts.
 */

import type { PluginMetadata } from "../types/plugin-sdk-v2.types";

/**
 * Validate plugin metadata structure
 * Ensures the metadata response from /metadata endpoint is well-formed
 */
export function validateMetadata(metadata: any): metadata is PluginMetadata {
  // Basic structure validation
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Metadata must be an object");
  }

  // Validate configSchema
  if (metadata.configSchema !== undefined) {
    if (typeof metadata.configSchema !== "object" || Array.isArray(metadata.configSchema)) {
      throw new Error("configSchema must be an object");
    }

    // Validate each config field descriptor
    for (const [key, field] of Object.entries(metadata.configSchema)) {
      if (!field || typeof field !== "object") {
        throw new Error(`Config field "${key}" must be an object`);
      }
      const f = field as any;
      if (!["string", "number", "boolean", "json"].includes(f.type)) {
        throw new Error(`Config field "${key}" has invalid type: ${f.type}`);
      }
      if (!f.label || typeof f.label !== "string") {
        throw new Error(`Config field "${key}" must have a string label`);
      }
    }
  }

  // Validate authMethods
  if (metadata.authMethods !== undefined) {
    if (!Array.isArray(metadata.authMethods)) {
      throw new Error("authMethods must be an array");
    }

    for (const method of metadata.authMethods) {
      if (!method.id || typeof method.id !== "string") {
        throw new Error("Auth method must have a string id");
      }
      if (!method.type || !["apiKey", "oauth2"].includes(method.type)) {
        throw new Error(`Auth method "${method.id}" has invalid type: ${method.type}`);
      }
      if (!method.label || typeof method.label !== "string") {
        throw new Error(`Auth method "${method.id}" must have a string label`);
      }
    }
  }

  // Validate uiExtensions
  if (metadata.uiExtensions !== undefined) {
    if (!Array.isArray(metadata.uiExtensions)) {
      throw new Error("uiExtensions must be an array");
    }

    for (const ext of metadata.uiExtensions) {
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
  if (metadata.routes !== undefined) {
    if (!Array.isArray(metadata.routes)) {
      throw new Error("routes must be an array");
    }

    for (const route of metadata.routes) {
      if (!route.path || typeof route.path !== "string") {
        throw new Error("Route must have a string path");
      }
      if (!route.method || !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(route.method)) {
        throw new Error(`Route "${route.path}" has invalid method: ${route.method}`);
      }
    }
  }

  // Validate mcp
  if (metadata.mcp !== undefined) {
    if (!metadata.mcp || typeof metadata.mcp !== "object") {
      throw new Error("mcp must be an object");
    }

    if (metadata.mcp.local !== undefined) {
      if (!Array.isArray(metadata.mcp.local)) {
        throw new Error("mcp.local must be an array");
      }

      for (const server of metadata.mcp.local) {
        if (!server.serverId || typeof server.serverId !== "string") {
          throw new Error("Local MCP server must have a string serverId");
        }
        if (!["available", "unavailable"].includes(server.status)) {
          throw new Error(`Local MCP server "${server.serverId}" has invalid status: ${server.status}`);
        }
      }
    }

    if (metadata.mcp.external !== undefined) {
      if (!Array.isArray(metadata.mcp.external)) {
        throw new Error("mcp.external must be an array");
      }

      for (const server of metadata.mcp.external) {
        if (!server.serverId || typeof server.serverId !== "string") {
          throw new Error("External MCP server must have a string serverId");
        }
        if (!["available", "unavailable"].includes(server.status)) {
          throw new Error(`External MCP server "${server.serverId}" has invalid status: ${server.status}`);
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
  pluginId: string
): Promise<PluginMetadata> {
  const maxRetries = 3;
  const timeoutMs = 5000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Create AbortController for timeout (Node.js standard)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      console.log(`[Metadata] Fetching metadata for ${pluginId} (attempt ${attempt}/${maxRetries}) on port ${port}`);

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

      console.log(`[Metadata] Successfully fetched metadata for ${pluginId}`);

      return metadata;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Metadata] Timeout for ${pluginId} (attempt ${attempt}/${maxRetries})`);
      } else {
        console.warn(`[Metadata] Fetch failed for ${pluginId} (attempt ${attempt}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`);
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
    `Failed to fetch metadata after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`
  );
}
