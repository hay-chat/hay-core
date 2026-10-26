import { ref, computed } from "vue";
import { Hay } from "@/utils/api";

/**
 * Web Push opt-in for this browser/device. The server only knows about a device
 * once `enable()` succeeds; `sync()` re-sends the current subscription so the
 * row follows the user's active organization after an org switch.
 *
 * Status meanings:
 *  - unsupported: browser has no Push API (or iOS Safari outside an installed PWA)
 *  - unavailable: server has no VAPID keys configured
 *  - denied: the user blocked notifications in the browser; only they can undo it
 *  - off / on: opted out / in on this device
 */
export type PushStatus = "loading" | "unsupported" | "unavailable" | "denied" | "off" | "on";

const status = ref<PushStatus>("loading");
const busy = ref(false);
const error = ref<string | null>(null);
let publicKey: string | null | undefined;
let initPromise: Promise<void> | null = null;

const SW_PATH = "/sw.js";

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID public key (base64url) → the Uint8Array `PushManager.subscribe` expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  return existing ?? navigator.serviceWorker.register(SW_PATH);
}

async function fetchPublicKey(): Promise<string | null> {
  if (publicKey !== undefined) return publicKey;
  const result = await Hay.notifications.pushPublicKey.query();
  publicKey = result.publicKey;
  return publicKey;
}

function subscriptionToInput(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" },
    userAgent: navigator.userAgent,
  };
}

async function detect(): Promise<void> {
  if (!isSupported()) {
    status.value = "unsupported";
    return;
  }
  try {
    const key = await fetchPublicKey();
    if (!key) {
      status.value = "unavailable";
      return;
    }
    if (Notification.permission === "denied") {
      status.value = "denied";
      return;
    }
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    status.value = subscription ? "on" : "off";
  } catch (err) {
    console.error("[Push] detection failed:", err);
    status.value = "unavailable";
  }
}

export function usePushNotifications() {
  const init = () => {
    if (!initPromise) initPromise = detect();
    return initPromise;
  };

  /** Opt this device in. Returns true when the server now has the subscription. */
  const enable = async (): Promise<boolean> => {
    await init();
    if (status.value === "unsupported" || status.value === "unavailable") return false;
    busy.value = true;
    error.value = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        status.value = permission === "denied" ? "denied" : "off";
        return false;
      }
      const key = await fetchPublicKey();
      if (!key) {
        status.value = "unavailable";
        return false;
      }
      const registration = await getRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));
      await Hay.notifications.subscribePush.mutate(subscriptionToInput(subscription));
      status.value = "on";
      return true;
    } catch (err) {
      console.error("[Push] enable failed:", err);
      error.value = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      busy.value = false;
    }
  };

  /** Opt this device out (browser subscription + server row). */
  const disable = async (): Promise<void> => {
    await init();
    if (!isSupported()) return;
    busy.value = true;
    error.value = null;
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await Hay.notifications.unsubscribePush.mutate({ endpoint });
      }
      status.value = "off";
    } catch (err) {
      console.error("[Push] disable failed:", err);
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  };

  /** Re-send an existing subscription so it is tied to the current user + org. */
  const sync = async (): Promise<void> => {
    await init();
    if (status.value !== "on") return;
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await Hay.notifications.subscribePush.mutate(subscriptionToInput(subscription));
      }
    } catch (err) {
      console.error("[Push] sync failed:", err);
    }
  };

  const sendTest = async (): Promise<{ sent: number; removed: number } | null> => {
    busy.value = true;
    try {
      return await Hay.notifications.sendTestPush.mutate();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      busy.value = false;
    }
  };

  return {
    status,
    busy,
    error,
    isOn: computed(() => status.value === "on"),
    canToggle: computed(() => status.value === "on" || status.value === "off"),
    init,
    enable,
    disable,
    sync,
    sendTest,
  };
}
