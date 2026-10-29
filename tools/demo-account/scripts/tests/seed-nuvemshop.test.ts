import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCustomers, loadOrders, loadProducts, type Flags } from "../lib/data";
import type { OrderFixture } from "../lib/types";
import { run, seedNuvemshop } from "../seed-nuvemshop";
import { USER_AGENT } from "../nuvemshop/client";
import {
  customerPayload,
  fulfilmentSteps,
  marker,
  orderPayload,
  ownerNoteLines,
  paymentStatusCandidates,
  productPayload,
  splitStreet,
} from "../nuvemshop/mapping";

// The plugin's own readers: seeded data must be read back the way Hay.chat reads it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginOrders = require("../../../../plugins/core/nuvemshop/mcp/lib/orders.js");

const NOW = new Date("2026-10-29T12:00:00Z");
const products = loadProducts();
const customers = loadCustomers("nuvemshop");
const fixtures = loadOrders("nuvemshop");
const fixture = (key: string) => fixtures.find((f) => f.key === key) as OrderFixture;
const flags = (over: Partial<Flags> = {}): Flags => ({
  dryRun: false,
  only: new Set(),
  orderKeys: new Set(),
  ...over,
});

function payloadFor(key: string, paymentStatus?: string) {
  const f = fixture(key);
  const customer = customers.find((c) => c.key === f.customer.nuvemshop)!;
  return orderPayload(
    f,
    { customer, products, variantId: () => 42, now: NOW },
    paymentStatus ?? paymentStatusCandidates(f)[0],
  );
}

/** A fulfillment order after the seed's PATCH/POST steps (what GET fulfillment-orders would return). */
function foAfter(key: string) {
  const fo: Record<string, unknown> = {
    id: "FO1",
    status: "UNPACKED",
    tracking_info: {},
    tracking_events: [],
    labels: [],
  };
  for (const step of fulfilmentSteps(fixture(key), NOW)) {
    if (step.path === "/tracking-events") (fo.tracking_events as unknown[]).push(step.body);
    else Object.assign(fo, step.body);
  }
  return fo;
}

describe("Nuvemshop order mapping per state", () => {
  it("every order: BRL, pt, no emails, stock untouched, marker first in owner_note, backdated", () => {
    const p = payloadFor("paid-unfulfilled");
    expect(p).toMatchObject({
      currency: "BRL",
      language: "pt",
      status: "open",
      payment_status: "paid",
      shipping_status: "unpacked",
      inventory_behaviour: "bypass",
      send_confirmation_email: false,
      send_fulfillment_email: false,
      gateway: "mercadopago",
      created_at: "2026-10-28T12:00:00.000Z",
    });
    expect(String(p.owner_note).startsWith(marker("paid-unfulfilled"))).toBe(true);
    expect(p.customer).toMatchObject({
      email: "camila.souza@example.com",
      document: "10000791989",
    });
    expect(p.products).toEqual([
      { variant_id: 42, quantity: 2, price: "119.90" },
      { variant_id: 42, quantity: 1, price: "149.90" },
    ]);
    // R$389.70 > R$299: free shipping.
    expect(p.shipping_cost_customer).toBe("0.00");
  });

  it("Pix pending: payment_status pending, method pix; the plugin shows it awaiting payment", () => {
    const p = payloadFor("pending-payment");
    expect(p).toMatchObject({ payment_status: "pending", payment_details: { method: "pix" } });
    expect(p.paid_at).toBeUndefined();
    const info = pluginOrders.paymentInfo({ ...p, status: "open" });
    expect(info).toMatchObject({
      isPix: true,
      pixStatus: "awaiting_payment",
      awaitingPayment: true,
    });
  });

  it("customer note goes to note; cancelled-unpaid tries voided then pending", () => {
    expect(payloadFor("address-change").note).toBe("please leave with the doorman.");
    expect(paymentStatusCandidates(fixture("cancelled-unpaid"))).toEqual(["voided", "pending"]);
    expect(paymentStatusCandidates(fixture("refunded"))).toEqual(["refunded", "paid"]);
    expect(paymentStatusCandidates(fixture("partially-refunded"))).toEqual([
      "partially_refunded",
      "paid",
    ]);
  });

  it("refunds are written to owner_note with amount and date", () => {
    expect(ownerNoteLines(fixture("partially-refunded"), products, NOW)[1]).toBe(
      "Reembolso parcial de R$ 69,90 (1× CA-POT-001-TER, chegou quebrado) estornado via Mercado Pago em 2026-10-17.",
    );
    expect(ownerNoteLines(fixture("refunded"), products, NOW)).toEqual([
      expect.stringContaining(marker("refunded")),
      "Cancelled at the customer's request before shipping.",
      "Reembolso total de R$ 159,90 estornado via Mercado Pago em 2026-10-26.",
    ]);
  });

  it("in transit: DISPATCHED with tracking and recent events; not stale, not cancellable", () => {
    const row = pluginOrders.normalizeFulfillment(foAfter("in-transit"));
    expect(row).toMatchObject({
      status: "DISPATCHED",
      trackingNumber: expect.stringMatching(/^HA\d{9}BR$/),
      deliveredAt: null,
    });
    expect(row.trackingUrl).toContain(row.trackingNumber);
    const summary = pluginOrders.enrichOrder({ ...payloadFor("in-transit"), id: 1 }, [row], null, {
      originCountry: "BR",
      now: NOW.getTime(),
    }).supportSummary;
    expect(summary.isCancellable).toBe(false);
    expect(summary.tracking.isStale).toBe(false);
  });

  it("stale: only a dispatch event 12 days ago, flagged stale by the plugin", () => {
    const row = pluginOrders.normalizeFulfillment(foAfter("stale-tracking"));
    expect(row.latestEvent.status).toBe("dispatched");
    const summary = pluginOrders.enrichOrder(
      { ...payloadFor("stale-tracking"), id: 1 },
      [row],
      null,
      { originCountry: "BR", now: NOW.getTime() },
    ).supportSummary;
    expect(summary.tracking.isStale).toBe(true);
  });

  it("delivered: DELIVERED with a delivered event dated 5 days ago", () => {
    const row = pluginOrders.normalizeFulfillment(foAfter("delivered"));
    expect(row.status).toBe("DELIVERED");
    expect(row.deliveredAt).toBe("2026-10-24T12:00:00.000Z");
    expect(fulfilmentSteps(fixture("paid-unfulfilled"), NOW)).toEqual([]);
  });
});

