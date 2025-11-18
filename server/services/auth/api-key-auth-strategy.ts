import { decryptConfig } from "@server/lib/auth/utils/encryption";
import type { PluginInstance } from "@server/entities/plugin-instance.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { AuthStrategy } from "./auth-strategy.interface";

/**
 * API Key Auth Strategy
 * Handles authentication using static API keys
 */
export class ApiKeyAuthStrategy implements AuthStrategy {
  private instance: PluginInstance;
  private manifest: HayPluginManifest;

  constructor(instance: PluginInstance, manifest: HayPluginManifest) {
    this.instance = instance;
    this.manifest = manifest;
  }

  /**
   * Get authentication headers for remote MCP servers
   * Extracts API key from config and formats it as Authorization header
   */
  async getHeaders(): Promise<Record<string, string>> {
    if (!this.instance.config) {
      return {};
    }

    const decryptedConfig = decryptConfig(this.instance.config);

    // Find API key field in config schema
    // Look for fields that might contain API keys
    const apiKeyFields = Object.entries(this.manifest.configSchema || {})
      .filter(
        ([_key, schema]) =>
          schema.encrypted ||
          schema.type === "password" ||
          _key.toLowerCase().includes("apikey") ||
          _key.toLowerCase().includes("api_key") ||
          _key.toLowerCase().includes("token") ||
          _key.toLowerCase().includes("secret"),
      )
      .map(([key]) => key);

    // Get the first API key field value
    const apiKeyField = apiKeyFields[0];
    if (!apiKeyField || !decryptedConfig[apiKeyField]) {
      return {};
    }

    const apiKey = decryptedConfig[apiKeyField] as string;

    // Return Authorization header
    // Format depends on the provider, but most use Bearer or API key directly
    return {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  /**
   * Get environment variables for local MCP servers
   * Maps config values to environment variables based on schema
   */
  async getEnvironmentVariables(): Promise<Record<string, string>> {
    if (!this.instance.config) {
      return {};
    }

    const decryptedConfig = decryptConfig(this.instance.config);
    const env: Record<string, string> = {};

    // Map config fields to environment variables
    if (this.manifest.configSchema) {
      for (const [key, schema] of Object.entries(this.manifest.configSchema)) {
        if (schema.env && decryptedConfig[key] !== undefined) {
          env[schema.env] = String(decryptedConfig[key]);
        }
      }
    }

    return env;
  }

  /**
   * API keys don't expire, so always valid if present
   */
  async isValid(): Promise<boolean> {
    if (!this.instance.config) {
      return false;
    }

    const decryptedConfig = decryptConfig(this.instance.config);

    // Check if any API key field has a value
    const apiKeyFields = Object.entries(this.manifest.configSchema || {})
      .filter(
        ([_key, schema]) =>
          schema.encrypted ||
          schema.type === "password" ||
          _key.toLowerCase().includes("apikey") ||
          _key.toLowerCase().includes("api_key") ||
          _key.toLowerCase().includes("token") ||
          _key.toLowerCase().includes("secret"),
      )
      .map(([key]) => key);

    return apiKeyFields.some((field) => !!decryptedConfig[field]);
  }

  /**
   * API keys don't need refresh
   */
  async refresh(): Promise<boolean> {
    return true; // Nothing to refresh
  }
}
