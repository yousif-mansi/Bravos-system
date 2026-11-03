import type { PrintJob } from "../contracts.ts";
import type { JobMeta, PrintPortResult } from "../ports.ts";

export function queuedMeta(job: PrintJob, nowIso: string): JobMeta {
  return {
    id: job.id,
    kind: job.kind,
    phase: "queued",
    failureCode: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function beginSubmit(meta: JobMeta, nowIso: string): JobMeta {
  if (meta.phase !== "queued") return meta;
  return { ...meta, phase: "submitting", updatedAt: nowIso };
}

export function finishJob(meta: JobMeta, result: PrintPortResult, nowIso: string): JobMeta {
  if (meta.phase !== "submitting") return meta;
  if (result.outcome === "submitted") {
    return { ...meta, phase: "submitted", failureCode: null, updatedAt: nowIso };
  }
  if (result.outcome === "unknown") {
    return { ...meta, phase: "unknown", failureCode: "submission_uncertain", updatedAt: nowIso };
  }
  return { ...meta, phase: "failed", failureCode: result.code, updatedAt: nowIso };
}

export function isOutstanding(meta: JobMeta): boolean {
  return meta.phase === "queued" || meta.phase === "submitting";
}