describe("Nuvemshop product and customer mapping", () => {
  it("i18n names, variants with price/promotional_price, stock, kg weight", () => {
    const tin = products.find((p) => p.handle === "lavender-travel-tin")!;
    const p = productPayload(tin, 3, ["pt", "en"]);
    expect(p.name).toEqual({ pt: "Vela de Viagem Lavanda na Lata", en: "Lavender Travel Tin" });
    expect(p.tags).toContain("hay-demo");
    expect((p.variants as unknown[])[0]).toMatchObject({
      sku: "CA-CND-002-LAV",
      price: "59.90",
      promotional_price: "49.90",
      stock: 60,
      weight: "0.160",
    });
    const candle = products.find((p) => p.handle === "aurora-soy-candle")!;
    const c = productPayload(candle, 3, ["pt"]);
    expect(c.attributes).toEqual([{ pt: "Aroma" }]);
    expect((c.variants as Array<{ values: unknown }>)[1].values).toEqual([{ pt: "Fig" }]);
  });

  it("customer with CPF digits, split street number and no invite email", () => {
    const p = customerPayload(customers.find((c) => c.key === "br-camila")!);
    expect(p).toMatchObject({ identification: "10000791989", send_email_invite: false });
    expect((p.addresses as unknown[])[0]).toMatchObject({
      address: "Rua Augusta",
      number: "1500",
      floor: "Apto 52",
      zipcode: "01304-001",
    });
    expect(splitStreet("Sem número")).toEqual({ address: "Sem número", number: "S/N" });
  });
});

