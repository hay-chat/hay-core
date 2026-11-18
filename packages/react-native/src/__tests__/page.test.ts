import { describe, expect, it } from "vitest";
import {
  chatPageHtml,
  conversationStartedDoneScript,
  parseChatPageMessage,
  scriptJson,
  showChatScript,
  staysInChat,
} from "../page";

const options = { organizationId: "org-1", baseUrl: "https://api.example.test/" };

describe("chatPageHtml", () => {
  it("loads widget.js from the API and turns embedded mode on", () => {
    const html = chatPageHtml(options);
    expect(html).toContain('<script src="https://api.example.test/v1/webchat/widget.js" async>');
    expect(html).toContain('"baseUrl":"https://api.example.test"');
    expect(html).toContain("config.embedded = {");
    expect(html).toContain("startClosed: false");
  });

  it("carries the customer, context and start state into the config", () => {
    const html = chatPageHtml({
      ...options,
      customerExternalId: "user-7",
      customerExternalIdSignature: "abc123",
      context: { plan: "pro" },
      startClosed: true,
    });
    expect(html).toContain('"customerExternalId":"user-7"');
    expect(html).toContain('"customerExternalIdSignature":"abc123"');
    expect(html).toContain('"context":{"plan":"pro"}');
    expect(html).toContain("startClosed: true");
  });

  it("keeps a value from closing the script tag", () => {
    const html = chatPageHtml({ ...options, context: { note: "</script><script>alert(1)" } });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("keeps a base URL from breaking out of the script's src", () => {
    const html = chatPageHtml({ ...options, baseUrl: 'https://x.test"><img src=x>' });
    expect(html).not.toContain('"><img');
  });

  it("produces a config script that runs and reports to the app", async () => {
    const html = chatPageHtml({ ...options, waitForConversationStarted: true });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const posted: string[] = [];
    const window: Record<string, any> = {
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    };
    new Function("window", script)(window);

    const config = window.HayChat.config;
    config.embedded.onUnread(3);
    expect(parseChatPageMessage(posted[0])).toEqual({ type: "unread", count: 3 });

    // The first message waits until the app says its callback has finished.
    let released = false;
    const waiting = config.onConversationStarted({ id: "c-1" }).then(() => (released = true));
    expect(parseChatPageMessage(posted[1])).toEqual({ type: "conversationStarted", id: "c-1" });
    await Promise.resolve();
    expect(released).toBe(false);
    new Function("window", conversationStartedDoneScript("c-1"))(window);
    await waiting;
    expect(released).toBe(true);
  });
});

describe("scriptJson", () => {
  it("escapes what would end a script or a line", () => {
    expect(scriptJson("<\u2028\u2029")).toBe('"\\u003c\\u2028\\u2029"');
  });
});

describe("parseChatPageMessage", () => {
  it("ignores anything that is not from the chat page", () => {
    expect(parseChatPageMessage("not json")).toBeNull();
    expect(parseChatPageMessage('{"type":"close"}')).toBeNull();
    expect(parseChatPageMessage('{"source":"hay-chat","type":"unread"}')).toBeNull();
    expect(parseChatPageMessage('{"source":"hay-chat","type":"close"}')).toEqual({ type: "close" });
  });
});

describe("staysInChat", () => {
  const page = { origin: "https://shop.example.com", baseUrl: "https://api.example.test" };

  it("keeps the chat page, frames and Hay's own pages in the WebView", () => {
    expect(staysInChat({ url: "https://shop.example.com/" }, page)).toBe(true);
    expect(staysInChat({ url: "about:blank" }, page)).toBe(true);
    expect(staysInChat({ url: "https://challenges.example/x", isTopFrame: false }, page)).toBe(
      true,
    );
    expect(staysInChat({ url: "https://api.example.test/v1/webchat/challenge?x" }, page)).toBe(
      true,
    );
  });

  it("sends tapped links to the device's browser", () => {
    expect(staysInChat({ url: "https://shop.example.com/products/1" }, page)).toBe(false);
    expect(staysInChat({ url: "https://elsewhere.example/" }, page)).toBe(false);
    expect(staysInChat({ url: "https://api.example.test.evil.example/" }, page)).toBe(false);
  });
});

describe("showChatScript", () => {
  it("calls open or close when the chat has them, and nothing before that", () => {
    const calls: string[] = [];
    const window = { HayChat: { open: () => calls.push("open"), close: () => calls.push("close") } };
    new Function("window", showChatScript(true))(window);
    new Function("window", showChatScript(false))(window);
    new Function("window", showChatScript(true))({});
    expect(calls).toEqual(["open", "close"]);
  });
});
