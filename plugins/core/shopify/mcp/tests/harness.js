/**
 * Test harness for the Shopify MCP tool modules: a fake `server` that records
 * `server.tool(...)` registrations and calls a tool with zod validation applied,
 * plus a `fetch` stub for the Admin GraphQL endpoint that routes by operation
 * name and records every request so tests can assert the exact query/variables.
 */

const { z } = require("zod");

process.env.SHOPIFY_SHOP = "store.myshopify.com";
process.env.SHOPIFY_ACCESS_TOKEN = "shpat_test";
process.env.SHOPIFY_API_VERSION = "2026-04";

const GRAPHQL_URL = "https://store.myshopify.com/admin/api/2026-04/graphql.json";

function createFakeServer() {
  const tools = new Map();
  return {
    tools,
    tool(name, description, shape, handler) {
      if (tools.has(name)) throw new Error(`duplicate tool ${name}`);
      tools.set(name, { description, shape, handler });
    },
    async call(name, args = {}) {
      const t = tools.get(name);
      if (!t) throw new Error(`no tool ${name}`);
      const parsed = z.object(t.shape).parse(args);
      const res = await t.handler(parsed);
      const text = res.content[0].text;
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // plain-text error
      }
      return { isError: Boolean(res.isError), text, data };
    },
  };
}

/** The GraphQL operation name (`query GetOrder(...)` -> "GetOrder"). */
function operationName(query) {
  const m = /\b(query|mutation)\s+(\w+)/.exec(query);
  return m ? m[2] : null;
}

/**
 * Install a fetch stub. `handlers` maps an operation name to
 * `(variables, query) => data | { status, body } | { errors }`. A plain object is
 * wrapped as `{ data }`. Unknown operations fail the test loudly.
 */
function mockShopify(handlers) {
  const calls = [];
  global.fetch = async (input, init = {}) => {
    if (String(input) !== GRAPHQL_URL) throw new Error(`unexpected URL ${input}`);
    if (init.headers["X-Shopify-Access-Token"] !== "shpat_test") {
      throw new Error("missing access token header");
    }
    const body = JSON.parse(init.body);
    const op = operationName(body.query);
    calls.push({ op, query: body.query, variables: body.variables, init });
    const handler = handlers[op];
    if (!handler) throw new Error(`no mock for operation ${op}`);
    const out = await handler(body.variables, body.query);
    if (out && typeof out === "object" && "status" in out && "body" in out) {
      return response(out.status, out.body);
    }
    if (out && typeof out === "object" && Array.isArray(out.errors)) {
      return response(200, out);
    }
    return response(200, { data: out });
  };
  return { calls };
}

function response(status, body) {
  const text = body === undefined || body === null ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}

module.exports = { createFakeServer, mockShopify, operationName };
