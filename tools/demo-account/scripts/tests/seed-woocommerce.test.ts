import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCustomers, loadOrders, loadProducts, type Flags } from "../lib/data";
import type { OrderFixture } from "../lib/types";
import { backdateCommand, run, seedWooCommerce } from "../seed-woocommerce";
import { createWoo } from "../woocommerce/client";
import {
  KEY_META,
  TRACKING_META,
  orderNotes,
  orderPayload,
  productPayload,
  refundPayload,
  variationPayload,
} from "../woocommerce/mapping";

// The plugin's own readers: seeded data must be read back the way Hay.chat reads it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginOrders = require("../../../../plugins/core/woocommerce/mcp/lib/orders.js");

const NOW = new Date("2026-10-29T12:00:00Z");
const products = loadProducts();
const customers = loadCustomers("woocommerce");
const fixtures = loadOrders("woocommerce");
const fixture = (key: string) => fixtures.find((f) => f.key === key) as OrderFixture;
const flags = (over: Partial<Flags> = {}): Flags => ({
  dryRun: false,
  only: new Set(),
  orderKeys: new Set(),
  ...over,
});

function payloadFor(key: string) {
  const f = fixture(key);
  const customer = customers.find((c) => c.key === f.customer.woocommerce)!;
  return orderPayload(f, {
    customer,
    customerId: 7,
    products,
    lineRef: () => ({ product_id: 1, variation_id: 2 }),
    now: NOW,
  });
}

/** A Woo order as the API would return it after creating `payload` (enough for the plugin). */
function asWooOrder(payload: Record<string, unknown>) {
  const paid = payload.set_paid === true;
  return {
    id: 1,
    number: "1",
    status: payload.status,
    currency: payload.currency,
    total: "50.00",
    date_paid: paid ? NOW.toISOString() : null,
    payment_method: payload.payment_method,
    shipping: payload.shipping,
    billing: payload.billing,
    meta_data: payload.meta_data,
    line_items: [],
    refunds: [],
  };
}

function trackingOf(order: { meta_data: Array<{ key: string; value: unknown }> }) {
  const items = order.meta_data.find((m) => m.key === TRACKING_META)?.value as
    | unknown[]
    | undefined;
  return (items ?? []).map((i) =>
    pluginOrders.normalizeTrackingItem({ ...(i as object), __source: "meta" }),
  );
}

