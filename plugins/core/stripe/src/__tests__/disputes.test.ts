/**
 * D2-7: Stripe dispute intake and the evidence DRAFT push, against a mocked
 * Stripe API (no key, no network). The push must never submit and never
 * replace a file the merchant added.
 */
import { describe, it, expect, vi } from "vitest";
import {
  attachEvidence,
  createStripeClient,
  disputeIdFromEvent,
  ensureWebhookEndpoint,
  mergeNote,
  syncRecentDisputes,
  toCanonical,
  webhookUrl,
} from "../disputes.js";

const PREFIX = "hay-chat-evidence";

function dispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "dp_1",
    object: "dispute",
    status: "needs_response",
    amount: 4250,
    currency: "usd",
    reason: "product_not_received",
    created: 1_790_000_000,
    livemode: false,
    evidence_details: { due_by: 1_790_900_000, past_due: false },
    evidence: { customer_communication: null, uncategorized_file: null, uncategorized_text: null },
    charge: { id: "ch_1", description: "Order #1001", metadata: { order_id: "5550001" } },
    payment_intent: { id: "pi_1", metadata: { order_number: "1001" } },
    ...overrides,
  };
}

type Call = { url: string; method: string; body: unknown };

/** A tiny Stripe stand-in: routes by method + path, records every call. */
function mockStripe(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call = { url, method, body: init?.body };
    calls.push(call);
    const path = new URL(url).pathname;
    const handler = routes[`${method} ${path}`];
    if (!handler) {
      return new Response(JSON.stringify({ error: { message: "No such route" } }), { status: 404 });
    }
    return new Response(JSON.stringify(handler(call)), { status: 200 });
  });
  return {
    client: createStripeClient("sk_test_mock", fetchImpl as unknown as typeof fetch),
    calls,
  };
}

const form = (body: unknown) => new URLSearchParams(String(body));

const request = {
  disputeId: "dp_1",
  file: { name: `${PREFIX}-1001-2026-10-28.pdf`, mimeType: "application/pdf", base64: "JVBERi0=" },
  text: "[Hay.chat] The attached file holds 2 conversations.",
  marker: "[Hay.chat]",
};

describe("Stripe dispute intake", () => {
  it("normalizes a dispute with order refs, amount and deadline", () => {
    expect(toCanonical(dispute())).toEqual({
      externalId: "dp_1",
      status: "needs_response",
      amount: "42.50",
      currency: "USD",
      reason: "product_not_received",
      evidenceDueBy: new Date(1_790_900_000 * 1000).toISOString(),
      initiatedAt: new Date(1_790_000_000 * 1000).toISOString(),
      orderRefs: ["5550001", "1001"],
      orderLabel: "#1001",
      providerUrl: "https://dashboard.stripe.com/test/disputes/dp_1",
    });
    expect(
      toCanonical(dispute({ status: "warning_closed", amount: 500, currency: "jpy" })),
    ).toMatchObject({
      status: "closed",
      amount: "500",
    });
  });

  it("reads dispute ids only from dispute events", () => {
    expect(
      disputeIdFromEvent({ type: "charge.dispute.created", data: { object: { id: "dp_9" } } }),
    ).toBe("dp_9");
    expect(
      disputeIdFromEvent({ type: "charge.succeeded", data: { object: { id: "ch_1" } } }),
    ).toBeNull();
    expect(
      disputeIdFromEvent({ type: "charge.dispute.created", data: { object: { id: "../x" } } }),
    ).toBeNull();
  });

  it("registers the webhook only for a public https API", () => {
    expect(webhookUrl("http://localhost:3001", "stripe", "org")).toBeNull();
    expect(webhookUrl("https://api.hay.chat", "stripe", "org-1")).toBe(
      "https://api.hay.chat/v1/plugins/stripe/webhook?organizationId=org-1",
    );
  });

  it("creates the endpoint once and leaves an existing one alone", async () => {
    const url = "https://api.hay.chat/v1/plugins/stripe/webhook?organizationId=org-1";
    const fresh = mockStripe({
      "GET /v1/webhook_endpoints": () => ({ data: [] }),
      "POST /v1/webhook_endpoints": () => ({ id: "we_1" }),
    });
    expect(await ensureWebhookEndpoint(fresh.client, url, "org-1")).toBe("created");
    const created = form(fresh.calls[1].body);
    expect(created.get("url")).toBe(url);
    expect(created.getAll("enabled_events[]")).toContain("charge.dispute.created");

    const existing = mockStripe({
      "GET /v1/webhook_endpoints": () => ({
        data: [
          {
            id: "we_1",
            url,
            status: "enabled",
            enabled_events: [
              "charge.dispute.created",
              "charge.dispute.updated",
              "charge.dispute.closed",
              "charge.dispute.funds_withdrawn",
            ],
          },
        ],
      }),
    });
    expect(await ensureWebhookEndpoint(existing.client, url, "org-1")).toBe("exists");
    expect(existing.calls).toHaveLength(1);
  });

  it("syncs recent disputes through the reporter", async () => {
    const { client, calls } = mockStripe({
      "GET /v1/disputes": () => ({ data: [dispute(), dispute({ id: "dp_2", status: "won" })] }),
    });
    const report = vi.fn(async () => ({ created: true }));
    expect(await syncRecentDisputes(client, report, new Date("2026-10-28T00:00:00Z"))).toBe(2);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "dp_2", status: "won" }),
    );
    expect(new URL(calls[0].url).searchParams.get("created[gte]")).toBeTruthy();
  });
});

