self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)
    || (request.cache === "only-if-cached" && request.mode !== "same-origin")) return;

  event.respondWith((async () => {
    const response = await fetch(request);
    if (!response.ok || response.redirected) return response;
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(response.body, {
      headers, status: response.status, statusText: response.statusText,
    });
  })());
});