describe("WooCommerce order mapping per state", () => {
  it("paid, unshipped: processing, paid by card, still cancellable and address-changeable", () => {
    const p = payloadFor("paid-unfulfilled");
    expect(p).toMatchObject({
      status: "processing",
      set_paid: true,
      currency: "EUR",
      payment_method: "stripe",
    });
    expect(p.meta_data).toEqual([{ key: KEY_META, value: "paid-unfulfilled" }]);
    const summary = pluginOrders.enrichOrder(asWooOrder(p), [], {
      now: NOW.getTime(),
    }).supportSummary;
    expect(summary.isCancellable).toBe(true);
    expect(summary.addressChangeable).toBe(true);
  });

  it("customer note goes to customer_note", () => {
    expect(payloadFor("address-change").customer_note).toBe("please leave with the doorman.");
  });

  it("bank transfer waiting: on-hold, bacs, not paid, refunds would be offline", () => {
    const p = payloadFor("pending-payment");
    expect(p).toMatchObject({ status: "on-hold", set_paid: false, payment_method: "bacs" });
    expect(p.transaction_id).toBeUndefined();
    const summary = pluginOrders.enrichOrder(asWooOrder(p), [], {
      now: NOW.getTime(),
    }).supportSummary;
    expect(summary.gatewayCanRefund).toBe(false);
    expect(summary.isRefundable).toBe(false);
  });

  it("cancelled unpaid: created cancelled, never paid", () => {
    expect(payloadFor("cancelled-unpaid")).toMatchObject({
      status: "cancelled",
      set_paid: false,
      payment_method: "bacs",
    });
  });

  it("in transit: processing with Shipment Tracking meta dated 2 days ago, not stale", () => {
    const p = payloadFor("in-transit");
    expect(p.status).toBe("processing");
    const order = asWooOrder(p) as { meta_data: Array<{ key: string; value: unknown }> };
    const tracking = trackingOf(order);
    expect(tracking).toHaveLength(1);
    expect(tracking[0]).toMatchObject({
      carrier: "CTT",
      trackingNumber: expect.stringMatching(/^DEMO\d{12}$/),
    });
    expect(tracking[0].trackingUrl).toContain(tracking[0].trackingNumber);
    expect(Date.parse(tracking[0].shippedAt)).toBeCloseTo(NOW.getTime() - 2 * 86400e3, -4);
    const summary = pluginOrders.enrichOrder(order, tracking, {
      originCountry: "PT",
      now: NOW.getTime(),
    }).supportSummary;
    expect(summary.isCancellable).toBe(false);
    expect(summary.tracking.isStale).toBe(false);
  });

  it("stale: shipped 12 days ago with nothing after, flagged stale by the plugin", () => {
    const order = asWooOrder(payloadFor("stale-tracking")) as {
      meta_data: Array<{ key: string; value: unknown }>;
    };
    const tracking = trackingOf(order);
    expect(tracking[0].carrier).toBe("DPD");
    const summary = pluginOrders.enrichOrder(order, tracking, {
      originCountry: "PT",
      now: NOW.getTime(),
    }).supportSummary;
    expect(summary.tracking.isStale).toBe(true);
    expect(
      orderNotes(fixture("stale-tracking"), {
        customer: customers.find((c) => c.key === "eu-pierre")!,
        now: NOW,
      }),
    ).toHaveLength(1);
  });

  it("delivered: completed + shipped note the plugin parses + 'Delivered on' note", () => {
    const f = fixture("delivered");
    expect(payloadFor("delivered").status).toBe("completed");
    const notes = orderNotes(f, {
      customer: customers.find((c) => c.key === f.customer.woocommerce)!,
      now: NOW,
    });
    expect(notes.map((n) => n.customer_note)).toEqual([true, false]);
    expect(pluginOrders.trackingNumberInNote(notes[0].note)).toMatch(/^DEMO\d{12}$/);
    expect(notes[0].note).toContain("https://");
    expect(notes[1].note).toBe("Delivered on 2026-10-24 (carrier confirmation).");
  });

  it("full refund: record only (api_refund false) for the whole total", () => {
    expect(refundPayload(fixture("refunded"), { total: "39.00" })).toMatchObject({
      amount: "39.00",
      api_refund: false,
    });
  });

  it("partial refund: only the broken line item, record only", () => {
    const order = {
      total: "51.90",
      line_items: [
        { id: 11, sku: "CA-CND-001-SAN", quantity: 1, total: "29.00" },
        { id: 12, sku: "CA-POT-001-TER", quantity: 1, total: "19.00" },
      ],
    };
    expect(refundPayload(fixture("partially-refunded"), order)).toMatchObject({
      amount: "19.00",
      api_refund: false,
      line_items: [{ id: 12, quantity: 1, refund_total: 19 }],
    });
    expect(refundPayload(fixture("delivered"), order)).toBeNull();
  });
});

describe("WooCommerce product mapping", () => {
  it("variable product with attributes and variations; sale price from compareAtPrice", () => {
    const candle = products.find((p) => p.handle === "aurora-soy-candle")!;
    const p = productPayload(candle, {
      categoryId: 3,
      tagIds: [4],
      images: [{ src: "https://x/a.png" }],
    });
    expect(p).toMatchObject({
      type: "variable",
      slug: "aurora-soy-candle",
      weight: "0.480",
      categories: [{ id: 3 }],
    });
    expect((p.attributes as Array<{ options: string[] }>)[0].options).toEqual([
      "Sandalwood",
      "Fig",
      "Orange Blossom",
      "Eucalyptus",
    ]);
    expect(variationPayload(candle, candle.variants[1])).toMatchObject({
      sku: "CA-CND-001-FIG",
      regular_price: "29.00",
      sale_price: "",
      stock_quantity: 25,
      attributes: [{ name: "Scent", option: "Fig" }],
    });
    const tin = products.find((p) => p.handle === "lavender-travel-tin")!;
    expect(productPayload(tin, { categoryId: 3, tagIds: [], images: [] })).toMatchObject({
      type: "simple",
      sku: "CA-CND-002-LAV",
      regular_price: "16.00",
      sale_price: "12.50",
      manage_stock: true,
    });
  });
});

describe("WooCommerce client auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Basic auth over https and the query string over plain http, never printing the secret", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = { consumerKey: "ck_1", consumerSecret: "cs_secret" };
    await createWoo(flags(), { url: "https://shop.example.com", ...config }).get("/orders");
    await createWoo(flags(), { url: "http://localhost:8085", ...config }).get("/orders");
    const [httpsUrl, httpsInit] = fetchMock.mock.calls[0];
    expect(httpsUrl).not.toContain("consumer_secret");
    expect(httpsInit.headers.Authorization).toBe(
      `Basic ${Buffer.from("ck_1:cs_secret").toString("base64")}`,
    );
    const [httpUrl, httpInit] = fetchMock.mock.calls[1];
    expect(httpUrl).toContain("consumer_key=ck_1");
    expect(httpInit.headers.Authorization).toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(
      createWoo(flags(), { url: "http://localhost:8085", ...config }).get("/orders"),
    ).rejects.toThrow(/^(?!.*cs_secret).*401/);
  });
});

