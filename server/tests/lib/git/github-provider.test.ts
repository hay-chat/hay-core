import { describe, it, expect } from "@jest/globals";
import { readBodyWithLimit } from "@server/lib/git/github-provider";

describe("readBodyWithLimit", () => {
  it("returns the body when it fits", async () => {
    const buffer = await readBodyWithLimit(new Response(Buffer.from("hello")), 10);
    expect(buffer.toString()).toBe("hello");
  });

  it("rejects a declared length over the limit before reading", async () => {
    const response = new Response("x", { headers: { "content-length": "1000" } });
    await expect(readBodyWithLimit(response, 10)).rejects.toThrow(/maximum size/);
  });

  it("stops reading a streamed body once it passes the limit", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(8));
      },
    });
    await expect(readBodyWithLimit(new Response(stream), 20)).rejects.toThrow(/maximum size/);
    expect(pulls).toBeLessThan(10);
  });
});
