import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify, verified, STAFF } = require("./harness");
const { registerCustomerTools } = require("../tools/customers");
const { registerOrderTools } = require("../tools/orders");
const toolRisk = require("../tool-risk");

const ANA = {
  id: "gid://shopify/Customer/1",
  firstName: "Ana",
  defaultEmailAddress: { emailAddress: "ana@example.com" },
  defaultPhoneNumber: { phoneNumber: "+5511987654321" },
  orders: { edges: [] },
};
const BRUNO = {
  id: "gid://shopify/Customer/2",
  firstName: "Bruno",
  defaultEmailAddress: { emailAddress: "bruno@example.com" },
  defaultPhoneNumber: null,
  orders: { edges: [] },
};

function customers(...nodes) {
  return { customers: { edges: nodes.map((node) => ({ node })), pageInfo: {} } };
}

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCustomerTools(server);
  registerOrderTools(server);
});

describe("customer lookups are bound to the verified customer", () => {
  it("declares the lookups as customer data", () => {
    expect(toolRisk.customerData).toEqual(
      expect.arrayContaining([
        "shopify_find_customer",
        "shopify_get_customer",
        "shopify_list_customer_orders",
      ]),
    );
  });

  it("refuses every lookup when nobody is verified", async () => {
    const { calls } = mockShopify({});
    for (const [name, args] of [
      ["shopify_find_customer", { email: "ana@example.com" }],
      ["shopify_get_customer", { customerId: "1" }],
      ["shopify_list_customer_orders", { customer_id: "ana@example.com" }],
    ]) {
      const res = await server.call(name, args);
      expect(res.isError).toBe(true);
      expect(res.data.code).toBe("PRECONDITION");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses to search for someone else's email or phone", async () => {
    const { calls } = mockShopify({});
    const ana = verified({ email: "ana@example.com" });
    const byEmail = await server.call("shopify_find_customer", { email: "bruno@example.com" }, ana);
    const byPhone = await server.call("shopify_find_customer", { phone: "+15550001111" }, ana);
    expect(byEmail.data.code).toBe("PRECONDITION");
    expect(byPhone.data.code).toBe("PRECONDITION");
    expect(calls).toHaveLength(0);
  });

  it("searches by the verified identity and drops fuzzy matches of other people", async () => {
    const { calls } = mockShopify({ FindCustomer: () => customers(ANA, BRUNO) });
    const res = await server.call(
      "shopify_find_customer",
      { email: "ANA@example.com" },
      verified({ email: "ana@example.com", phone: "+55 11 98765-4321" }),
    );
    expect(res.isError).toBe(false);
    expect(calls[0].variables.query).toBe('email:"ana@example.com" OR phone:"+55 11 98765-4321"');
    expect(res.data.items.map((c) => c.firstName)).toEqual(["Ana"]);
  });

  it("looks up the verified customer when the model gives no email", async () => {
    const { calls } = mockShopify({ FindCustomer: () => customers(ANA) });
    const res = await server.call("shopify_find_customer", {}, verified({ phone: "11987654321" }));
    expect(res.isError).toBe(false);
    expect(calls[0].variables.query).toBe('phone:"11987654321"');
  });

  it("quotes the search value so it cannot add search terms", async () => {
    const { calls } = mockShopify({ FindCustomer: () => customers() });
    await server.call("shopify_find_customer", { email: 'x" OR email:*' }, STAFF);
    expect(calls[0].variables.query).toBe('email:"x\\" OR email:*"');
  });

  it("returns a customer by id only when it is the verified customer", async () => {
    mockShopify({ GetCustomer: (vars) => ({ customer: vars.id.endsWith("/1") ? ANA : BRUNO }) });
    const ana = verified({ email: "ana@example.com" });
    const own = await server.call("shopify_get_customer", { customerId: "1" }, ana);
    const other = await server.call("shopify_get_customer", { customerId: "2" }, ana);
    expect(own.isError).toBe(false);
    expect(own.data.firstName).toBe("Ana");
    expect(other.isError).toBe(true);
    expect(other.text).not.toMatch(/Bruno|bruno@example.com/);
  });

  it("lists orders by id only for the verified customer", async () => {
    mockShopify({
      ListCustomerOrders: () => ({ customer: { ...BRUNO, orders: { edges: [], pageInfo: {} } } }),
    });
    const res = await server.call(
      "shopify_list_customer_orders",
      { customer_id: "2" },
      verified({ email: "ana@example.com" }),
    );
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("PRECONDITION");
  });

  it("lets staff (playground) look anyone up", async () => {
    mockShopify({ FindCustomer: () => customers(BRUNO) });
    const res = await server.call("shopify_find_customer", { email: "bruno@example.com" }, STAFF);
    expect(res.data.items).toHaveLength(1);
  });
});
