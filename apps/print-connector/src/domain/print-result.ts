import type { PrintFailureCode, PrintPortResult } from "../ports.ts";

const FAILURES = new Set<PrintFailureCode>([
  "printer_missing",
  "printer_offline",
  "unsupported_driver",
  "renderer_unavailable",
  "unsupported_platform",
  "invalid_layout",
  "invalid_job",
]);

/** Only an exact submitted object counts. Anything uncertain stays unknown and is not retried. */
export function normalizePortResult(value: unknown): PrintPortResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { outcome: "unknown" };
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.outcome === "submitted" && keys.length === 1) return { outcome: "submitted" };
  if (record.outcome === "unknown" && keys.length === 1) return { outcome: "unknown" };
  if (record.outcome === "failed" && keys.length === 2 && typeof record.code === "string" && FAILURES.has(record.code as PrintFailureCode)) {
    return { outcome: "failed", code: record.code as PrintFailureCode };
  }
  return { outcome: "unknown" };
}

export type DriverProbeState = "missing" | "offline" | "unsupported" | "ready";

export function failureFromProbe(state: DriverProbeState): PrintPortResult | "ready" {
  if (state === "ready") return "ready";
  if (state === "missing") return { outcome: "failed", code: "printer_missing" };
  if (state === "offline") return { outcome: "failed", code: "printer_offline" };
  return { outcome: "failed", code: "unsupported_driver" };
}
