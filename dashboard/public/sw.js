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
  const requested = (event.notification.data && event.notification.data.url) || "/";
  let target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin) {
    target = new URL("/", self.location.origin);
  }
  const href = target.href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const sameOrigin = windows.filter((client) => new URL(client.url).origin === self.location.origin);
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
