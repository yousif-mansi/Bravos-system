import type { Page, Request } from "@playwright/test";

export type StorefrontNavigationDiagnostic = {
  phase: "request" | "response" | "requestfinished" | "requestfailed" | "pageerror";
  url: string;
  method: string;
  resourceType: string;
  startedAtMs: number;
  atMs: number;
  status?: number;
  failure?: string;
  message?: string;
};

function monotonicNow() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function isMainRouteNavigation(origin: string, request: Request) {
  const url = new URL(request.url());
  if (url.origin !== origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  const headers = request.headers();
  const rsc = headers.rsc === "1" || url.searchParams.has("_rsc");
  return request.resourceType() === "document" || rsc;
}

/** Same-origin storefront document and RSC timings, plus page errors. */
export function recordStorefrontNavigation(page: Page, origin: string) {
  const diagnostics: StorefrontNavigationDiagnostic[] = [];
  const startedAt = new Map<Request, number>();

  const remember = (request: Request) => {
    if (!isMainRouteNavigation(origin, request)) return null;
    let started = startedAt.get(request);
    if (started === undefined) {
      started = monotonicNow();
      startedAt.set(request, started);
    }
    return started;
  };

  const onRequest = (request: Request) => {
    const started = remember(request);
    if (started === null) return;
    diagnostics.push({
      phase: "request",
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAtMs: started,
      atMs: started,
    });
  };
  const onResponse = (response: { request: () => Request; status: () => number; url: () => string }) => {
    const request = response.request();
    const started = remember(request);
    if (started === null) return;
    diagnostics.push({
      phase: "response",
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAtMs: started,
      atMs: monotonicNow(),
      status: response.status(),
    });
  };
  const onFinished = (request: Request) => {
    const started = remember(request);
    if (started === null) return;
    diagnostics.push({
      phase: "requestfinished",
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAtMs: started,
      atMs: monotonicNow(),
    });
  };
  const onFailed = (request: Request) => {
    const started = remember(request);
    if (started === null) return;
    diagnostics.push({
      phase: "requestfailed",
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAtMs: started,
      atMs: monotonicNow(),
      failure: request.failure()?.errorText ?? "Unknown request failure",
    });
  };
  const onPageError = (error: Error) => {
    const atMs = monotonicNow();
    diagnostics.push({
      phase: "pageerror",
      url: page.url(),
      method: "",
      resourceType: "pageerror",
      startedAtMs: atMs,
      atMs,
      message: error.message,
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  page.on("pageerror", onPageError);

  return {
    diagnostics,
    cleanup() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("pageerror", onPageError);
    },
  };
}
