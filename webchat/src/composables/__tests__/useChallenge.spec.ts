import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useChallenge } from "../useChallenge";
import type { WidgetContribution } from "@/types";

const config = { organizationId: "org-1", baseUrl: "https://api.hay.test", locale: "pt-BR" };
const invisible: WidgetContribution = {
  id: "turnstile.challenge",
  type: "challenge@1",
  props: { provider: "turnstile", mode: "invisible" },
};

function setup() {
  const challenge = useChallenge(config as never);
  const host = document.createElement("div");
  document.body.appendChild(host);
  challenge.host.value = host;
  const pending = challenge.run(invisible);
  const iframe = host.querySelector("iframe")!;
  const post = (data: unknown, origin = "https://api.hay.test", source: unknown = iframe.contentWindow) =>
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
  return { challenge, host, iframe, pending, post };
}

describe("useChallenge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("loads the Hay.chat challenge frame for this page origin", () => {
    const { iframe } = setup();
    const url = new URL(iframe.src);
    expect(url.origin + url.pathname).toBe("https://api.hay.test/v1/webchat/challenge");
    expect(url.searchParams.get("org")).toBe("org-1");
    expect(url.searchParams.get("c")).toBe("turnstile.challenge");
    expect(url.searchParams.get("origin")).toBe(window.location.origin);
    expect(url.searchParams.get("lang")).toBe("pt-br");
  });

  it("resolves with the token from our frame and removes it", async () => {
    const { pending, post, host } = setup();
    post({ source: "hay-challenge", type: "token", token: "tok-1" });
    await expect(pending).resolves.toEqual({ token: "tok-1" });
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("ignores messages from other origins, other windows or without the source tag", async () => {
    const { pending, post } = setup();
    post({ source: "hay-challenge", type: "token", token: "evil" }, "https://evil.test");
    post({ source: "hay-challenge", type: "token", token: "evil" }, "https://api.hay.test", window);
    post({ type: "token", token: "evil" });
    post({ source: "hay-challenge", type: "token", token: "good" });
    await expect(pending).resolves.toEqual({ token: "good" });
  });

  it("shows the frame only when the shopper must interact", async () => {
    const { challenge, pending, post } = setup();
    expect(challenge.isInteractive.value).toBe(false);
    post({ source: "hay-challenge", type: "interactive" });
    expect(challenge.isInteractive.value).toBe(true);
    post({ source: "hay-challenge", type: "token", token: "t" });
    await pending;
    expect(challenge.isInteractive.value).toBe(false);
  });

  it("gives up after the invisible timeout so the shopper is never stuck", async () => {
    const { pending } = setup();
    vi.advanceTimersByTime(15_000);
    await expect(pending).resolves.toEqual({ error: "timeout" });
  });

  it("reports provider errors instead of a token", async () => {
    const { pending, post } = setup();
    post({ source: "hay-challenge", type: "error", code: "110200" });
    await expect(pending).resolves.toEqual({ error: "110200" });
  });
});
