import { ref } from "vue";
import { Hay } from "@/utils/api";

/**
 * Web Push opt-in for this browser/device. The server only knows about a device
 * once `enable()` succeeds. A device belongs to the user, not to one
 * organization: it gets the alerts of every organization the user is in.
 * `sync()` re-sends the current subscription on every app open (idempotent
 * upsert), so a subscription the browser rotated or the server pruned comes
 * back without the user doing anything. On logout `releaseForLogout()` drops
 * it, so a logged-out phone stops showing customer names.
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
/** Minimum gap between two background re-syncs (app open, back to foreground). */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let lastSyncAt = 0;

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

/** Base64url of the key a subscription was created with, for VAPID rotation checks. */
function subscriptionServerKey(subscription: PushSubscription): string | null {
  const key = subscription.options?.applicationServerKey;
  if (!key) return null;
  const bytes = new Uint8Array(key);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The worker's script URL carries the API base so its `pushsubscriptionchange`
 * handler can re-register a rotated subscription without a page open.
 */
function workerUrl(): string {
  const api = `${useRuntimeConfig().public.apiBaseUrl}/v1`;
  return `${SW_PATH}?api=${encodeURIComponent(api)}`;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const url = workerUrl();
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  const scriptUrl =
    existing && (existing.active ?? existing.waiting ?? existing.installing)?.scriptURL;
  if (existing && scriptUrl === new URL(url, window.location.origin).href) return existing;
  // First registration, or a worker registered before the API base was in its URL
  return navigator.serviceWorker.register(url);
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

/** Subscribe (or re-subscribe after a VAPID key rotation) and register with the server. */
async function subscribeAndRegister(key: string): Promise<void> {
  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an older server key can never be delivered to
  if (subscription && subscriptionServerKey(subscription) !== key) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });
  await Hay.notifications.subscribePush.mutate(subscriptionToInput(subscription));
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
      await subscribeAndRegister(key);
      lastSyncAt = Date.now();
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

  /**
   * Re-register this device's subscription with the server. Runs on every app
   * open and when the app comes back to the foreground (throttled). Only does
   * work when the user opted in on this device (permission granted and a
   * browser subscription exists); never prompts.
   */
  const sync = async (): Promise<void> => {
    if (!isSupported() || Notification.permission !== "granted") return;
    if (Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
    lastSyncAt = Date.now();
    await init();
    if (status.value !== "on") return;
    try {
      const key = await fetchPublicKey();
      if (!key) return;
      await subscribeAndRegister(key);
    } catch (err) {
      console.error("[Push] sync failed:", err);
    }
  };

  /**
   * Logout: drop this device's browser subscription and return its endpoint
   * so the logout call can delete the server row (works after the access
   * token expired). Never throws; logout must not depend on it.
   */
  const releaseForLogout = async (): Promise<string | undefined> => {
    if (!isSupported()) return undefined;
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return undefined;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      status.value = "off";
      lastSyncAt = 0;
      return endpoint;
    } catch (err) {
      console.error("[Push] release on logout failed:", err);
      return undefined;
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
    init,
    enable,
    disable,
    sync,
    releaseForLogout,
    sendTest,
  };
}
