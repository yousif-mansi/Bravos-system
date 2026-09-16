import type { PublicAnalyticsEventRequest } from "@bravos/contracts/public";

export async function recordPublicAnalyticsEvent(event: PublicAnalyticsEventRequest): Promise<void> {
  try {
    await fetch("/api/public/analytics/events", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      cache: "no-store",
      keepalive: true,
    });
  } catch {
    // Analytics must never delay or interrupt browsing and cart work.
  }
}
