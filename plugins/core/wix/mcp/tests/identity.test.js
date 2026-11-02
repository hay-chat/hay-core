import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch, verified, NOBODY } = require("./harness");
const { registerCustomerTools } = require("../tools/customers");
const toolRisk = require("../tool-risk");

// Customer lookups answer only for the customer Hay.chat verified (see @hay/plugin-sdk/identity).
const LOOKUPS = [
  ["wix_find_customer", { email: "bruno@example.com" }],
  ["wix_list_customer_orders", { email: "bruno@example.com" }],
];

let server;
beforeEach(() => {
  server = createFakeServer();
  registerCustomerTools(server);
});

describe("customer lookups are bound to the verified customer", () => {
  it("declares the lookups as customer data", () => {
    expect(toolRisk.customerData).toEqual(expect.arrayContaining(LOOKUPS.map(([name]) => name)));
  });

  it.each(LOOKUPS)("%s refuses when nobody is verified", async (name, args) => {
    const { calls } = mockFetch([]);
    const res = await server.call(name, args, NOBODY);
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it.each(LOOKUPS)("%s refuses another person's email", async (name, args) => {
    const { calls } = mockFetch([]);
    const res = await server.call(name, args, verified({ email: "ana@example.com" }));
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not the verified customer/);
    expect(calls).toHaveLength(0);
  });
});
