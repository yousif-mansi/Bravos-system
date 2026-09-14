import { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION, pos } from "./pos.ts";

type WorkerRelease = {
  schemaVersion: number;
  manifest: Array<{ url: string; revision: string | null }>;
  cacheName: string;
  cacheKeys: string[];
  exactPresent: boolean;
};

export async function registerPosServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return null;
  }
  const { registerSW } = await import("virtual:pwa-register");
  return new Promise((resolve) => {
    let resolved: ServiceWorkerRegistration | null = null;
    const update = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        resolved = registration ?? null;
        window.__bravosDecideUpdate = () => decideUpdate(update);
        resolve(resolved);
      },
      onRegisterError() {
        resolve(null);
      },
      onNeedRefresh() {
        void decideUpdate(update);
      },
    });
    window.setTimeout(() => resolve(resolved), 8000);
  });
}

export async function decideUpdate(update: (reload?: boolean) => Promise<void>) {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const incomingWorker = registration?.waiting ?? registration?.installing;
    if (!incomingWorker) {
      return;
    }
    const incoming = await queryWorkerRelease(incomingWorker);
    const stored = await pos.readSchemaVersion();
    const incomingMigrationSafe =
      isDeclaredSafeMigration(stored, incoming.schemaVersion) && (await pos.canUpgradeSafely(incoming.schemaVersion));
    if (
      evaluatePosUpdate({
        storedSchemaVersion: stored,
        incomingSchemaVersion: incoming.schemaVersion,
        incomingMigrationSafe,
      }) !== "activate"
    ) {
      window.dispatchEvent(new CustomEvent("bravos-update-deferred"));
      return;
    }
    await update(true);
  } catch {
    window.dispatchEvent(new CustomEvent("bravos-update-deferred"));
  }
}

function queryWorkerRelease(worker: ServiceWorker): Promise<WorkerRelease> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("release-timeout")), 4000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      const data = event.data as WorkerRelease | undefined;
      if (typeof data?.schemaVersion !== "number" || !Array.isArray(data.manifest)) {
        reject(new Error("invalid-release"));
        return;
      }
      resolve({
        schemaVersion: data.schemaVersion,
        manifest: data.manifest,
        cacheName: typeof data.cacheName === "string" ? data.cacheName : "",
        cacheKeys: Array.isArray(data.cacheKeys) ? data.cacheKeys.filter((key): key is string => typeof key === "string") : [],
        exactPresent: data.exactPresent === true,
      });
    };
    worker.postMessage({ type: "POS_RELEASE" }, [channel.port2]);
  });
}

export async function posCodeIsCached(): Promise<boolean> {
  if (!import.meta.env.PROD) {
    return true;
  }
  if (!("serviceWorker" in navigator) || !("caches" in window)) {
    return false;
  }
  const controller = navigator.serviceWorker.controller;
  if (!controller) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration?.active || registration.active.scriptURL !== controller.scriptURL) {
    return false;
  }
  let release: WorkerRelease;
  try {
    release = await queryWorkerRelease(controller);
  } catch {
    return false;
  }
  return currentReleaseAssetsPresent(release.manifest, release);
}

export async function currentReleaseAssetsPresent(
  manifest: Array<{ url: string; revision: string | null }>,
  release?: { cacheName: string; cacheKeys: string[]; exactPresent: boolean },
): Promise<boolean> {
  if (manifest.length === 0) {
    return false;
  }
  const urls = manifest.map((entry) => new URL(entry.url, window.location.origin).href);
  if (!urls.some((url) => url.includes("cashier-lookup"))) {
    return false;
  }
  if (!urls.some((url) => url.includes("cashier-sales"))) {
    return false;
  }
  if (!urls.some((url) => url.includes("index.html") || url.endsWith("/"))) {
    return false;
  }
  if (!urls.some((url) => url.includes("react"))) {
    return false;
  }
  if (!urls.some((url) => url.includes("router"))) {
    return false;
  }
  const cacheName = release?.cacheName;
  const cacheKeys = release?.cacheKeys ?? [];
  if (!cacheName || cacheKeys.length !== manifest.length) {
    return false;
  }
  if (release?.exactPresent === false) {
    return false;
  }
  const cache = await caches.open(cacheName);
  for (const key of cacheKeys) {
    const hit = await cache.match(key);
    if (!hit) {
      return false;
    }
  }
  return true;
}

export { POS_SCHEMA_VERSION };
