import { describe, it, expect, vi, afterEach } from "vitest";
import { useConversation } from "../useConversation";
import type { HayChatConfig } from "@/types";

/**
 * The server caps `pageUrl` at 2048 characters and refuses the whole message
 * when it is longer, so the widget leaves an over-long URL out.
 */

const config = { organizationId: "org-1", baseUrl: "https://api.example.com" } as HayChatConfig;

async function sentBody(): Promise<Record<string, unknown>> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ result: { data: { messageId: "m1", nonce: "n2" } } })),
    );
  vi.stubGlobal("fetch", fetchMock);
  await useConversation(config).sendMessage("conv-1", "Hello", "proof");
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe("useConversation sendMessage pageUrl", () => {
  const originalUrl = window.location.href;

  afterEach(() => {
    window.history.replaceState(null, "", originalUrl);
    vi.unstubAllGlobals();
  });

  it("sends the page URL", async () => {
    window.history.replaceState(null, "", "/products/shirt?color=blue");
    expect((await sentBody()).pageUrl).toBe(window.location.href);
  });

  it("leaves out a URL longer than the server accepts", async () => {
    window.history.replaceState(null, "", `/products?gclid=${"x".repeat(2100)}`);
    const body = await sentBody();
    expect(body).not.toHaveProperty("pageUrl");
    expect(body.content).toBe("Hello");
  });
});
