export interface HayChatConfig {
  organizationId: string;
  baseUrl: string;
  widgetTitle?: string;
  widgetSubtitle?: string;
  position?: "left" | "right";
  theme?: "blue" | "green" | "purple" | "black";
  showGreeting?: boolean;
  greetingMessage?: string;
  /** Public context passed to the AI prompt. Safe for non-sensitive data only. */
  context?: Record<string, unknown>;
  /**
   * External ID of the logged-in user in your system. Links the conversation to
   * that customer only together with `customerExternalIdSignature`; unsigned,
   * the visitor is treated as anonymous.
   */
  customerExternalId?: string;
  /**
   * hex HMAC-SHA256 of `customerExternalId`, keyed with the organization's
   * identity secret (Settings > Webchat). Compute it on your server, never in
   * the browser, so the secret is never exposed.
   */
  customerExternalIdSignature?: string;
  /** Locale for widget UI strings (e.g. "en-us", "pt-br", "fr-fr"). Auto-detected from browser if omitted. */
  locale?: string;
  /**
   * Called after a conversation is created, which happens when the visitor
   * sends their first message (opening the widget creates nothing). Use this
   * to attach server-side secrets. If it returns a Promise, that first message
   * is sent only once it resolves.
   */
  onConversationStarted?: (conversation: { id: string }) => void | Promise<void>;
  /** Agent name displayed in the header. Populated from public config. */
  agentName?: string;
  /** Agent avatar image URL (relative path). Falls back to organizationLogoUrl. */
  agentAvatarUrl?: string;
  /** Organization logo URL (relative path). Used as fallback for agent avatar. */
  organizationLogoUrl?: string;
  /**
   * ePrivacy consent mode for device storage.
   * - `'implicit'` (default): persistent storage (localStorage, IndexedDB) is
   *   enabled automatically once the visitor sends their first message, unless
   *   the host calls `window.HayChat.revokeConsent()`.
   * - `'strict'`: persistent storage is only enabled after the host calls
   *   `window.HayChat.grantConsent()` (e.g. from a cookie banner's Accept).
   * In both modes, no device storage is touched before the first user message,
   * unless `grantConsent()` is called earlier in the page lifecycle.
   */
  consent?: "strict" | "implicit";
  /** Log widget diagnostics to the browser console. Off by default. */
  debug?: boolean;
  /**
   * When the chat itself (everything but the button) is downloaded.
   * - `'idle'` (default): once the page has finished loading and the browser
   *   is idle, or earlier if the visitor reaches for the button.
   * - `'eager'`: straight away.
   * - `'interaction'`: only when the visitor hovers, focuses, touches or
   *   clicks the button. Nothing at all is fetched before that, not even the
   *   widget settings, so a disabled widget shows its button until then.
   * A visitor with a conversation in progress in this tab always gets it
   * straight away, so replies show on the badge.
   */
  loading?: LoadingMode;
}

export type LoadingMode = "eager" | "idle" | "interaction";

/** `webchat.getPublicConfig` response, fetched by the loader. */
export interface PublicConfig {
  enabled?: boolean;
  agentName?: string | null;
  agentAvatarUrl?: string | null;
  organizationLogoUrl?: string | null;
  /** Whether AI replies carry the AI label (D14-6). Missing = shown. */
  aiLabelShown?: boolean;
  /** The org's label text; null = the localized default. */
  aiLabelText?: string | null;
  /** Plugin contributions this widget advertised support for (never code). */
  contributions?: WidgetContribution[];
}

/** A declarative plugin contribution, rendered by the widget's own code. */
export interface WidgetContribution {
  id: string;
  type: "challenge@1";
  props: { provider: string; mode: "invisible" | "challenge_all" };
}

/** The loader's button, driven by the chat once it is mounted. */
export interface LauncherBridge {
  setOpen(open: boolean): void;
  setUnread(count: number): void;
}

/** A host API call made before the chat chunk loaded, replayed in order. */
export type HostCall =
  | { name: "addContext"; args: [key: string, value: unknown] }
  | { name: "grantConsent"; args: [] }
  | { name: "revokeConsent"; args: [] };

/** Contract between widget.js (the loader) and the chat chunk. */
export interface ChatMountOptions {
  container: HTMLElement;
  config: HayChatConfig;
  publicConfig: PublicConfig | null;
  launcher: LauncherBridge;
  hostCalls: HostCall[];
  /** The visitor clicked the button while the chat was loading. */
  open: boolean;
}

export interface ChatHandle {
  toggle(): void;
}

/** A file on a message (photo, PDF...). `url` is a signed link that expires. */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface Message {
  id: string;
  content: string;
  sender: "user" | "agent";
  timestamp: number;
  metadata?: Record<string, unknown>;
  isGreeting?: boolean;
  /** Original message type from server (BotAgent, HumanAgent, Customer, etc.) */
  agentType?: string;
  /** Human agent name when message is from a HumanAgent */
  senderName?: string;
  attachments?: Attachment[];
}

/** Shown under the input when the server refuses a message; `text` goes back into the input. */
export interface SendFailure {
  reason:
    | "sendFailed"
    | "messageTooLong"
    | "fileTooLarge"
    | "fileType"
    | "fileFailed"
    | "verificationFailed";
  text: string;
}

declare global {
  interface Window {
    HayChat?: {
      config?: HayChatConfig;
      addContext?: (key: string, value: unknown) => void;
      /** Signal visitor consent (typically from a host-site cookie banner). Unlocks persistent storage. */
      grantConsent?: () => void;
      /** Withdraw visitor consent. Wipes persistent `hay-*` storage; session state stays until tab close. */
      revokeConsent?: () => void;
    };
  }
}
