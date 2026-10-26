/*
 * Hay dashboard service worker: Web Push only (no asset caching).
 * Payload shape is PushPayload in server/services/push-notification.service.ts.
 */
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
    data = { title: "Hay", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Hay";
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
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        return existing.focus().then((focused) => {
          if (focused && "navigate" in focused) {
            return focused.navigate(target).catch(() => focused);
          }
          return focused;
        });
      }
      return self.clients.openWindow(target);
    }),
  );
});
