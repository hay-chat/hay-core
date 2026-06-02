import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Minimal HTTP client for core's plugin-api REST endpoints.
 *
 * The plugin worker receives HAY_API_URL and HAY_API_TOKEN from the plugin
 * runner; we use them to authenticate calls back to the platform. Sending email
 * requires the plugin to declare the "email" capability in its hay-plugin block.
 */
export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  recipients?: string[];
  error?: string;
}

export class PluginApiClient {
  private apiUrl: string;
  private apiToken: string;
  private logger: HayLogger;

  constructor(logger: HayLogger) {
    this.apiUrl = process.env.HAY_API_URL || "";
    this.apiToken = process.env.HAY_API_TOKEN || "";
    this.logger = logger;

    if (!this.apiUrl || !this.apiToken) {
      this.logger.warn("HAY_API_URL/HAY_API_TOKEN not set — email send will fail");
    }
  }

  /** Send an email via the platform's email service (POST /v1/plugin-api/send-email). */
  async sendEmail(input: {
    subject: string;
    body?: string;
    html?: string;
    to?: string[];
  }): Promise<SendEmailResult> {
    const response = await fetch(`${this.apiUrl}/v1/plugin-api/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(input),
    });

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { messageId?: string; recipients?: string[] };
      error?: string;
    };

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return {
      success: true,
      messageId: data.data?.messageId,
      recipients: data.data?.recipients,
    };
  }
}
