/**
 * The demo has no server. This worker only forwards requests for ./api/* to the page that owns
 * them, where the real theFinder engine runs on an in-memory driver, and returns its answer.
 * It keeps no state of its own, so the browser can stop and restart it at any time.
 */

const API = new URL("./api/", self.location.href).href;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data === "claim") event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (!event.request.url.startsWith(API)) return;
  event.respondWith(forward(event));
});

/** The engine lives in a window: the requesting one, or for downloads and new tabs any demo window. */
async function engineClient(event) {
  if (event.clientId) {
    const client = await self.clients.get(event.clientId);
    if (client) return client;
  }
  const windows = await self.clients.matchAll({ type: "window" });
  return windows.find((c) => c.url.startsWith(self.registration.scope)) ?? null;
}

async function forward(event) {
  const client = await engineClient(event);
  if (!client) return new Response("The demo tab is closed.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });

  const req = event.request;
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const channel = new MessageChannel();
  const reply = new Promise((resolve) => (channel.port1.onmessage = (e) => resolve(e.data)));
  client.postMessage(
    { type: "thefinder:request", url: req.url, method: req.method, headers: [...req.headers], body },
    body ? [channel.port2, body] : [channel.port2],
  );

  const res = await reply;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
