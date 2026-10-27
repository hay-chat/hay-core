import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE, makeOrder } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerCustomerTools } = require("../tools/customers");

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCustomerTools(server);
});

const ANA = {
  id: 77,
  name: "Ana Souza",
  email: "ana@example.com",
  identification: "123.456.789-09",
  total_spent: "300.00",
};
const LOOKALIKE = {
  id: 78,
  name: "Anabela",
  email: "ana@example.com.br",
  identification: "99912345678909",
};

function routes({ customers = [LOOKALIKE, ANA], orders = [makeOrder()] } = {}) {
  return [
    { method: "GET", path: `${BASE}/customers`, reply: () => customers },
    {
      method: "GET",
      path: `${BASE}/orders`,
      reply: ({ query }) => {
        if (query.get("customer_ids"))
          return orders.filter((o) => String(o.customer?.id) === query.get("customer_ids"));
        return orders;
      },
    },
  ];
}

describe("nuvemshop_find_customer", () => {
  it("verifies the email exactly and returns recent orders by customer id", async () => {
    const { calls } = mockFetch(routes());
    const res = await server.call("nuvemshop_find_customer", { email: "ANA@example.com" });
    expect(res.data.found).toBe(true);
    expect(res.data.customer).toMatchObject({ id: 77, isGuest: false, email: "ana@example.com" });
    expect(res.data.recentOrders[0]).toMatchObject({ id: 900, number: 101 });
    expect(calls.find((c) => c.path.endsWith("/orders")).query.get("customer_ids")).toBe("77");
  });

  it("never returns a lookalike account", async () => {
    mockFetch(routes({ customers: [LOOKALIKE], orders: [] }));
    const res = await server.call("nuvemshop_find_customer", { email: "ana@example.com" });
    expect(res.data.found).toBe(false);
  });

  it("finds guest orders by verified contact email only", async () => {
    const guest = makeOrder({ customer: null, contact_email: "guest@example.com" });
    const other = makeOrder({
      id: 902,
      number: 102,
      customer: null,
      contact_email: "guest@example.com.ar",
    });
    mockFetch(routes({ customers: [], orders: [other, guest] }));
    const res = await server.call("nuvemshop_find_customer", { email: "guest@example.com" });
    expect(res.data.customer).toMatchObject({ isGuest: true, email: "guest@example.com" });
    expect(res.data.recentOrders.map((o) => o.id)).toEqual([900]);
  });

  it("matches a CPF by digits, and refuses phone-only lookups", async () => {
    mockFetch(routes());
    const res = await server.call("nuvemshop_find_customer", { identification: "12345678909" });
    expect(res.data.customer.id).toBe(77);

    const none = await server.call("nuvemshop_find_customer", {});
    expect(none.isError).toBe(true);
    expect(none.text).toMatch(/cannot search customers by phone/);
  });
});

describe("nuvemshop_list_customer_orders", () => {
  it("pages an account's orders by id with a total", async () => {
    mockFetch(routes());
    const res = await server.call("nuvemshop_list_customer_orders", {
      email: "ana@example.com",
      limit: 500,
    });
    expect(res.data).toMatchObject({ customerId: 77, isGuest: false, page: 1 });
    expect(res.data.items).toHaveLength(1);
  });
});

describe("nuvemshop_get_customer", () => {
  it("projects addresses and 404s helpfully", async () => {
    mockFetch([
      {
        method: "GET",
        path: `${BASE}/customers/77`,
        reply: () => ({ ...ANA, default_address: { city: "SP", extra: 1 }, addresses: [] }),
      },
    ]);
    const res = await server.call("nuvemshop_get_customer", { customer_id: "77" });
    expect(res.data.defaultAddress.city).toBe("SP");
    expect(res.data.defaultAddress).not.toHaveProperty("extra");
    const missing = await server.call("nuvemshop_get_customer", { customer_id: "5" });
    expect(missing.text).toMatch(/nuvemshop_find_customer/);
  });
});
