import type { SanitizedEvent } from "../ports.ts";

const EVENTS = new Set([
  "listen",
  "rejected",
  "paired",
  "unpaired",
  "job_accepted",
  "job_finished",
]);

/** One JSON line of fixed fields. Callers cannot attach a payload, token, or customer string. */
export function formatSanitizedLine(event: SanitizedEvent): string {
  if (!EVENTS.has(event.event)) {
    return `${JSON.stringify({ event: "rejected", error: "invalid_event" })}\n`;
  }
  return `${JSON.stringify({
    event: event.event,
    httpStatus: event.httpStatus,
    jobId: event.jobId,
    kind: event.kind,
    phase: event.phase,
    failureCode: event.failureCode,
    error: event.error,
  })}\n`;
}

export function emitSanitized(event: SanitizedEvent): void {
  process.stderr.write(formatSanitizedLine(event));
}
