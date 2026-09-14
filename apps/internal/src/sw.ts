/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

export const POS_SW_SCHEMA_VERSION = Number.parseInt("3", 10);

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const manifest = self.__WB_MANIFEST;
precacheAndRoute(manifest);
cleanupOutdatedCaches();

registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | string | undefined;
  if (data === "SKIP_WAITING" || (typeof data === "object" && data?.type === "SKIP_WAITING")) {
    void self.skipWaiting();
    return;
  }
  if (typeof data === "object" && data?.type === "POS_RELEASE") {
    const port = event.ports[0];
    const extendable = event as ExtendableMessageEvent;
    extendable.waitUntil(
      collectRelease()
        .then((release) => {
          port?.postMessage(release);
        })
        .catch(() => {
          port?.postMessage({
            schemaVersion: POS_SW_SCHEMA_VERSION,
            manifest,
            cacheName: "",
            cacheKeys: [],
            exactPresent: false,
          });
        }),
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function collectRelease() {
  const cacheKeys = manifest
    .map((entry) => getCacheKeyForURL(typeof entry === "string" ? entry : entry.url))
    .filter((key): key is string => Boolean(key));
  let cacheName = "";
  const names = await caches.keys();
  for (const name of names) {
    const opened = await caches.open(name);
    const first = cacheKeys[0];
    if (first && (await opened.match(first))) {
      cacheName = name;
      break;
    }
  }
  const exactPresent =
    cacheKeys.length === manifest.length &&
    (await Promise.all(manifest.map((entry) => matchPrecache(typeof entry === "string" ? entry : entry.url)))).every(
      Boolean,
    );
  return {
    schemaVersion: POS_SW_SCHEMA_VERSION,
    manifest,
    cacheName,
    cacheKeys,
    exactPresent,
  };
}
