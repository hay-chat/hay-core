import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer } = require("./harness");
const { registerReturnTools } = require("../tools/returns");

describe("shopify_get_return_instructions (D6-13)", () => {
  it("relays the merchant's text, or says to hand off when unset", async () => {
    const server = createFakeServer();
    registerReturnTools(server);
    expect((await server.call("shopify_get_return_instructions")).data.configured).toBe(false);
    process.env.RETURN_INSTRUCTIONS = "Email returns@store.test with your order number.";
    try {
      const res = await server.call("shopify_get_return_instructions");
      expect(res.data).toMatchObject({
        configured: true,
        instructions: expect.stringMatching(/returns@/),
      });
    } finally {
      delete process.env.RETURN_INSTRUCTIONS;
    }
  });
});
