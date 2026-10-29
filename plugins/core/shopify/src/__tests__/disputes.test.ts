/**
 * D2-8: Shopify Payments dispute intake and the evidence attach, against a
 * mocked Admin API (no token, no network). The attach must never submit and
 * never replace a file the merchant added.
 */
import { describe, it, expect, vi } from "vitest";
import {
  attachEvidence,
  createShopifyClient,
  DISPUTE_SHOW,
  disputeIdFromWebhook,
  ensureWebhooks,
  mergeNote,
  syncRecentDisputes,
  toCanonical,
  webhookUrl,
} from "../disputes.js";

const SHOP = "acme.myshopify.com";
const PREFIX = "hay-chat-evidence";
const GID = "gid://shopify/ShopifyPaymentsDispute/777";

function dispute(overrides: Record<string, unknown> = {}) {
  return {
    id: GID,
    legacyResourceId: "777",
    status: "NEEDS_RESPONSE",
    type: "CHARGEBACK",
    initiatedAt: "2026-10-20T10:00:00Z",
    evidenceDueBy: "2099-11-05T23:59:59Z",
    evidenceSentOn: null,
    amount: { amount: "42.5", currencyCode: "USD" },
    reasonDetails: { reason: "PRODUCT_NOT_RECEIVED", networkReasonCode: "13.1" },
    order: { id: "gid://shopify/Order/5550001", name: "#1001", legacyResourceId: "5550001" },
    disputeEvidence: {
      id: "gid://shopify/ShopifyPaymentsDisputeEvidence/9",
      uncategorizedText: null,
      customerCommunicationFile: null,
      uncategorizedFile: null,
    },
    ...overrides,
  };
}

type Call = { url: string; body: any };

/** A tiny Admin API stand-in: GraphQL routed by operation name, REST by path. */
function mockShopify(
  graphql: Record<string, (variables: any) => unknown>,
  rest: Record<string, (body: any) => { status?: number; json: unknown }> = {},
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body });
    const path = new URL(url).pathname.replace("/admin/api/2026-04", "");
    if (path === "/graphql.json") {
      const op = /(?:query|mutation) (\w+)/.exec(body.query)?.[1] ?? "";
      const handler = graphql[op];
      if (!handler) {
        return new Response(
          JSON.stringify({
            errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }],
          }),
        );
      }
      return new Response(JSON.stringify({ data: handler(body.variables) }));
    }
    const handler = rest[path];
    if (!handler) return new Response(JSON.stringify({ errors: "Not Found" }), { status: 404 });
    const { status = 200, json } = handler(body);
    return new Response(JSON.stringify(json), { status });
  });
  return {
    client: createShopifyClient(SHOP, "shpat_mock", "2026-04", fetchImpl as unknown as typeof fetch),
    calls,
    gql: () => calls.filter((c) => c.url.endsWith("/graphql.json")),
  };
}

const request = {
  disputeId: GID,
  file: { name: `${PREFIX}-1001-2026-10-28.pdf`, mimeType: "application/pdf", base64: "JVBERi0=" },
  text: "[Hay.chat] The attached file holds 2 conversations.",
  marker: "[Hay.chat]",
};

const UPLOAD_PATH = "/shopify_payments/disputes/777/dispute_file_uploads.json";

describe("Shopify dispute intake", () => {
  it("normalizes a dispute with order refs, amount, reason and deadline", () => {
    expect(toCanonical(SHOP, dispute())).toEqual({
      externalId: GID,
      status: "needs_response",
      amount: "42.5",
      currency: "USD",
      reason: "product_not_received",
      evidenceDueBy: "2099-11-05T23:59:59Z",
      initiatedAt: "2026-10-20T10:00:00Z",
      orderRefs: ["5550001", "1001"],
      orderLabel: "#1001",
      providerUrl: `https://${SHOP}/admin/orders/5550001`,
    });
    expect(toCanonical(SHOP, dispute({ status: "ACCEPTED", order: null }))).toMatchObject({
      status: "closed",
      orderRefs: undefined,
    });
  });

  it("reads a dispute without the protected evidence fields", () => {
    // Only dispute-management apps get the evidence scopes; asking for them fails the query.
    expect(DISPUTE_SHOW).not.toContain("disputeEvidence");
  });

  it("turns a webhook body into a dispute gid and rejects anything else", () => {
    expect(disputeIdFromWebhook({ id: 777 })).toBe(GID);
    expect(disputeIdFromWebhook({ id: "777" })).toBe(GID);
    expect(disputeIdFromWebhook({ id: "../x" })).toBeNull();
    expect(disputeIdFromWebhook({})).toBeNull();
  });

  it("subscribes webhooks only for a public https API, once per topic", async () => {
    expect(webhookUrl("http://localhost:3001", "shopify", "org")).toBeNull();
    const url = webhookUrl("https://api.hay.chat", "shopify", "org-1")!;
    expect(url).toBe("https://api.hay.chat/v1/plugins/shopify/webhook?organizationId=org-1");

    const topics: string[] = [];
    const { client } = mockShopify({
      DisputeWebhooks: () => ({
        webhookSubscriptions: { nodes: [{ id: "w1", topic: "DISPUTES_CREATE", uri: url }] },
      }),
      DisputeWebhookCreate: (v) => {
        topics.push(v.topic);
        return { webhookSubscriptionCreate: { webhookSubscription: { id: "w2" }, userErrors: [] } };
      },
    });
    expect(await ensureWebhooks(client, url)).toBe(1);
    expect(topics).toEqual(["DISPUTES_UPDATE"]);
  });

  it("syncs recent disputes through the reporter", async () => {
    const { client, gql } = mockShopify({
      DisputeList: () => ({
        disputes: { nodes: [dispute(), dispute({ id: "gid://x/2", status: "WON" })] },
      }),
    });
    const report = vi.fn(async () => ({ created: true }));
    expect(await syncRecentDisputes(client, report, new Date("2026-10-28T00:00:00Z"))).toBe(2);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "won" }));
    expect(gql()[0].body.variables.query).toBe("initiated_at:>=2026-06-30");
  });
});