describe("Stripe evidence draft", () => {
  it("uploads the file and fills evidence with submit=false", async () => {
    const { client, calls } = mockStripe({
      "GET /v1/disputes/dp_1": () =>
        dispute({ evidence: { uncategorized_text: "Merchant note." } }),
      "POST /v1/files": () => ({ id: "file_1", filename: request.file.name }),
      "POST /v1/disputes/dp_1": () => ({ id: "dp_1" }),
    });
    const result = await attachEvidence(client, request, PREFIX);
    expect(result).toEqual({
      ok: true,
      providerUrl: "https://dashboard.stripe.com/test/disputes/dp_1",
    });

    const upload = calls.find((c) => c.url.startsWith("https://files.stripe.com"))!;
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get("purpose")).toBe("dispute_evidence");

    const update = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/disputes/dp_1"))!;
    const params = form(update.body);
    expect(params.get("submit")).toBe("false");
    expect(params.get("evidence[customer_communication]")).toBe("file_1");
    expect(params.get("evidence[uncategorized_text]")).toBe(`Merchant note.\n\n${request.text}`);
    expect([...params.keys()].some((k) => k.startsWith("evidence[") && k.includes("submit"))).toBe(
      false,
    );
  });

  it("replaces its own earlier file but falls back when the merchant's file is there", async () => {
    const own = mockStripe({
      "GET /v1/disputes/dp_1": () => dispute({ evidence: { customer_communication: "file_old" } }),
      "GET /v1/files/file_old": () => ({
        id: "file_old",
        filename: `${PREFIX}-1001-2026-10-01.pdf`,
      }),
      "POST /v1/files": () => ({ id: "file_new" }),
      "POST /v1/disputes/dp_1": () => ({ id: "dp_1" }),
    });
    await attachEvidence(own.client, request, PREFIX);
    expect(form(own.calls.at(-1)!.body).get("evidence[customer_communication]")).toBe("file_new");

    const merchant = mockStripe({
      "GET /v1/disputes/dp_1": () => dispute({ evidence: { customer_communication: "file_m" } }),
      "GET /v1/files/file_m": () => ({ id: "file_m", filename: "chat-export.pdf" }),
      "POST /v1/files": () => ({ id: "file_new" }),
      "POST /v1/disputes/dp_1": () => ({ id: "dp_1" }),
    });
    await attachEvidence(merchant.client, request, PREFIX);
    const params = form(merchant.calls.at(-1)!.body);
    expect(params.get("evidence[customer_communication]")).toBeNull();
    expect(params.get("evidence[uncategorized_file]")).toBe("file_new");
  });

  it("refuses when every slot holds merchant files, or the dispute is past responding", async () => {
    const full = mockStripe({
      "GET /v1/disputes/dp_1": () =>
        dispute({ evidence: { customer_communication: "file_a", uncategorized_file: "file_b" } }),
      "GET /v1/files/file_a": () => ({ id: "file_a", filename: "a.pdf" }),
      "GET /v1/files/file_b": () => ({ id: "file_b", filename: "b.pdf" }),
    });
    expect(await attachEvidence(full.client, request, PREFIX)).toMatchObject({
      ok: false,
      code: "SLOT_TAKEN",
    });
    expect(full.calls.some((c) => c.method === "POST")).toBe(false);

    const submitted = mockStripe({
      "GET /v1/disputes/dp_1": () => dispute({ status: "under_review" }),
    });
    expect(await attachEvidence(submitted.client, request, PREFIX)).toMatchObject({
      ok: false,
      code: "NOT_EDITABLE",
    });
    expect(submitted.calls.some((c) => c.method === "POST")).toBe(false);

    const missing = mockStripe({});
    expect(await attachEvidence(missing.client, request, PREFIX)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("replaces its own note in place and keeps the merchant's text", () => {
    const marker = "[Hay.chat]";
    expect(mergeNote(null, `${marker} new`, marker)).toBe(`${marker} new`);
    expect(mergeNote(`Mine.\n\n${marker} old\n\nAlso mine.`, `${marker} new`, marker)).toBe(
      `Mine.\n\n${marker} new\n\nAlso mine.`,
    );
  });
});