describe("seedNuvemshop against a mocked store", () => {
  let calls: Array<{
    method: string;
    path: string;
    body: Record<string, unknown> | undefined;
    headers: Record<string, string>;
  }>;
  const allVariants = products.flatMap((p) =>
    p.variants.map((v, i) => ({ id: 2000 + i, sku: v.sku })),
  );

  function mockStore(
    overrides: (
      method: string,
      path: string,
      body: Record<string, unknown> | undefined,
    ) => Response | undefined = () => undefined,
  ) {
    let nextId = 500;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        const u = new URL(url);
        const path = u.pathname.replace("/2025-03/123", "");
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body, headers: init.headers as Record<string, string> });
        const custom = overrides(method, path, body);
        if (custom) return custom;
        const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (method === "GET" && path === "/orders") {
          return json([
            { id: 1, number: 101, status: "open", owner_note: `${marker("pending-payment")} demo` },
          ]);
        }
        if (method === "GET" && path.startsWith("/products/sku/"))
          return json({ id: 10, variants: allVariants });
        if (method === "GET" && /fulfillment-orders$/.test(path)) return json([{ id: "FO1" }]);
        if (method === "POST" && path === "/orders")
          return json({
            id: ++nextId,
            number: 1000 + nextId,
            payment_status: body?.payment_status,
          });
        return json({});
      }),
    );
  }

  beforeEach(() => {
    calls = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips marked orders, creates the rest, fulfils and closes delivered ones", async () => {
    mockStore();
    const rows = await seedNuvemshop({
      flags: flags({
        only: new Set(["orders"]),
        orderKeys: new Set(["pending-payment", "delivered"]),
      }),
      config: { storeId: "123", accessToken: "tok" },
      now: NOW,
      retryDelayMs: 0,
    });
    expect(
      calls.every(
        (c) => c.headers.Authentication === "bearer tok" && c.headers["User-Agent"] === USER_AGENT,
      ),
    ).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/orders")).toHaveLength(1);
    const writes = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(writes).toEqual([
      "POST /orders",
      "PATCH /orders/501/fulfillment-orders/FO1",
      "POST /orders/501/fulfillment-orders/FO1/tracking-events",
      "POST /orders/501/fulfillment-orders/FO1/tracking-events",
      "POST /orders/501/fulfillment-orders/FO1/tracking-events",
      "PATCH /orders/501/fulfillment-orders/FO1",
      "POST /orders/501/close",
    ]);
    expect(rows.map((r) => [r.key, r.result, r.status])).toEqual([
      ["delivered", "created", "closed/paid/delivered"],
      ["pending-payment", "existing", "open"],
    ]);
  });

  it("falls back when payment_status is refused, retries 429, and cancels refunded orders", async () => {
    let throttled = false;
    mockStore((method, path, body) => {
      if (method === "POST" && path === "/orders" && !throttled) {
        throttled = true;
        return new Response("{}", { status: 429 });
      }
      if (method === "POST" && path === "/orders" && body?.payment_status === "refunded") {
        return new Response(JSON.stringify({ payment_status: ["is invalid"] }), { status: 422 });
      }
      return undefined;
    });
    const rows = await seedNuvemshop({
      flags: flags({ only: new Set(["orders"]), orderKeys: new Set(["refunded"]) }),
      config: { storeId: "123", accessToken: "tok" },
      now: NOW,
      retryDelayMs: 0,
    });
    const posts = calls.filter((c) => c.method === "POST" && c.path === "/orders");
    expect(posts.map((c) => c.body?.payment_status)).toEqual(["refunded", "refunded", "paid"]);
    expect(calls.find((c) => c.path.endsWith("/cancel"))?.body).toEqual({
      reason: "customer",
      email: false,
      restock: true,
    });
    expect(rows[0].status).toBe("cancelled/paid/unpacked");
    expect(rows[0].notes[0]).toContain('payment_status "refunded" refused');
  });

  it("--reset-orders cancels and retires the marker when DELETE is refused", async () => {
    mockStore((method) => (method === "DELETE" ? new Response("{}", { status: 404 }) : undefined));
    await seedNuvemshop({
      flags: flags({ only: new Set(["orders"]), orderKeys: new Set(["pending-payment"]) }),
      config: { storeId: "123", accessToken: "tok" },
      now: NOW,
      resetOrders: true,
      retryDelayMs: 0,
    });
    expect(calls.find((c) => c.method === "PUT" && c.path === "/orders/1")?.body).toEqual({
      owner_note: "[hay-demo-reset:pending-payment] demo",
    });
    expect(calls.filter((c) => c.method === "POST" && c.path === "/orders")).toHaveLength(1);
  });

  it("--dry-run sends nothing and needs no credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const saved = { ...process.env };
    delete process.env.NUVEMSHOP_STORE_ID;
    delete process.env.NUVEMSHOP_ACCESS_TOKEN;
    try {
      expect(await run(["--dry-run"])).toBe(0);
    } finally {
      process.env = saved;
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
