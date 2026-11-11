/**
 * The two tools end to end against a stubbed Melhor Envio API: which requests
 * they issue, what they return, and what they refuse.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch, verified, NOBODY } = require("./harness");
const { registerShipmentTools } = require("../tools/shipments");
const { order } = require("./fixtures");

const SEARCH = "/api/v2/me/orders/search";
const ID = "34105e98-bb32-4e85-8b0f-8bd2c888eb31";

let server;
beforeEach(() => {
  process.env.MELHOR_ENVIO_ACCESS_TOKEN = "tok";
  process.env.MELHOR_ENVIO_USER_AGENT = "Hay (dev@store.test)";
  server = createFakeServer();
  registerShipmentTools(server);
});

const error = (res) => JSON.parse(res.text);

describe("melhorenvio_track_shipment", () => {
  it("finds a shipment by tracking code, however the customer typed it", async () => {
    const { calls } = mockFetch([{ path: SEARCH, reply: () => [order()] }]);
    const res = await server.call("melhorenvio_track_shipment", { reference: "me220021p96br" });

    expect(calls.map((c) => `${c.method} ${c.path}?${c.query}`)).toEqual([
      `GET ${SEARCH}?q=me220021p96br`,
    ]);
    expect(res.isError).toBe(false);
    expect(res.data.shipments).toHaveLength(1);
    expect(res.data.shipments[0]).toMatchObject({
      protocol: "ORD-20220395517",
      stage: "in_transit",
      carrier: "Correios",
      trackingCode: "ME220021P96BR",
    });
    expect(res.data.summary).toMatch(/^Correios PAC shipment ME220021P96BR:/);
    expect(res.data.notFound).toBeUndefined();
  });

  it("reads a shipment id straight from the detail endpoint", async () => {
    const { calls } = mockFetch([{ path: `/api/v2/me/orders/${ID}`, reply: () => order() }]);
    const res = await server.call("melhorenvio_track_shipment", { reference: ID });
    expect(calls.map((c) => c.path)).toEqual([`/api/v2/me/orders/${ID}`]);
    expect(res.data.shipments[0].id).toBe(ID);
  });

  it("tracks several references at once and names the ones it could not find", async () => {
    mockFetch([
      {
        path: SEARCH,
        reply: ({ query }) =>
          query.get("q") === "ORD-20220395517"
            ? [order()]
            : { status: 400, body: { error: "Not Found" } },
      },
    ]);
    const res = await server.call("melhorenvio_track_shipment", {
      reference: "ORD-20220395517, XX000BR",
    });
    expect(res.isError).toBe(false);
    expect(res.data.shipments).toHaveLength(1);
    expect(res.data.notFound).toEqual(["XX000BR"]);
    expect(res.data.summary).toMatch(/Not found: XX000BR\.$/);
  });

  it("answers NOT_FOUND with the next step when nothing matches", async () => {
    mockFetch([{ path: SEARCH, reply: () => ({ status: 400, body: { error: "Not Found" } }) }]);
    const res = await server.call("melhorenvio_track_shipment", { reference: "XX000BR" });
    expect(res.isError).toBe(true);
    expect(error(res)).toMatchObject({
      code: "NOT_FOUND",
      retryable: false,
      details: { notFound: ["XX000BR"] },
    });
    expect(error(res).message).toMatch(/melhorenvio_find_customer_shipments/);
  });

  it("answers NOT_FOUND for an unknown shipment id", async () => {
    mockFetch([
      {
        path: `/api/v2/me/orders/${ID}`,
        reply: () => ({
          status: 404,
          body: { message: "No query results for model [App\\Order]." },
        }),
      },
    ]);
    const res = await server.call("melhorenvio_track_shipment", { reference: ID });
    expect(error(res).code).toBe("NOT_FOUND");
  });

  it("does not return a customer's shipments for a CPF passed as a reference", async () => {
    // The search endpoint matches documents too; only id/protocol/tracking matches are kept.
    mockFetch([
      { path: SEARCH, reply: () => [order(), order({ id: "other", tracking: "ME2BR" })] },
    ]);
    const res = await server.call("melhorenvio_track_shipment", { reference: "73646548010" });
    expect(error(res).code).toBe("NOT_FOUND");
  });

  it("refuses an empty reference without calling Melhor Envio", async () => {
    const { calls } = mockFetch([]);
    const res = await server.call("melhorenvio_track_shipment", { reference: " , " });
    expect(error(res).code).toBe("BAD_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("passes an expired token on as AUTH_FAILED", async () => {
    mockFetch([
      { path: SEARCH, reply: () => ({ status: 401, body: { message: "Unauthenticated." } }) },
    ]);
    const res = await server.call("melhorenvio_track_shipment", { reference: "ME220021P96BR" });
    expect(error(res)).toMatchObject({ code: "AUTH_FAILED", retryable: false });
  });
});

describe("melhorenvio_find_customer_shipments", () => {
  const older = order({
    id: "older",
    protocol: "ORD-1",
    tracking: "ME1BR",
    status: "delivered",
    delivered_at: "2022-02-10 10:00:00",
    created_at: "2022-02-01 09:00:00",
  });
  const someoneElse = order({
    id: "else",
    tracking: "ME9BR",
    to: { ...order().to, email: "joao@example.com", phone: "21988887777" },
  });
  // The merchant's own shipment to another recipient: matches the search as the sender.
  const asSender = order({
    id: "sender",
    from: { ...order().from, document: "73646548010" },
    to: { ...order().to, document: "11122233344" },
  });

  it("lists the verified customer's own shipments, newest first", async () => {
    const { calls } = mockFetch([
      { path: SEARCH, reply: () => [older, order(), someoneElse, asSender] },
    ]);
    const res = await server.call(
      "melhorenvio_find_customer_shipments",
      { document: "736.465.480-10" },
      verified({ email: "MARIA@example.com" }),
    );
    expect(calls[0].query.get("q")).toBe("73646548010");
    expect(res.data.shipments.map((s) => s.id)).toEqual([
      "34105e98-bb32-4e85-8b0f-8bd2c888eb31",
      "older",
    ]);
    expect(res.data.summary).toMatch(/^Found 2 shipments for this customer\. Most recent: /);
  });

  it("matches the verified customer by phone as well", async () => {
    mockFetch([{ path: SEARCH, reply: () => [order(), someoneElse] }]);
    const res = await server.call(
      "melhorenvio_find_customer_shipments",
      { document: "73646548010" },
      verified({ phone: "+55 (11) 99999-0000" }),
    );
    expect(res.data.shipments).toHaveLength(1);
  });

  it("does not show another recipient's shipments to a verified customer", async () => {
    mockFetch([{ path: SEARCH, reply: () => [someoneElse] }]);
    const res = await server.call(
      "melhorenvio_find_customer_shipments",
      { document: "73646548010" },
      verified({ email: "maria@example.com" }),
    );
    expect(error(res).code).toBe("NOT_FOUND");
  });

  it("refuses an unverified customer without calling Melhor Envio", async () => {
    const { calls } = mockFetch([{ path: SEARCH, reply: () => [order()] }]);
    const res = await server.call(
      "melhorenvio_find_customer_shipments",
      { document: "73646548010" },
      NOBODY,
    );
    expect(error(res).code).toBe("PRECONDITION");
    expect(calls).toHaveLength(0);
  });

  it("lets staff look up any recipient, but never shipments the document only sent", async () => {
    mockFetch([{ path: SEARCH, reply: () => [order(), someoneElse, asSender] }]);
    const res = await server.call("melhorenvio_find_customer_shipments", {
      document: "73646548010",
    });
    expect(res.data.shipments.map((s) => s.id).sort()).toEqual([
      "34105e98-bb32-4e85-8b0f-8bd2c888eb31",
      "else",
    ]);
  });

  it("refuses a document that is not a CPF or CNPJ without calling Melhor Envio", async () => {
    const { calls } = mockFetch([]);
    const res = await server.call("melhorenvio_find_customer_shipments", { document: "12345" });
    expect(error(res)).toMatchObject({ code: "BAD_INPUT", details: { field: "document" } });
    expect(calls).toHaveLength(0);
  });

  it("answers NOT_FOUND when Melhor Envio has nothing for the document", async () => {
    mockFetch([{ path: SEARCH, reply: () => ({ status: 400, body: { error: "Not Found" } }) }]);
    const res = await server.call("melhorenvio_find_customer_shipments", {
      document: "73646548010",
    });
    expect(error(res).code).toBe("NOT_FOUND");
    expect(error(res).message).toMatch(/melhorenvio_track_shipment/);
  });
});
