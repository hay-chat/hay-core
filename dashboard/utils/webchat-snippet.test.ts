import { describe, expect, it } from "vitest";
import { buildWebchatSnippet, jsString } from "./webchat-snippet";

const base = { organizationId: "org-1", baseUrl: "https://api.hay.test" };

/** Evaluates the config object the snippet assigns, the way a browser would. */
function evalConfig(snippet: string): Record<string, unknown> {
  const body = snippet.split("<" + "script>")[1].split("</" + "script>")[0];
  const window: { HayChat?: { config?: Record<string, unknown> } } = {};
  new Function("window", body)(window);
  return window.HayChat!.config!;
}

describe("buildWebchatSnippet", () => {
  it("carries only the organization and base url, so dashboard settings apply", () => {
    expect(evalConfig(buildWebchatSnippet(base))).toEqual({
      organizationId: "org-1",
      baseUrl: "https://api.hay.test",
    });
  });

  it("keeps an id with quotes and a closing script tag inside the string", () => {
    const tricky = "a'b </script><b>";
    const snippet = buildWebchatSnippet({ ...base, organizationId: tricky });
    expect(evalConfig(snippet).organizationId).toBe(tricky);
    // Only the two real script tags may appear, so the value cannot end the block early.
    expect(snippet.match(/<\/script>/g)).toHaveLength(2);
  });

  it("loads the widget from the base url", () => {
    expect(buildWebchatSnippet(base)).toContain(
      'src="https://api.hay.test/v1/webchat/widget.js" async',
    );
  });
});

describe("jsString", () => {
  it("escapes line and paragraph separators", () => {
    expect(jsString("a\u2028b")).toBe("'a\\u2028b'");
  });
});
