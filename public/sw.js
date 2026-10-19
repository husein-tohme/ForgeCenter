// Makes Forgehub installable as an app. Pages always come from the network; when
// offline, a short notice is shown instead of the browser's error page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    "<!doctype html><meta name=viewport content='width=device-width'><title>Offline</title><body style='font:16px system-ui;background:#0f1115;color:#e8eaee;padding:40px'><h1>You're offline</h1><p>Forgehub needs the internet. Reconnect and reload.</p>",
    { headers: { "Content-Type": "text/html" } })));
});
