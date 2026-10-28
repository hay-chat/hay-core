import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Simple HTTP client for calling the main server's plugin-api tRPC endpoints.
 *
 * The plugin worker receives HAY_API_URL and HAY_API_TOKEN env vars from the
 * plugin-runner service. These are used to authenticate requests back to the
 * main server.
 */
export class PluginApiClient {
  private apiUrl: string;
  private apiToken: string;
  private logger: HayLogger;

  constructor(logger: HayLogger) {
    this.apiUrl = process.env.HAY_API_URL || "";
    this.apiToken = process.env.HAY_API_TOKEN || "";
    this.logger = logger;

    if (!this.apiUrl) {
      this.logger.warn("HAY_API_URL not set — plugin API calls will fail");
    }
    if (!this.apiToken) {
      this.logger.warn("HAY_API_TOKEN not set — plugin API calls will fail");
    }
  }

  /**
   * Call a tRPC mutation on the plugin API.
   * tRPC without a data transformer expects raw input as the POST body.
   * Response format: { result: { data: { ...output } } }
   */
  async mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
    const url = `${this.apiUrl}/v1/pluginApi.${procedure}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Plugin API call failed: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();

    // tRPC wraps results in { result: { data: { ...output } } }
    if (data?.result?.data) {
      return data.result.data as T;
    }

    return data as T;
  }
}
