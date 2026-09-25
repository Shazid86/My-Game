/* Graveyard Shift offline shell.
   Bump CACHE on each release to bust the cached single-file build (index.html carries all JS/CSS).
   Strategy: cache-first everywhere — navigations serve the cached shell and refresh it in the
   background while online; fonts fill the cache on first load and then survive Flight Mode. */
const CACHE = "gs-shell-v1";
const PRECACHE = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("gs-shell-") && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // app shell: instant from cache, revalidated in the background while online
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((hit) => {
        fetch("./index.html")
          .then((res) => {
            if (res && res.ok) {
              caches.open(CACHE).then((cache) => cache.put("./index.html", res.clone()));
            }
          })
          .catch(() => {});
        return (
          hit ||
          fetch("./index.html").catch(
            () =>
              new Response(
                "<!doctype html><meta charset=utf-8><title>Offline</title><h1>OFFLINE — THE YARD WAITS</h1>",
                { headers: { "Content-Type": "text/html; charset=utf-8" } },
              ),
          )
        );
      }),
    );
    return;
  }

  // assets + fonts: cache-first with runtime fill
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const url = new URL(req.url);
          const cacheable =
            res &&
            (res.ok || res.type === "opaque") &&
            (url.origin === self.location.origin || url.host.startsWith("fonts.g"));
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => Response.error());
    }),
  );
});
