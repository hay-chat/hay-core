import { useEffect, useMemo, useRef } from "react";
import { Linking, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  chatPageHtml,
  conversationStartedDoneScript,
  parseChatPageMessage,
  showChatScript,
  staysInChat,
} from "./page";

export interface HayChatProps {
  /** Your organization ID, from Settings > Webchat > Install. */
  organizationId: string;
  /** The Hay API address from the same snippet, e.g. the `baseUrl` it shows. */
  baseUrl: string;
  /**
   * One of your allowed websites (Settings > Webchat > Install), with its
   * scheme: "https://shop.example.com". The chat runs as if on that site.
   */
  origin: string;
  /**
   * The signed-in customer. `signature` is the hex HMAC-SHA256 of `externalId`
   * keyed with your identity secret, computed on your server: the secret must
   * never ship inside the app. Without a signature the visitor is anonymous.
   */
  customer?: { externalId: string; signature?: string };
  /** Non-sensitive context for the assistant (plan, screen, cart...). */
  context?: Record<string, unknown>;
  /** Locale for the chat's own text ("en-us", "pt-br"...). Defaults to the device's. */
  locale?: string;
  /** Overrides the colour set in Settings > Webchat ("#rrggbb"). */
  brandColor?: string;
  /** Overrides the theme set in Settings > Webchat. */
  themeMode?: "light" | "dark" | "system";
  /** "strict" keeps conversations out of device storage until the visitor has agreed elsewhere. */
  consent?: "strict" | "implicit";
  /**
   * Keep the chat mounted but hidden (`false`) so replies still arrive and
   * count as unread, then show it (`true`). Defaults to shown.
   */
  visible?: boolean;
  /** The chat is on screen and ready for a question. */
  onReady?: () => void;
  /** The visitor pressed the chat's close button: take the screen away. Without it the chat stays open. */
  onClose?: () => void;
  /** Replies that arrived while the chat was hidden. */
  onUnreadChange?: (count: number) => void;
  /**
   * A conversation was created (on the visitor's first message). Return a
   * promise to hold that message until, say, your server has attached data to
   * the conversation with @hay/server-sdk (at most 15 seconds).
   */
  onConversationStarted?: (conversation: { id: string }) => void | Promise<void>;
  /** Log the chat's diagnostics to the WebView console. */
  debug?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Hay chat, full size inside whatever view you put it in (a screen, a
 * modal, a bottom sheet). It is the same chat your website shows.
 */
export function HayChat(props: HayChatProps) {
  // `{}`: the library's default type parameter leaves the component without props.
  const webView = useRef<WebView<{}>>(null);
  // The latest callbacks, without rebuilding the page when they change.
  const latest = useRef(props);
  latest.current = props;

  const { organizationId, baseUrl, origin, customer, locale, brandColor, themeMode, consent } =
    props;
  const contextJson = JSON.stringify(props.context ?? null);
  const waitForConversationStarted = Boolean(props.onConversationStarted);

  // The page is rebuilt (and the chat reloaded) only when what it was built from changes.
  const html = useMemo(
    () =>
      chatPageHtml({
        organizationId,
        baseUrl,
        customerExternalId: customer?.externalId,
        customerExternalIdSignature: customer?.signature,
        context: JSON.parse(contextJson) ?? undefined,
        locale,
        brandColor,
        themeMode,
        consent,
        debug: latest.current.debug,
        waitForConversationStarted,
        startClosed: latest.current.visible === false,
      }),
    [
      organizationId,
      baseUrl,
      customer?.externalId,
      customer?.signature,
      contextJson,
      locale,
      brandColor,
      themeMode,
      consent,
      waitForConversationStarted,
    ],
  );

  const visible = props.visible !== false;
  useEffect(() => {
    webView.current?.injectJavaScript(showChatScript(visible));
  }, [visible]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseChatPageMessage(event.nativeEvent.data);
    if (!message) return;
    const { onReady, onClose, onUnreadChange, onConversationStarted } = latest.current;
    switch (message.type) {
      case "ready":
        return onReady?.();
      case "close":
        if (onClose) return onClose();
        // Nobody takes the screen away, so an empty one must not be left behind.
        return webView.current?.injectJavaScript(showChatScript(true));
      case "unread":
        return onUnreadChange?.(message.count);
      case "conversationStarted": {
        const done = () =>
          webView.current?.injectJavaScript(conversationStartedDoneScript(message.id));
        void Promise.resolve()
          .then(() => onConversationStarted?.({ id: message.id }))
          .then(done, done);
      }
    }
  };

  return (
    <WebView
      ref={webView}
      source={{ html, baseUrl: origin }}
      originWhitelist={["*"]}
      style={[{ flex: 1, backgroundColor: "transparent" }, props.style]}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(request) => {
        if (staysInChat(request, { origin, baseUrl })) return true;
        void Linking.openURL(request.url).catch(() => {});
        return false;
      }}
      // Links that ask for a new window go through the check above too (Android).
      setSupportMultipleWindows={false}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      keyboardDisplayRequiresUserAction={false}
      bounces={false}
      overScrollMode="never"
    />
  );
}
