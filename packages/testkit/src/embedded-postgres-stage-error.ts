export type EmbeddedPostgresStage = "initialise" | "start";

export const EMBEDDED_POSTGRES_STAGE_ERROR_NAME = "EmbeddedPostgresStageError";
export const MAX_CAPTURED_POSTGRES_LOG_CHARS = 8_000;

const EMPTY_CAUSE_DETAIL =
  "The native process closed before it became ready, and embedded-postgres rejected without an error object.";

export function appendCapturedPostgresLog(
  current: string,
  chunk: string,
  maxChars = MAX_CAPTURED_POSTGRES_LOG_CHARS,
): string {
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new Error(`Captured Postgres log budget must be a non-negative integer: ${maxChars}`);
  }
  if (maxChars === 0) {
    return "";
  }
  const next = current + chunk;
  if (next.length <= maxChars) {
    return next;
  }
  return next.slice(next.length - maxChars);
}

export function formatCapturedPostgresLogs(capturedLog: string): string {
  return sanitizePostgresLog(capturedLog).trim();
}

export function wrapEmbeddedPostgresStageError(
  stage: EmbeddedPostgresStage,
  cause: unknown,
  capturedLog = "",
): Error {
  if (stage !== "initialise" && stage !== "start") {
    throw new Error(`Unsupported embedded Postgres stage: ${String(stage)}`);
  }
  if (isEmbeddedPostgresStageError(cause) && stageErrorMatches(cause, stage)) {
    return cause;
  }
  const captured = formatCapturedPostgresLogs(capturedLog);
  const lines = [`Embedded Postgres ${stage} failed.`, describeStageCause(cause)];
  if (captured) {
    lines.push("Captured native output:", captured);
  } else {
    lines.push("No native initdb/postgres output was captured.");
  }
  const error = new Error(lines.join("\n"));
  error.name = EMBEDDED_POSTGRES_STAGE_ERROR_NAME;
  // Do not attach the raw cause. Node prints error.cause on uncaught
  // exceptions and util.inspect, including its stack, custom fields, and
  // nested causes, which bypasses the sanitized message above.
  return error;
}

export function isEmbeddedPostgresStageError(error: unknown): error is Error {
  return error instanceof Error && error.name === EMBEDDED_POSTGRES_STAGE_ERROR_NAME;
}

function stageErrorMatches(error: Error, stage: EmbeddedPostgresStage): boolean {
  return error.message.startsWith(`Embedded Postgres ${stage} failed.`);
}

function describeStageCause(cause: unknown): string {
  if (cause === undefined || cause === null) {
    return EMPTY_CAUSE_DETAIL;
  }
  if (typeof cause === "string") {
    const detail = sanitizePostgresLog(cause).trim();
    return detail || EMPTY_CAUSE_DETAIL;
  }
  if (cause instanceof Error) {
    const detail = sanitizePostgresLog(cause.message).trim();
    return detail || EMPTY_CAUSE_DETAIL;
  }
  return sanitizePostgresLog(String(cause)).trim() || EMPTY_CAUSE_DETAIL;
}

function sanitizePostgresLog(text: string): string {
  return text
    .replace(/bravos-test/g, "[redacted]")
    .replace(/pg-password-[a-z0-9]+/gi, "pg-password-[redacted]");
}