describe("Shopify evidence attach", () => {
  it("uploads the file and fills evidence, never submitting", async () => {
    const attach = vi.fn((_v: any) => ({
      disputeEvidenceUpdate: { disputeEvidence: { id: "e" }, userErrors: [] },
    }));
    const { client, calls } = mockShopify(
      {
        DisputeEvidenceShow: () => ({
          dispute: dispute({
            disputeEvidence: { ...dispute().disputeEvidence, uncategorizedText: "Merchant note." },
          }),
        }),
        DisputeEvidenceAttach: attach,
      },
      { [UPLOAD_PATH]: () => ({ json: { dispute_file_upload: { id: 4242 } } }) },
    );
    expect(await attachEvidence(client, request, PREFIX)).toEqual({
      ok: true,
      providerUrl: `https://${SHOP}/admin/orders/5550001`,
    });

    const upload = calls.find((c) => c.url.endsWith(UPLOAD_PATH))!;
    expect(upload.body.dispute_file_upload).toMatchObject({
      document_type: "customer_communication_file",
      filename: request.file.name,
      data: request.file.base64,
    });
    const { id, input } = attach.mock.calls[0][0];
    expect(id).toBe("gid://shopify/ShopifyPaymentsDisputeEvidence/9");
    expect(input).toEqual({
      customerCommunicationFile: { id: "gid://shopify/ShopifyPaymentsDisputeFileUpload/4242" },
      uncategorizedText: `Merchant note.\n\n${request.text}`,
    });
    expect(input).not.toHaveProperty("submitEvidence");
  });

  it("replaces its own earlier file but falls back when the merchant's file is there", async () => {
    const run = async (fileName: string) => {
      const attach = vi.fn((_v: any) => ({ disputeEvidenceUpdate: { userErrors: [] } }));
      const uploads: string[] = [];
      const { client } = mockShopify(
        {
          DisputeEvidenceShow: () => ({
            dispute: dispute({
              disputeEvidence: {
                ...dispute().disputeEvidence,
                customerCommunicationFile: { id: "f1", originalFileName: fileName },
              },
            }),
          }),
          DisputeEvidenceAttach: attach,
        },
        {
          [UPLOAD_PATH]: (b) => {
            uploads.push(b.dispute_file_upload.document_type);
            return { json: { dispute_file_upload: { id: 1 } } };
          },
        },
      );
      await attachEvidence(client, request, PREFIX);
      return { uploads, input: attach.mock.calls[0][0].input };
    };

    const own = await run(`${PREFIX}-1001-2026-10-01.pdf`);
    expect(own.uploads).toEqual(["customer_communication_file"]);
    expect(own.input).toHaveProperty("customerCommunicationFile");

    const merchant = await run("chat-export.pdf");
    expect(merchant.uploads).toEqual(["uncategorized_file"]);
    expect(merchant.input).not.toHaveProperty("customerCommunicationFile");
    expect(merchant.input).toHaveProperty("uncategorizedFile");
  });

  it("refuses full slots, decided disputes and missing scopes without writing", async () => {
    const full = mockShopify({
      DisputeEvidenceShow: () => ({
        dispute: dispute({
          disputeEvidence: {
            ...dispute().disputeEvidence,
            customerCommunicationFile: { id: "a", originalFileName: "a.pdf" },
            uncategorizedFile: { id: "b", originalFileName: "b.pdf" },
          },
        }),
      }),
    });
    expect(await attachEvidence(full.client, request, PREFIX)).toMatchObject({
      ok: false,
      code: "SLOT_TAKEN",
    });
    expect(full.calls).toHaveLength(1);

    for (const overrides of [
      { status: "UNDER_REVIEW" },
      { evidenceSentOn: "2026-10-25" },
      { evidenceDueBy: "2020-01-01T00:00:00Z" },
    ]) {
      const decided = mockShopify({ DisputeEvidenceShow: () => ({ dispute: dispute(overrides) }) });
      expect(await attachEvidence(decided.client, request, PREFIX)).toMatchObject({
        ok: false,
        code: "NOT_EDITABLE",
      });
      expect(decided.calls).toHaveLength(1);
    }

    const noScope = mockShopify({});
    expect(await attachEvidence(noScope.client, request, PREFIX)).toMatchObject({
      ok: false,
      code: "SCOPE_MISSING",
    });

    const missing = mockShopify({ DisputeEvidenceShow: () => ({ dispute: null }) });
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
