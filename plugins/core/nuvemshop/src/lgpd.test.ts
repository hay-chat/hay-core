import { describe, expect, it, vi } from "vitest";
import { classifyLgpdWebhook, handleLgpdWebhook, type LgpdDeps } from "./lgpd.js";

// Payloads as documented (resources/webhook → LGPD).
const STORE_REDACT = { store_id: 789 };
const CUSTOMERS_REDACT = {
  store_id: 789,
  customer: { id: 1, email: "a@b.com", phone: "+5511999999999", identification: "123" },
  orders_to_redact: [213, 3415, 21515],
};
const DATA_REQUEST = {
  store_id: 789,
  customer: { id: 1, email: "a@b.com", phone: "+5511999999999", identification: "123" },
  orders_requested: [213, 3415],
  checkouts_requested: [214],
  drafts_orders_requested: [10],
  data_request: { id: 456 },
};

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

function deps(overrides: Partial<LgpdDeps> = {}): LgpdDeps {
  return {
    storeId: () => "789",
    revokeConnection: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

const verified = { "x-hay-webhook-verified": "true" };

describe("classifyLgpdWebhook", () => {
  it("reads the kind from the body shape", () => {
    expect(classifyLgpdWebhook(STORE_REDACT)).toBe("store/redact");
    expect(classifyLgpdWebhook(CUSTOMERS_REDACT)).toBe("customers/redact");
    expect(classifyLgpdWebhook(DATA_REQUEST)).toBe("customers/data_request");
  });

  it("ignores regular store webhooks and junk", () => {
    expect(classifyLgpdWebhook({ store_id: 789, event: "app/uninstalled", id: 1 })).toBeNull();
    expect(classifyLgpdWebhook({ customer: {} })).toBeNull();
    expect(classifyLgpdWebhook(null)).toBeNull();
    expect(classifyLgpdWebhook([STORE_REDACT])).toBeNull();
  });
});

describe("handleLgpdWebhook", () => {
  it("rejects a request core did not verify", async () => {
    const d = deps();
    const res = response();
    await handleLgpdWebhook({ headers: {}, body: STORE_REDACT }, res, d);
    expect(res.statusCode).toBe(401);
    expect(d.revokeConnection).not.toHaveBeenCalled();
  });

  it("store/redact disconnects the store", async () => {
    const d = deps();
    const res = response();
    await handleLgpdWebhook({ headers: verified, body: STORE_REDACT }, res, d);
    expect(d.revokeConnection).toHaveBeenCalledWith("nuvemshop store/redact");
    expect(res.statusCode).toBe(200);
  });

  it("store/redact answers 500 when the disconnect fails, so Nuvemshop retries", async () => {
    const d = deps({ revokeConnection: vi.fn(async () => Promise.reject(new Error("down"))) });
    const res = response();
    await handleLgpdWebhook({ headers: verified, body: STORE_REDACT }, res, d);
    expect(res.statusCode).toBe(500);
  });

  it("ignores a body for another store", async () => {
    const d = deps({ storeId: () => "111" });
    const res = response();
    await handleLgpdWebhook({ headers: verified, body: STORE_REDACT }, res, d);
    expect(d.revokeConnection).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["customers/redact", CUSTOMERS_REDACT],
    ["customers/data_request", DATA_REQUEST],
  ])("%s is acknowledged and logged without personal data", async (_kind, body) => {
    const d = deps();
    const res = response();
    await handleLgpdWebhook({ headers: verified, body }, res, d);
    expect(res.statusCode).toBe(200);
    expect(d.revokeConnection).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(d.logger.info).mock.calls);
    expect(logged).toContain('"customerId":1');
    expect(logged).not.toContain("a@b.com");
    expect(logged).not.toContain("5511999999999");
  });

  it("acknowledges non-LGPD bodies without acting", async () => {
    const d = deps();
    const res = response();
    await handleLgpdWebhook(
      { headers: verified, body: { store_id: 789, event: "order/created", id: 1 } },
      res,
      d,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, handled: false });
  });
});
