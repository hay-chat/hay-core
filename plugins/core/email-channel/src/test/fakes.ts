import { vi } from "vitest";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { ChannelContext, ChannelSettings } from "../context.js";
import { emptyState } from "../context.js";
import type { PluginApi, SendEmailRequest, SendEmailResult } from "../plugin-api.js";
import { ResendClient, type ReceivedEmail } from "../resend.js";

export function fakeLogger(): HayLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as HayLogger;
}

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

export const settings: ChannelSettings = {
  alias: "in-abc123def4@inbound.hay.test",
  inboundDomain: "inbound.hay.test",
  supportAddress: "support@acme.com",
  storeName: "Acme Support",
  fromAddress: "support@updates.hay.test",
  bccArchive: false,
};

/** Resend API fake: serves received emails, attachment lists and downloads by URL. */
export function fakeResend(
  emails: Record<string, ReceivedEmail>,
  files: Record<string, { body: string; type?: string }> = {},
  attachmentLists: Record<string, unknown[]> = {},
) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const emailMatch = url.match(/\/emails\/receiving\/([^/?]+)$/);
    if (emailMatch) {
      const email = emails[decodeURIComponent(emailMatch[1])];
      return email
        ? new Response(JSON.stringify(email), { status: 200 })
        : new Response("not found", { status: 404 });
    }
    const listMatch = url.match(/\/emails\/receiving\/([^/?]+)\/attachments$/);
    if (listMatch) {
      return new Response(
        JSON.stringify({ data: attachmentLists[decodeURIComponent(listMatch[1])] ?? [] }),
        { status: 200 },
      );
    }
    const file = files[url];
    if (file) {
      return new Response(file.body, {
        status: 200,
        headers: { "content-type": file.type ?? "application/octet-stream" },
      });
    }
    return new Response("missing", { status: 404 });
  });
  return {
    client: new ResendClient({
      apiKey: "re_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
    calls,
  };
}

export interface FakeApi extends PluginApi {
  mutations: Array<{ procedure: string; input: Record<string, unknown> }>;
  queries: Array<{ procedure: string; input: Record<string, unknown> }>;
  sent: SendEmailRequest[];
}

export function fakeApi(
  options: {
    receive?: Partial<{
      messageId: string | null;
      conversationId: string;
      processed: boolean;
      deduped: boolean;
    }>;
    messages?: unknown[];
    sendResult?: SendEmailResult;
    sendThrows?: Error;
    queryThrows?: Error;
  } = {},
): FakeApi {
  const api: FakeApi = {
    mutations: [],
    queries: [],
    sent: [],
    async mutation<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
      api.mutations.push({ procedure, input });
      if (procedure === "messages.receive") {
        return {
          messageId: "msg-1",
          conversationId: CONVERSATION_ID,
          processed: true,
          deduped: false,
          ...options.receive,
        } as T;
      }
      if (procedure === "media.upload") {
        return {
          id: "att-1",
          name: input.filename,
          url: `https://cdn.hay.test/${input.filename}`,
          type: input.mimeType,
          size: Buffer.from(String(input.data), "base64").length,
        } as T;
      }
      return {} as T;
    },
    async query<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
      api.queries.push({ procedure, input });
      if (options.queryThrows) {
        throw options.queryThrows;
      }
      return (options.messages ?? []) as T;
    },
    async sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
      api.sent.push(request);
      if (options.sendThrows) {
        throw options.sendThrows;
      }
      return options.sendResult ?? { success: true, messageId: request.messageId };
    },
  };
  return api;
}

export function fakeContext(
  overrides: Partial<ChannelContext> & { settings?: ChannelSettings | null } = {},
): ChannelContext {
  const current = overrides.settings === undefined ? settings : overrides.settings;
  return {
    getSettings: () => current,
    getResend: overrides.getResend ?? (() => null),
    api: overrides.api ?? fakeApi(),
    logger: fakeLogger(),
    state: overrides.state ?? emptyState(),
  };
}

export function receivedEmail(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    id: "email-1",
    from: "Ana Shopper <ana@shopper.com>",
    to: ["support@acme.com"],
    subject: "Where is my order?",
    text: "Hi, order 1234 has not arrived.\n\nThanks,\nAna",
    html: null,
    headers: { "message-id": "<abc@shopper.com>" },
    message_id: "<abc@shopper.com>",
    received_for: ["in-abc123def4@inbound.hay.test"],
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    attachments: [],
    ...overrides,
  };
}
