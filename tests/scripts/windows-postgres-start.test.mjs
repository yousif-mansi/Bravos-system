import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { EMBEDDED_POSTGRES_STAGE_ERROR_NAME } from "../../packages/testkit/src/embedded-postgres-stage-error.ts";
import {
  resolveWindowsPostgresExecutable,
  startOwnedWindowsPostgres,
  windowsPostgresServerArgs,
} from "../../packages/testkit/src/windows-postgres-start.ts";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 4242;
  child.killCount = 0;
  child.kill = () => {
    child.killCount += 1;
    return true;
  };
  return child;
}

function parentEnv() {
  return {
    ...process.env,
    LC_MESSAGES: "en_US.UTF-8",
    BRAVOS_PARENT_MARKER: "kept-from-parent",
  };
}

test("server arguments stay data directory, port, and sync io method", () => {
  const args = windowsPostgresServerArgs(path.join("scratch", "cluster"), 55432);
  assert.deepEqual(args, ["-D", path.resolve("scratch", "cluster"), "-p", "55432", "-c", "io_method=sync"]);
  assert.throws(() => windowsPostgresServerArgs("scratch", 0), /port/);
});

test("an early exit reports the code and signal without a raw cause", async () => {
  let child;
  const pending = startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: ["-D", "data", "-p", "55432", "-c", "io_method=sync"],
    parentEnv: parentEnv(),
    timeoutMs: 5_000,
    spawn() {
      child = fakeChild();
      return child;
    },
  });
  queueMicrotask(() => {
    child.stderr.emit("data", "FATAL: could not load library\n");
    child.exitCode = 1;
    child.emit("close", 1, null);
  });
  await assert.rejects(pending, (caught) => {
    assert.equal(caught.name, EMBEDDED_POSTGRES_STAGE_ERROR_NAME);
    assert.equal(caught.cause, undefined);
    assert.match(caught.message, /code 1 and signal null/);
    assert.match(caught.message, /could not load library/);
    return true;
  });
  assert.equal(child.killCount, 0);
});

test("a signaled exit before ready is an Error", async () => {
  let child;
  const pending = startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: ["-D", "data", "-p", "1", "-c", "io_method=sync"],
    parentEnv: parentEnv(),
    timeoutMs: 5_000,
    spawn() {
      child = fakeChild();
      return child;
    },
  });
  queueMicrotask(() => {
    child.signalCode = "SIGTERM";
    child.emit("close", null, "SIGTERM");
  });
  await assert.rejects(pending, (caught) => {
    assert.equal(caught.cause, undefined);
    assert.match(caught.message, /code null and signal SIGTERM/);
    assert.equal(child.killCount, 0);
    return true;
  });
});

test("a spawn error is bounded and redacted and does not keep the raw cause", async () => {
  let child;
  const pending = startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: ["-D", "data", "-p", "1", "-c", "io_method=sync"],
    parentEnv: parentEnv(),
    timeoutMs: 5_000,
    spawn() {
      child = fakeChild();
      return child;
    },
  });
  const secret = new Error("spawn ENOENT using password bravos-test");
  secret.code = "ENOENT";
  queueMicrotask(() => {
    child.emit("error", secret);
    child.emit("close", 1, null);
  });
  let error;
  await assert.rejects(pending, (caught) => {
    error = caught;
    return true;
  });
  assert.equal(error.name, EMBEDDED_POSTGRES_STAGE_ERROR_NAME);
  assert.equal(error.cause, undefined);
  assert.match(error.message, /ENOENT/);
  assert.match(error.message, /\[redacted\]/);
  assert.doesNotMatch(error.message, /bravos-test/);
  assert.doesNotMatch(inspect(error, { depth: null, showHidden: true, getters: true }), /bravos-test/);
  assert.equal(child.killCount, 1);
});

