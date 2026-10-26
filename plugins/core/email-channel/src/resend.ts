/**
 * Minimal client for Resend's receiving API. The `email.received` webhook
 * carries metadata only; body, headers, authentication results and
 * attachment URLs come from these calls.
 *
 * Endpoints (Resend "Receiving" docs, verify during rollout):
 *   GET /emails/receiving/:id              → full received email
 *   GET /emails/receiving/:id/attachments  → attachment list with signed URLs (1 h)
 */

export const RESEND_API_BASE = "https://api.resend.com";

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
  bcc?: string[];
  reply_to?: string[];
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
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class ResendClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: ResendClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? RESEND_API_BASE).replace(/\/$/, "");
  }

  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    return this.getJson<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(emailId)}`);
  }

  async listAttachments(emailId: string): Promise<ReceivedAttachmentMeta[]> {
    const payload = await this.getJson<
      ReceivedAttachmentMeta[] | { data?: ReceivedAttachmentMeta[] }
    >(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`);
    return Array.isArray(payload) ? payload : (payload.data ?? []);
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

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ResendApiError(
        `Resend ${path} returned ${response.status}: ${text}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }
}
