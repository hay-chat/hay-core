// The page the WebView shows: the same widget.js every website loads, in
// embedded mode. Nothing here imports React Native, so it is tested on its own.

/** Marks the messages this page posts to the app. */
export const MESSAGE_SOURCE = "hay-chat";

/** How long the first message waits for the app's `onConversationStarted`. */
const CONVERSATION_STARTED_TIMEOUT_MS = 15_000;

export interface ChatPageOptions {
  organizationId: string;
  /** The Hay API, without a trailing slash. */
  baseUrl: string;
  customerExternalId?: string;
  customerExternalIdSignature?: string;
  context?: Record<string, unknown>;
  locale?: string;
  brandColor?: string;
  themeMode?: "light" | "dark" | "system";
  consent?: "strict" | "implicit";
  debug?: boolean;
  /** The app has an `onConversationStarted`: hold the first message until it answers. */
  waitForConversationStarted?: boolean;
  /** The app shows the chat later (`visible={false}`): load it closed. */
  startClosed?: boolean;
}

export type ChatPageMessage =
  | { type: "ready" }
  | { type: "close" }
  | { type: "unread"; count: number }
  | { type: "conversationStarted"; id: string };

/**
 * JSON that is safe inside a <script>: `<` would let a value close the tag,
 * and U+2028/U+2029 end a line in older JavaScript engines.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** No regular expression: one anchored at the end is slow on a long run of slashes. */
function withoutTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export function chatPageHtml(options: ChatPageOptions): string {
  const { waitForConversationStarted, startClosed, ...rest } = options;
  const config = { ...rest, baseUrl: withoutTrailingSlash(rest.baseUrl) };
  const widgetUrl = `${config.baseUrl}/v1/webchat/widget.js`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<style>html,body{margin:0;height:100%;background:transparent}</style>
</head>
<body>
<script>
(function () {
  function post(message) {
    message.source = ${scriptJson(MESSAGE_SOURCE)};
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  var started = {};
  // The app calls this once its onConversationStarted has finished.
  window.__hayConversationStartedDone = function (id) {
    if (started[id]) started[id]();
  };
  var config = ${scriptJson(config)};
  config.embedded = {
    startClosed: ${scriptJson(Boolean(startClosed))},
    onReady: function () { post({ type: "ready" }); },
    onClose: function () { post({ type: "close" }); },
    onUnread: function (count) { post({ type: "unread", count: count }); }
  };
  config.onConversationStarted = function (conversation) {
    post({ type: "conversationStarted", id: conversation.id });
    if (!${scriptJson(Boolean(waitForConversationStarted))}) return;
    return new Promise(function (resolve) {
      started[conversation.id] = resolve;
      setTimeout(resolve, ${CONVERSATION_STARTED_TIMEOUT_MS});
    });
  };
  window.HayChat = { config: config };
})();
</script>
<script src="${escapeAttribute(widgetUrl)}" async></script>
</body>
</html>`;
}

/** A message from the chat page, or null for anything else the WebView relays. */
export function parseChatPageMessage(data: string): ChatPageMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { source, type, count, id } = message as Record<string, unknown>;
  if (source !== MESSAGE_SOURCE) return null;
  if (type === "ready" || type === "close") return { type };
  if (type === "unread" && typeof count === "number") return { type, count };
  if (type === "conversationStarted" && typeof id === "string") return { type, id };
  return null;
}

/**
 * Whether the WebView itself may load `url`. The chat page (served as if from
 * `origin`), anything inside a frame (the bot check) and Hay's own pages stay
 * in; a link the visitor tapped belongs in the device's browser.
 */
export function staysInChat(
  request: { url: string; isTopFrame?: boolean },
  page: { origin: string; baseUrl: string },
): boolean {
  if (request.isTopFrame === false) return true;
  const url = withoutTrailingSlash(request.url);
  if (url === "about:blank" || url === withoutTrailingSlash(page.origin)) return true;
  return url.startsWith(`${withoutTrailingSlash(page.baseUrl)}/`);
}

/** JavaScript for `injectJavaScript`; the trailing `true` keeps iOS quiet. */
export const showChatScript = (visible: boolean) =>
  `window.HayChat && window.HayChat.${visible ? "open" : "close"} && window.HayChat.${visible ? "open" : "close"}(); true;`;

export const conversationStartedDoneScript = (id: string) =>
  `window.__hayConversationStartedDone && window.__hayConversationStartedDone(${scriptJson(id)}); true;`;
