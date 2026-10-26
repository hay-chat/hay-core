import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * HTTP client for Hay's plugin API. The worker gets HAY_API_URL and
 * HAY_API_TOKEN from the plugin runner and authenticates every call with them.
 */

export interface SendEmailRequest {
  to: string[];
  subject: string;
  body?: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  from?: { email: string; name?: string };
  replyTo?: string;
  headers?: Record<string, string>;
  messageId?: string;
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
  retry?: boolean;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** The slice of the plugin API the handlers use — an interface so tests can fake it. */
export interface PluginApi {
  mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T>;
  query<T>(procedure: string, input: Record<string, unknown>): Promise<T>;
  /** Sends through the platform relay. Resolves with `success:false` on a refused send; throws only when Hay is unreachable. */
  sendEmail(request: SendEmailRequest): Promise<SendEmailResult>;
}

export class PluginApiClient implements PluginApi {
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly logger: HayLogger,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = (process.env.HAY_API_URL || "").replace(/\/$/, "");
    this.apiToken = process.env.HAY_API_TOKEN || "";
    this.fetchImpl = fetchImpl;
    if (!this.apiUrl || !this.apiToken) {
      this.logger.warn("HAY_API_URL / HAY_API_TOKEN not set — plugin API calls will fail");
    }
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiToken}` };
  }

  /** tRPC mutation: raw input as the POST body, result under `result.data`. */
  async mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.apiUrl}/v1/pluginApi.${procedure}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.unwrap<T>(response, procedure);
  }

  /** tRPC query: JSON input in the `input` query parameter. */
  async query<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
    const url = `${this.apiUrl}/v1/pluginApi.${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;
    const response = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
    return this.unwrap<T>(response, procedure);
  }

  async sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
    const response = await this.fetchImpl(`${this.apiUrl}/v1/plugin-api/send-email`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: { messageId?: string };
    };
    if (!response.ok || payload.success === false) {
      return { success: false, error: payload.error ?? `send-email returned ${response.status}` };
    }
    return { success: true, messageId: payload.data?.messageId };
  }

  private async unwrap<T>(response: Response, procedure: string): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Plugin API ${procedure} failed: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { result?: { data?: T } };
    return (data?.result?.data ?? data) as T;
  }
}
