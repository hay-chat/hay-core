import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify } = require("./harness");
const { registerOrderTools } = require("../tools/orders");

// Regression: a shopper gave order #1002 with the WRONG email and the lookup
// result carried the real owner's email, which the model then quoted.
describe("order lookups return no PII unless the shopper is matched to the order", () => {
  const order = {
    id: "gid://shopify/Order/1002",
    name: "#1002",
    email: "real.owner@example.com",
    phone: "+5511987654321",
    shippingAddress: {
      address1: "Rua Real 10",
      city: "Lisboa",
      firstName: "Real",
      lastName: "Owner",
      phone: "+5511987654321",
    },
    customer: {
      id: "gid://shopify/Customer/9",
      displayName: "Real Owner",
      defaultEmailAddress: { emailAddress: "real.owner@example.com" },
    },
    fulfillments: [],
    lineItems: { edges: [] },
  };
  const handlers = {
    GetOrder: () => ({ order, shop: null }),
    GetOrderByName: () => ({ orders: { edges: [{ node: order }] }, shop: null }),
  };
  const PII = /real\.owner|Real|Owner|Rua|Lisboa|987654321/i;

  for (const [tool, args] of [
    ["shopify_get_order", { order_id: "1002" }],
    ["shopify_get_order_by_name", { name: "#1002" }],
  ]) {
    it(`${tool}: a wrong email gets an error with none of the order's PII`, async () => {
      mockShopify(handlers);
      const server = createFakeServer();
      registerOrderTools(server);
      const res = await server.call(tool, { ...args, email: "someone.else@example.com" });
      expect(res.isError).toBe(true);
      expect(res.data.details).toMatchObject({ reason: "IDENTITY_MISMATCH" });
      expect(res.text).not.toMatch(PII);
    });

    it(`${tool}: no email asks for one and returns nothing`, async () => {
      mockShopify(handlers);
      const server = createFakeServer();
      registerOrderTools(server);
      const res = await server.call(tool, args);
      expect(res.isError).toBe(true);
      expect(res.text).not.toMatch(PII);
    });

    it(`${tool}: the right email gets the order`, async () => {
      mockShopify(handlers);
      const server = createFakeServer();
      registerOrderTools(server);
      const res = await server.call(tool, { ...args, email: " REAL.owner@example.com " });
      expect(res.isError).toBe(false);
      expect(res.data.name).toBe("#1002");
    });
  }
});
