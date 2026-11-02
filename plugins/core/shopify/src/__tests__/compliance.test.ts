import { describe, expect, it, vi } from "vitest";
import { complianceTopic, handleComplianceWebhook, type ComplianceDeps } from "../compliance.js";

// Payloads as documented (apps/build/compliance/privacy-law-compliance).
const SHOP = "hay-test.myshopify.com";
const CUSTOMERS_REDACT = {
  shop_id: 954889,
  shop_domain: SHOP,
  customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
  orders_to_redact: [299938, 280263],
};
const DATA_REQUEST = {
  shop_id: 954889,
  shop_domain: SHOP,
  orders_requested: [299938],
  customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
  data_request: { id: 9999 },
};
const SHOP_REDACT = { shop_id: 954889, shop_domain: SHOP };

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return {
        json(body: unknown) {
          res.body = body;
        },
      };
    },
  };
  return res;
}

function deps(overrides: Partial<ComplianceDeps> = {}): ComplianceDeps {
  return {
    shopDomain: () => SHOP,
    revokeConnection: vi.fn(async () => {}),
    requestPrivacy: vi.fn(async () => ({ matched: 1 })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

const headers = (topic: string) => ({ "x-hay-webhook-verified": "true", "x-shopify-topic": topic });

describe("complianceTopic", () => {
  it("reads the three compliance topics and nothing else", () => {
    expect(complianceTopic({ "x-shopify-topic": "customers/redact" })).toBe("customers/redact");
    expect(complianceTopic({ "x-shopify-topic": "shop/redact" })).toBe("shop/redact");
    expect(complianceTopic({ "x-shopify-topic": "customers/data_request" })).toBe(
      "customers/data_request",
    );
    expect(complianceTopic({ "x-shopify-topic": "disputes/create" })).toBeNull();
    expect(complianceTopic({})).toBeNull();
  });
});

describe("handleComplianceWebhook", () => {
  it("rejects a request core did not verify", async () => {
    const d = deps();
    const res = response();
    await handleComplianceWebhook(
      "customers/redact",
      { headers: { "x-shopify-topic": "customers/redact" }, body: CUSTOMERS_REDACT },
      res,
      d,
    );
    expect(res.statusCode).toBe(401);
    expect(d.requestPrivacy).not.toHaveBeenCalled();
  });

  it("customers/redact asks core to erase the shopper", async () => {
    const d = deps();
    const res = response();
    await handleComplianceWebhook(
      "customers/redact",
      { headers: headers("customers/redact"), body: CUSTOMERS_REDACT },
      res,
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(d.requestPrivacy).toHaveBeenCalledWith("erase", {
      emails: ["john@example.com"],
      phones: ["555-625-1199"],
      reference: "shopify:customer:191167",
    });
    expect(JSON.stringify(vi.mocked(d.logger.info).mock.calls)).not.toContain("john@example.com");
  });

  it("customers/data_request asks core for an export", async () => {
    const d = deps();
    const res = response();
    await handleComplianceWebhook(
      "customers/data_request",
      { headers: headers("customers/data_request"), body: DATA_REQUEST },
      res,
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(d.requestPrivacy).toHaveBeenCalledWith("export", {
      emails: ["john@example.com"],
      phones: ["555-625-1199"],
      reference: "shopify:data_request:9999",
    });
  });

  it("shop/redact disconnects the shop", async () => {
    const d = deps();
    const res = response();
    await handleComplianceWebhook(
      "shop/redact",
      { headers: headers("shop/redact"), body: SHOP_REDACT },
      res,
      d,
    );
    expect(d.revokeConnection).toHaveBeenCalledWith("shopify shop/redact");
    expect(res.statusCode).toBe(200);
  });

  it("answers 500 when core fails, so Shopify retries", async () => {
    const d = deps({ requestPrivacy: vi.fn(async () => Promise.reject(new Error("down"))) });
    const res = response();
    await handleComplianceWebhook(
      "customers/redact",
      { headers: headers("customers/redact"), body: CUSTOMERS_REDACT },
      res,
      d,
    );
    expect(res.statusCode).toBe(500);
  });

  it("ignores a body for another shop", async () => {
    const d = deps({ shopDomain: () => "other.myshopify.com" });
    const res = response();
    await handleComplianceWebhook(
      "shop/redact",
      { headers: headers("shop/redact"), body: SHOP_REDACT },
      res,
      d,
    );
    expect(d.revokeConnection).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
