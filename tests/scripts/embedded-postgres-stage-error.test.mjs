import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import {
  EMBEDDED_POSTGRES_STAGE_ERROR_NAME,
  MAX_CAPTURED_POSTGRES_LOG_CHARS,
  appendCapturedPostgresLog,
  formatCapturedPostgresLogs,
  isEmbeddedPostgresStageError,
  wrapEmbeddedPostgresStageError,
} from "../../packages/testkit/src/embedded-postgres-stage-error.ts";

test("an undefined start rejection becomes a named Error and is not treated as success", () => {
  const error = wrapEmbeddedPostgresStageError("start", undefined);
  assert.equal(error.name, EMBEDDED_POSTGRES_STAGE_ERROR_NAME);
  assert.equal(isEmbeddedPostgresStageError(error), true);
  assert.match(error.message, /^Embedded Postgres start failed\./);
  assert.match(error.message, /rejected without an error object/);
  assert.match(error.message, /No native initdb\/postgres output was captured/);
  assert.equal(error.cause, undefined);
});

test("captured native output is appended without retaining the raw cause", () => {
  const cause = new Error("listen EADDRINUSE");
  const error = wrapEmbeddedPostgresStageError(
    "start",
    cause,
    "LOG:  starting PostgreSQL\nFATAL:  could not create listen socket for port 55433\n",
  );
  assert.equal(error.cause, undefined);
  assert.match(error.message, /listen EADDRINUSE/);
  assert.match(error.message, /Captured native output:/);
  assert.match(error.message, /could not create listen socket for port 55433/);
  assert.doesNotMatch(error.message, /No native initdb\/postgres output was captured/);
});

test("an initdb string rejection is preserved in the initialise error", () => {
  const error = wrapEmbeddedPostgresStageError(
    "initialise",
    "Postgres init script exited with code 1. Please check the logs for extra info. The data directory might already exist.",
    'initdb: error: invalid locale name "en_US.UTF-8"\n',
  );
  assert.match(error.message, /^Embedded Postgres initialise failed\./);
  assert.match(error.message, /Postgres init script exited with code 1/);
  assert.match(error.message, /invalid locale name/);
  assert.equal(error.cause, undefined);
});

test("known test secrets and password-file names are redacted from the formatted error", () => {
  const error = wrapEmbeddedPostgresStageError(
    "start",
    undefined,
    "using password bravos-test from pg-password-ab12cd\n",
  );
  assert.match(error.message, /\[redacted\]/);
  assert.match(error.message, /pg-password-\[redacted\]/);
  assert.doesNotMatch(error.message, /bravos-test/);
  assert.doesNotMatch(error.message, /pg-password-ab12cd/);
});

test("a complete inspect render omits a raw cause that carries the test secret and password filename", () => {
  const nested = new Error("nested password file pg-password-ff00aa still names bravos-test");
  const cause = new Error("using password bravos-test from pg-password-ab12cd");
  cause.cause = nested;
  cause.passwordFile = "pg-password-custom1";
  const error = wrapEmbeddedPostgresStageError("start", cause, "log line with bravos-test and pg-password-ab12cd\n");
  const rendered = inspect(error, {
    depth: null,
    showHidden: true,
    customInspect: true,
    getters: true,
    maxArrayLength: null,
    maxStringLength: null,
  });
  assert.equal(error.cause, undefined);
  assert.match(rendered, /Embedded Postgres start failed/);
  assert.match(rendered, /using password \[redacted\] from pg-password-\[redacted\]/);
  assert.match(rendered, /log line with \[redacted\] and pg-password-\[redacted\]/);
  assert.doesNotMatch(rendered, /bravos-test/);
  assert.doesNotMatch(rendered, /pg-password-ab12cd/);
  assert.doesNotMatch(rendered, /pg-password-ff00aa/);
  assert.doesNotMatch(rendered, /pg-password-custom1/);
});

test("collection keeps a bounded tail and never grows past the budget", () => {
  const prefix = "A".repeat(40);
  const suffix = "FATAL: trailing diagnostic\n";
  const tail = appendCapturedPostgresLog(prefix, suffix, 20);
  assert.equal(tail.length, 20);
  assert.equal(tail, (prefix + suffix).slice(-20));
  assert.doesNotMatch(tail, /AAA/);
  assert.equal(appendCapturedPostgresLog("kept", "more", 0), "");

  let bounded = "";
  for (let index = 0; index < 900; index += 1) {
    bounded = appendCapturedPostgresLog(bounded, "0123456789");
  }
  assert.equal(bounded.length, MAX_CAPTURED_POSTGRES_LOG_CHARS);
  assert.equal(bounded, "0123456789".repeat(MAX_CAPTURED_POSTGRES_LOG_CHARS / 10));
});

test("the default log budget keeps the end of a long capture used by wrap", () => {
  const prefix = "ignored-prefix\n";
  const last = "FATAL: last line\n";
  let tail = appendCapturedPostgresLog("", prefix);
  tail = appendCapturedPostgresLog(tail, "X".repeat(MAX_CAPTURED_POSTGRES_LOG_CHARS));
  tail = appendCapturedPostgresLog(tail, last);
  assert.equal(tail.length, MAX_CAPTURED_POSTGRES_LOG_CHARS);
  const error = wrapEmbeddedPostgresStageError("start", undefined, tail);
  assert.doesNotMatch(error.message, /ignored-prefix/);
  assert.match(error.message, /FATAL: last line/);
});

test("formatting sanitizes an already-bounded tail without growing it", () => {
  const captured = appendCapturedPostgresLog("", "password bravos-test\n");
  assert.equal(formatCapturedPostgresLogs(captured), "password [redacted]");
});

test("wrapping the same stage error does not nest another wrapper", () => {
  const original = wrapEmbeddedPostgresStageError("start", undefined, "first\n");
  const again = wrapEmbeddedPostgresStageError("start", original, "second\n");
  assert.equal(again, original);
  assert.doesNotMatch(original.message, /second/);
});

test("a start wrapper is not reused for an initialise failure", () => {
  const startError = wrapEmbeddedPostgresStageError("start", undefined);
  const initialiseError = wrapEmbeddedPostgresStageError("initialise", startError);
  assert.notEqual(initialiseError, startError);
  assert.match(initialiseError.message, /^Embedded Postgres initialise failed\./);
  assert.match(initialiseError.message, /Embedded Postgres start failed\./);
  assert.equal(initialiseError.cause, undefined);
});
