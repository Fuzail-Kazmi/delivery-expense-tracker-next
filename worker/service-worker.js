import "./push.js";
import { activeOwner, syncLedger, announce } from "../lib/offline";
const cacheName = "watertracker-shell-" + OFFLINE_BUILD;
const pages = new Set([
  "",
  "signin",
  "dashboard",
  "deliveries",
  "payments",
  "pricing",
  "ledger",
  "reports",
  "settings",
  "users",
]);
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      const response = await fetch("/offline", {
        credentials: "omit",
        cache: "reload",
      });
      if (!response.ok || response.redirected)
        throw Error("Offline screen unavailable");
      const html = await response.clone().text();
      const assets = new Set(
        [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map(
            (m) => new URL(m[1].replaceAll("&amp;", "&"), self.location.origin),
          )
          .filter(
            (url) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith("/_next/static/"),
          )
          .map((url) => url.href),
      );
      if (!assets.size) throw Error("Offline bundles unavailable");
      await cache.addAll([
        ...assets,
        "/manifest.webmanifest",
        "/water-192.png",
        "/water-512.png",
        "/favicon.svg",
      ]);
      await cache.put("/offline", response);
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("watertracker-shell-") && key !== cacheName)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const route = url.pathname.replace(/^\/|\/$/g, "");
  if (req.mode === "navigate" && (pages.has(route) || route === "offline")) {
    event.respondWith(
      (async () => {
        if (route === "offline")
          return (await caches.open(cacheName))
            .match("/offline")
            .then((r) => r || fetch(req));
        if (
          !url.searchParams.has("verify") &&
          pages.has(route) &&
          route !== "signin" &&
          (await activeOwner().catch(() => null))
        ) {
          const shell = await (await caches.open(cacheName)).match("/offline");
          if (shell) return shell;
        }
        try {
          return await fetch(req);
        } catch {
          return Response.redirect(
            self.location.origin +
              "/offline?view=" +
              (route === "signin" ? "dashboard" : route || "dashboard"),
            302,
          );
        }
      })(),
    );
  } else if (
    url.pathname.startsWith("/_next/static/") ||
    [
      "/manifest.webmanifest",
      "/water-192.png",
      "/water-512.png",
      "/favicon.svg",
    ].includes(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(cacheName);
        return (await cache.match(req)) || fetch(req);
      })(),
    );
  }
});
self.addEventListener("sync", (event) => {
  if (event.tag === "watertracker-entries")
    event.waitUntil(
      (async () => {
        const owner = await activeOwner();
        if (owner) {
          await syncLedger(owner);
          announce();
        }
      })(),
    );
});
