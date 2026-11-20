import { PluginApiError, type PluginApi } from "./plugin-api.js";

/**
 * Reads of received mail. The `email.received` webhook carries metadata only;
 * body, headers, authentication results and attachment URLs come from core
 * (plugin API `email.receivedMessage` / `email.receivedAttachments`), which
 * holds the provider key. Signed download URLs are fetched directly.
 */

export interface ReceivedAttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
  content_disposition?: string;
  content_id?: string;
  size?: number;
  download_url?: string;
  expires_at?: string;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, unknown>;
  message_id?: string;
  received_for?: string[];
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  raw?: { download_url: string; expires_at?: string } | null;
  attachments?: ReceivedAttachmentMeta[];
}

export class ResendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResendApiError";
  }
}

export interface ResendClientOptions {
  api: PluginApi;
  fetchImpl?: typeof fetch;
  /** Backoff between retries of a transient API failure (ms). Override for tests. */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Core acks the webhook to Resend before the worker fetches the email, so a
 * transient failure here would lose the mail. Retry 429/5xx (core answers 503
 * while the provider cannot respond) and network errors a few times before
 * giving up; a 404 or other 4xx will not change.
 * TODO: persist the event (BullMQ) so a worker restart mid-fetch is recoverable too.
 */
const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 4000];

function isTransient(error: unknown): boolean {
  if (error instanceof ResendApiError || error instanceof PluginApiError) {
    return error.status === 429 || error.status >= 500;
  }
  return !(error instanceof Error && error.name === "SyntaxError");
}

export class ResendClient {
  private readonly api: PluginApi;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ResendClientOptions) {
    this.api = options.api;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    return this.withRetry(() =>
      this.api.query<ReceivedEmail>("email.receivedMessage", { emailId }),
    );
  }

  async listAttachments(emailId: string): Promise<ReceivedAttachmentMeta[]> {
    const payload = await this.withRetry(() =>
      this.api.query<{ attachments?: ReceivedAttachmentMeta[] }>("email.receivedAttachments", {
        emailId,
      }),
    );
    return payload.attachments ?? [];
  }

  /** Download a signed URL (attachment or raw message). */
  async download(url: string): Promise<{ buffer: Buffer; contentType?: string }> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new ResendApiError(`Download failed: ${response.status}`, response.status);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType: response.headers.get("content-type") ?? undefined };
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error: unknown) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined || !isTransient(error)) {
          throw error;
        }
        await this.sleep(delay);
      }
    }
  }
}
