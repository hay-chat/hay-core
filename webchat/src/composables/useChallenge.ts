import { ref, shallowRef } from "vue";
import type { HayChatConfig, WidgetContribution } from "@/types";
import { resolveLocale } from "@/i18n/resolve";

/** Must match the server's CHALLENGE_MESSAGE_SOURCE. */
const MESSAGE_SOURCE = "hay-challenge";
/** How long an invisible check may take before we give up and let the server decide. */
const INVISIBLE_TIMEOUT_MS = 15_000;
/** How long a shopper gets to finish a visible check. */
const INTERACTIVE_TIMEOUT_MS = 120_000;

export interface ChallengeResult {
  token?: string;
  /** Why no token was produced (timeout, provider error code...). */
  error?: string;
}

/**
 * Runs a `challenge@1` contribution: loads the Hay.chat-hosted challenge frame
 * (served from the API host), and waits for it to post a token back.
 *
 * Only messages from the API origin AND from our own iframe's window are
 * accepted. The frame stays invisible unless the provider needs the shopper to
 * interact. It never blocks forever: on timeout or error it resolves with an
 * error code and the server applies its policy (allow + flag in invisible mode).
 */
export function useChallenge(config: HayChatConfig) {
  /** Element the frame is mounted into (set by the chat UI). */
  const host = shallowRef<HTMLElement | null>(null);
  /** True while the provider needs the shopper to interact with the frame. */
  const isInteractive = ref(false);

  const apiOrigin = (() => {
    try {
      return new URL(config.baseUrl).origin;
    } catch {
      return null;
    }
  })();

  const challengeUrl = (contribution: WidgetContribution): string => {
    const params = new URLSearchParams({
      org: config.organizationId,
      c: contribution.id,
      origin: window.location.origin,
      lang: resolveLocale(config.locale),
    });
    return `${config.baseUrl}/v1/webchat/challenge?${params.toString()}`;
  };

  const run = (contribution: WidgetContribution): Promise<ChallengeResult> =>
    new Promise((resolve) => {
      if (!apiOrigin || !host.value) {
        resolve({ error: "unavailable" });
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.src = challengeUrl(contribution);
      iframe.title = "Hay.chat security check";
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.className = "hay-challenge-frame";

      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: ChallengeResult) => {
        window.removeEventListener("message", onMessage);
        if (timer) clearTimeout(timer);
        isInteractive.value = false;
        iframe.remove();
        resolve(result);
      };
      const arm = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish({ error: "timeout" }), ms);
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== apiOrigin || event.source !== iframe.contentWindow) return;
        const data = event.data as { source?: unknown; type?: unknown; token?: unknown; code?: unknown };
        if (!data || data.source !== MESSAGE_SOURCE) return;

        if (data.type === "token" && typeof data.token === "string" && data.token) {
          finish({ token: data.token });
        } else if (data.type === "interactive") {
          isInteractive.value = true;
          arm(INTERACTIVE_TIMEOUT_MS);
        } else if (data.type === "error" || data.type === "expired") {
          finish({ error: typeof data.code === "string" ? data.code.slice(0, 60) : String(data.type) });
        }
      };

      window.addEventListener("message", onMessage);
      iframe.addEventListener("error", () => finish({ error: "frame_failed" }));
      arm(contribution.props.mode === "challenge_all" ? INTERACTIVE_TIMEOUT_MS : INVISIBLE_TIMEOUT_MS);
      host.value.appendChild(iframe);
    });

  return { host, isInteractive, run };
}