describe("seedWooCommerce against a mocked store", () => {
  let calls: Array<{ method: string; path: string; body: unknown }>;
  beforeEach(() => {
    calls = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips orders that already carry the demo key and creates the rest with notes", async () => {
    let nextId = 500;
    const allVariants = products.flatMap((p) =>
      p.variants.map((v, i) => ({ id: 1000 + i, sku: v.sku })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        const u = new URL(url);
        const path = u.pathname.replace("/wp-json/wc/v3", "");
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (method === "GET" && path === "/orders") {
          return json([
            {
              id: 9,
              number: "9",
              status: "processing",
              meta_data: [{ key: KEY_META, value: "paid-unfulfilled" }],
            },
          ]);
        }
        if (method === "GET" && path === "/products") return json([{ id: 10 }]);
        if (method === "GET" && /\/variations$/.test(path)) return json(allVariants);
        if (method === "GET" && path === "/customers") return json([{ id: 5 }]);
        if (method === "POST" && path === "/orders")
          return json({
            id: ++nextId,
            number: String(nextId),
            status: body.status,
            total: "40.00",
          });
        if (method === "POST") return json({ id: ++nextId });
        return json({});
      }),
    );

    const { rows, backdateCommand: cmd } = await seedWooCommerce({
      flags: flags({
        only: new Set(["orders"]),
        orderKeys: new Set(["paid-unfulfilled", "in-transit"]),
      }),
      config: { url: "https://shop.example.com", consumerKey: "ck", consumerSecret: "cs" },
      now: NOW,
    });

    const orderPosts = calls.filter((c) => c.method === "POST" && c.path === "/orders");
    expect(orderPosts).toHaveLength(1);
    expect(orderPosts[0].body).toMatchObject({
      customer_id: 5,
      line_items: [{ product_id: 10, variation_id: expect.any(Number) }, expect.anything()],
    });
    expect(calls.filter((c) => c.method === "POST" && /\/notes$/.test(c.path))).toHaveLength(1);
    expect(rows.map((r) => [r.key, r.result])).toEqual([
      ["paid-unfulfilled", "existing"],
      ["in-transit", "created"],
    ]);
    expect(rows[1].tracking).toMatch(/^DEMO/);
    expect(cmd).toMatch(/^wp eval '/);
  });

  it("--reset-orders deletes demo orders with force=true before creating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        const u = new URL(url);
        calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: undefined });
        if ((init.method ?? "GET") === "GET" && u.pathname.endsWith("/orders")) {
          return new Response(
            JSON.stringify([
              {
                id: 9,
                number: "9",
                status: "completed",
                meta_data: [{ key: KEY_META, value: "delivered" }],
              },
            ]),
          );
        }
        if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify([{ id: 10 }]));
        return new Response(
          JSON.stringify({ id: 77, number: "77", status: "completed", total: "1.00" }),
        );
      }),
    );
    await seedWooCommerce({
      flags: flags({ only: new Set(["orders"]), orderKeys: new Set(["delivered"]) }),
      config: { url: "https://shop.example.com", consumerKey: "ck", consumerSecret: "cs" },
      now: NOW,
      resetOrders: true,
      products: products.filter((p) =>
        p.variants.some((v) => ["CA-MUG-002-SET", "CA-NAP-002-SET"].includes(v.sku)),
      ),
    });
    expect(
      calls.some(
        (c) =>
          c.method === "DELETE" && c.path.includes("/orders/9") && c.path.includes("force=true"),
      ),
    ).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/orders"))).toHaveLength(1);
  });

  it("--dry-run sends nothing and needs no credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const saved = { ...process.env };
    delete process.env.WOO_URL;
    delete process.env.WOO_CONSUMER_KEY;
    delete process.env.WOO_CONSUMER_SECRET;
    try {
      expect(await run(["--dry-run"])).toBe(0);
    } finally {
      process.env = saved;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("backdateCommand", () => {
  it("encodes order, refund and note dates for one wp eval", () => {
    const cmd = backdateCommand([
      { id: 5, created: 100, completed: null, notes: [[7, "2026-10-01 10:00:00"]], refunds: [] },
    ])!;
    const b64 = /base64_decode\("([^"]+)"\)/.exec(cmd)![1];
    expect(JSON.parse(Buffer.from(b64, "base64").toString())).toEqual([
      { id: 5, created: 100, completed: null, notes: [[7, "2026-10-01 10:00:00"]], refunds: [] },
    ]);
    expect(backdateCommand([])).toBeNull();
  });
});
