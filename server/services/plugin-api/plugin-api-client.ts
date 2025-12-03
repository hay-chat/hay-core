import type {
  PluginAPIClientConfig,
  PluginAPIHttpResponse,
  SendEmailHttpRequest,
  SendEmailHttpResponse,
  EmailSendOptions,
} from "../../types/plugin-api.types";

/**
 * Plugin API Client SDK
 *
 * Simple client library for plugins to call back to the platform's HTTP API
 * without manually managing fetch requests and authentication.
 *
 * Usage in plugins:
 * ```typescript
 * const api = new PluginAPIClient({
 *   apiUrl: process.env.PLUGIN_API_URL!,
 *   pluginId: process.env.PLUGIN_ID!,
 *   organizationId: process.env.ORGANIZATION_ID!,
 *   apiToken: process.env.PLUGIN_API_TOKEN!,
 * });
 *
 * const result = await api.sendEmail({
 *   to: "user@example.com",
 *   subject: "Welcome",
 *   text: "Welcome to our platform!",
 * });
 * ```
 */
export class PluginAPIClient {
  private config: PluginAPIClientConfig;

  constructor(config: PluginAPIClientConfig) {
    this.config = config;
  }

  /**
   * Make authenticated request to Plugin API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<PluginAPIHttpResponse<T>> {
    const url = `${this.config.apiUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiToken}`,
          ...options.headers,
        },
      });

      const data = (await response.json()) as PluginAPIHttpResponse<T>;

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network request failed",
      };
    }
  }

  /**
   * Health check - verify API connectivity and token validity
   */
  async health(): Promise<PluginAPIHttpResponse<{
    pluginId: string;
    organizationId: string;
    capabilities: string[];
  }>> {
    return this.request("/health", { method: "GET" });
  }

  /**
   * Send email using platform's email service
   *
   * @param options Email sending options (subject, body, recipients)
   * @returns Promise with result containing success status and messageId
   *
   * @example
   * ```typescript
   * const result = await api.sendEmail({
   *   to: "user@example.com",
   *   subject: "Welcome to our platform",
   *   text: "Thank you for signing up!",
   * });
   *
   * if (result.success) {
   *   console.log(`Email sent: ${result.data.messageId}`);
   * } else {
   *   console.error(`Failed to send email: ${result.error}`);
   * }
   * ```
   */
  async sendEmail(
    options: EmailSendOptions,
  ): Promise<PluginAPIHttpResponse<SendEmailHttpResponse>> {
    // Convert EmailSendOptions to HTTP request format
    const request: SendEmailHttpRequest = {
      to: Array.isArray(options.to) ? options.to : options.to ? [options.to] : undefined,
      subject: options.subject,
      body: options.text,
      html: options.html,
      cc: Array.isArray(options.cc) ? options.cc : options.cc ? [options.cc] : undefined,
      bcc: Array.isArray(options.bcc) ? options.bcc : options.bcc ? [options.bcc] : undefined,
    };

    return this.request<SendEmailHttpResponse>("/send-email", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

/**
 * Create Plugin API Client from environment variables
 *
 * Convenience function for plugins that receive configuration via environment
 * variables when spawned by the platform.
 *
 * @example
 * ```typescript
 * const api = createPluginAPIClient();
 * const result = await api.sendEmail({ ... });
 * ```
 */
export function createPluginAPIClient(): PluginAPIClient {
  // Validate required environment variables first
  const missing: string[] = [];
  if (!process.env.PLUGIN_API_URL) missing.push("PLUGIN_API_URL");
  if (!process.env.PLUGIN_ID) missing.push("PLUGIN_ID");
  if (!process.env.ORGANIZATION_ID) missing.push("ORGANIZATION_ID");
  if (!process.env.PLUGIN_API_TOKEN) missing.push("PLUGIN_API_TOKEN");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for Plugin API: ${missing.join(", ")}`,
    );
  }

  // Now we can safely assert non-null since we validated above
  const config: PluginAPIClientConfig = {
    apiUrl: process.env.PLUGIN_API_URL as string,
    pluginId: process.env.PLUGIN_ID as string,
    organizationId: process.env.ORGANIZATION_ID as string,
    apiToken: process.env.PLUGIN_API_TOKEN as string,
  };

  return new PluginAPIClient(config);
}