test("a synchronous spawn throw rejects with an Error", async () => {
  let error;
  await assert.rejects(startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: ["-D", "data", "-p", "1", "-c", "io_method=sync"],
    parentEnv: parentEnv(),
    timeoutMs: 1_000,
    spawn() {
      throw new Error("spawn failed immediately");
    },
  }), (caught) => {
    error = caught;
    return true;
  });
  assert.equal(error.cause, undefined);
  assert.match(error.message, /could not be spawned: spawn failed immediately/);
});

test("readiness split across stderr chunks resolves once", async () => {
  let child;
  let seen;
  const parent = parentEnv();
  const pending = startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: windowsPostgresServerArgs("data-dir", 55434),
    parentEnv: parent,
    timeoutMs: 5_000,
    spawn(executable, args, options) {
      seen = { executable, args, options };
      child = fakeChild();
      return child;
    },
  });
  queueMicrotask(() => {
    child.stderr.emit("data", Buffer.from("database system is ready to accept "));
    child.stderr.emit("data", "connections\n");
  });
  const owned = await pending;
  assert.equal(owned, child);
  assert.equal(owned.pid, 4242);
  assert.equal(typeof owned.kill, "function");
  child.emit("close", 0, null);
  assert.equal(seen.options.windowsHide, true);
  assert.deepEqual(seen.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(seen.options.env.LC_MESSAGES, "C");
  assert.equal(seen.options.env.BRAVOS_PARENT_MARKER, "kept-from-parent");
  assert.notEqual(seen.options.env, parent);
  assert.equal(parent.LC_MESSAGES, "en_US.UTF-8");
  assert.deepEqual(seen.args, ["-D", path.resolve("data-dir"), "-p", "55434", "-c", "io_method=sync"]);
  assert.equal(child.killCount, 0);
});

test("timeout kills only the owned child and ignores a later ready line", async () => {
  let child;
  const pending = startOwnedWindowsPostgres({
    executable: "postgres.exe",
    args: ["-D", "data", "-p", "1", "-c", "io_method=sync"],
    parentEnv: parentEnv(),
    timeoutMs: 20,
    spawn() {
      child = fakeChild();
      child.kill = () => {
        child.killCount += 1;
        throw new Error("kill failed");
      };
      return child;
    },
  });
  let error;
  await assert.rejects(pending, (caught) => {
    error = caught;
    return true;
  });
  assert.match(error.message, /was not ready within 20ms/);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.message, /kill failed/);
  assert.equal(child.killCount, 1);
  child.stderr.emit("data", "database system is ready to accept connections\n");
  child.emit("close", null, null);
});

test("a node child receives LC_MESSAGES=C and the rest of the parent environment", async () => {
  const parent = parentEnv();
  let captured = "";
  const script = `
    const payload = JSON.stringify({
      lc: process.env.LC_MESSAGES,
      marker: process.env.BRAVOS_PARENT_MARKER,
      hasPath: Boolean(process.env.PATH || process.env.Path),
      hasSystemRoot: Boolean(process.env.SystemRoot),
    });
    process.stdout.write(payload + "\\n", () => {
      process.stderr.write("database system is ready to accept connections\\n", () => {
        process.exit(0);
      });
    });
  `;
  await startOwnedWindowsPostgres({
    executable: process.execPath,
    args: ["-e", script],
    parentEnv: parent,
    timeoutMs: 5_000,
    onOutput(chunk) {
      captured += chunk;
    },
  });
  const line = captured.split(/\r?\n/).find((entry) => entry.startsWith("{"));
  const payload = JSON.parse(line);
  assert.equal(payload.lc, "C");
  assert.equal(payload.marker, "kept-from-parent");
  assert.equal(payload.hasPath, true);
  if (process.platform === "win32") {
    assert.equal(payload.hasSystemRoot, true);
  }
});

test("the installed windows package resolves postgres.exe", async (t) => {
  if (process.platform !== "win32" || process.arch !== "x64") {
    t.skip("installed @embedded-postgres/windows-x64 is the Windows x64 package");
    return;
  }
  const executable = await resolveWindowsPostgresExecutable();
  assert.equal(path.win32.basename(executable).toLowerCase(), "postgres.exe");
  assert.equal(path.isAbsolute(executable), true);
});
