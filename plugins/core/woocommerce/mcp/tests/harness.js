/**
 * Test harness for the MCP tool modules: a fake `server` that records
 * `server.tool(...)` registrations and lets tests call a tool with zod
 * validation applied (so schema mistakes fail too), plus a `fetch` stub
 * driven by a small route table.
 */

const { z } = require("zod");

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
      return {
        isError: Boolean(res.isError),
        text,
        data: res.isError ? null : JSON.parse(text),
        // Failed calls carry the shared `{ code, retryable, message, details? }` payload.
        error: res.isError ? JSON.parse(text) : null,
      };
    },
  };
}

/**
 * Install a fetch stub. `routes` is an array of
 * `{ method, path: string | RegExp, reply: (ctx) => body | { status, body } }`.
 * `ctx` is `{ url, path, query, body, init }`. Unmatched requests return 404 and
 * are recorded so a test can assert nothing unexpected was called.
 */
function mockFetch(routes) {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const ctx = { url, path: url.pathname, query: url.searchParams, body, init, method };
    calls.push(ctx);
    const route = routes.find(
      (r) =>
        (r.method || "GET").toUpperCase() === method &&
        (r.path instanceof RegExp ? r.path.test(url.pathname) : r.path === url.pathname),
    );
    if (!route) {
      return response(404, { message: `no route for ${method} ${url.pathname}` });
    }
    const out = await route.reply(ctx);
    if (out && typeof out === "object" && "status" in out && "body" in out) {
      return response(out.status, out.body);
    }
    return response(200, out);
  };
  global.fetch = fetchMock;
  return { calls, fetchMock };
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

module.exports = { createFakeServer, mockFetch };
