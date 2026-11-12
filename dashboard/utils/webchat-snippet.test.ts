import { describe, expect, it } from "vitest";
import { buildWebchatSnippet, jsString } from "./webchat-snippet";

const base = {
  organizationId: "org-1",
  baseUrl: "https://api.hay.test",
  widgetTitle: "Chat with us",
  position: "right",
  isEnabled: true,
  showGreeting: true,
  greetingMessage: "Hello!",
};

/** Evaluates the config object the snippet assigns, the way a browser would. */
function evalConfig(snippet: string): Record<string, unknown> {
  const body = snippet.split("<" + "script>")[1].split("</" + "script>")[0];
  const window: { HayChat?: { config?: Record<string, unknown> } } = {};
  new Function("window", body)(window);
  return window.HayChat!.config!;
}

describe("buildWebchatSnippet", () => {
  it("keeps a title with an apostrophe valid JavaScript", () => {
    const config = evalConfig(buildWebchatSnippet({ ...base, widgetTitle: "Alma's help desk" }));
    expect(config.widgetTitle).toBe("Alma's help desk");
  });

  it("round-trips backslashes, line breaks and a closing script tag", () => {
    const tricky = "a\\b\nc </script><b>";
    const snippet = buildWebchatSnippet({ ...base, greetingMessage: tricky });
    expect(evalConfig(snippet).greetingMessage).toBe(tricky);
    // Only the two real script tags may appear, so the text cannot end the block early.
    expect(snippet.match(/<\/script>/g)).toHaveLength(2);
  });

  it("leaves the greeting out when web chat is off", () => {
    const config = evalConfig(buildWebchatSnippet({ ...base, isEnabled: false }));
    expect(config).not.toHaveProperty("greetingMessage");
    expect(config.position).toBe("right");
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
