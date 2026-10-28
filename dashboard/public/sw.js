/*
 * Hay.chat dashboard service worker: Web Push only (no asset caching).
 * Payload shape is PushPayload in server/services/push-notification.service.ts.
 * Registered as /sw.js?api=<API base incl. /v1> (usePushNotifications.ts).
 */
const API_BASE = new URL(self.location.href).searchParams.get("api");
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Hay.chat", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Hay.chat";
  const options = {
    body: data.body || "",
    tag: data.tag || "hay",
    renotify: true,
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = (event.notification.data && event.notification.data.url) || "/";
  let target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin) {
    target = new URL("/", self.location.origin);
  }
  const href = target.href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const sameOrigin = windows.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      // Already on the right page: just bring it forward
      const exact = sameOrigin.find((client) => client.url === href);
      if (exact) return exact.focus();

      const existing = sameOrigin[0];
      if (existing && "navigate" in existing) {
        // navigate() only works on clients this worker controls; otherwise open a new window
        return existing
          .navigate(href)
          .then((client) => (client ? client.focus() : self.clients.openWindow(href)))
          .catch(() => self.clients.openWindow(href));
      }
      return self.clients.openWindow(href);
    }),
  );
});

/*
 * The browser replaced this device's subscription (expiry or key refresh).
 * Re-subscribe with the same server key and tell the server, which finds the
 * device by its old endpoint (no access token in a service worker). If the
 * old subscription is unknown, the next app open re-registers it (sync()).
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      if (!old || !API_BASE) return;
      // The old auth secret proves this device owns the old subscription.
      const oldAuth = (old.toJSON().keys || {}).auth;
      if (!oldAuth) return;
      let next = event.newSubscription;
      if (!next) {
        const key = old.options && old.options.applicationServerKey;
        if (!key) return;
        next = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }
      const keys = next.toJSON().keys || {};
      await fetch(`${API_BASE}/notifications.rotatePush`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldEndpoint: old.endpoint,
          oldAuth,
          endpoint: next.endpoint,
          keys: { p256dh: keys.p256dh || "", auth: keys.auth || "" },
        }),
      });
    })().catch((error) => console.error("[sw] pushsubscriptionchange failed", error)),
  );
});
