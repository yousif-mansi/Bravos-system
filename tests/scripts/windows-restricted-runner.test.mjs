import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const launcherPath = path.join(repoRoot, "scripts", "run-windows-restricted.ps1");
const fixtureDir = path.join(repoRoot, "tests", "scripts", "fixtures");
const payloadPath = path.join(fixtureDir, "windows-restricted-payload.mjs");
const identityProbe = path.join(fixtureDir, "windows-restricted-identity.ps1");
const ownerProbe = path.join(fixtureDir, "windows-restricted-owner.ps1");
const versionProbe = path.join(fixtureDir, "windows-restricted-version.ps1");
const tempPrefix = "windows-restricted-";
const administratorsSid = "S-1-5-32-544";

const ownedChildren = new Set();
const ownedPids = new Set();
const ownedTemps = new Set();
let pwshPath = "";
let parentIdentity = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      windowsHide: true,
      shell: false,
      timeout: options.timeoutMs ?? 15_000,
      cwd: options.cwd,
      env: options.env,
    }, (error, stdout, stderr) => {
      if (error && error.code === "ETIMEDOUT") {
        reject(error);
        return;
      }
      resolve({
        code: error ? error.code ?? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error,
      });
    });
  });
}

function trackChild(child) {
  ownedChildren.add(child);
  child.once("exit", () => ownedChildren.delete(child));
  return child;
}

function trackPid(pid) {
  if (Number.isInteger(pid) && pid > 0) ownedPids.add(pid);
  return pid;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function locatePwsh() {
  const pathEnv = process.env.Path || process.env.PATH || "";
  for (const entry of pathEnv.split(";")) {
    if (!entry) continue;
    const candidate = path.join(entry, "pwsh.exe");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  throw new Error("pwsh.exe was not found on PATH");
}

async function readCurrentIdentity() {
  const result = await runFile(pwshPath, ["-NoProfile", "-NonInteractive", "-File", identityProbe]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function makeTemp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  ownedTemps.add(dir);
  return dir;
}

async function ownerSid(dir) {
  const result = await runFile(pwshPath, [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    ownerProbe,
    "-LiteralPath",
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

async function removeOwnedTemp(dir) {
  if (!dir) return;
  const root = await fs.realpath(os.tmpdir());
  let resolved = dir;
  try {
    resolved = await fs.realpath(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      ownedTemps.delete(dir);
      return;
    }
    throw error;
  }
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  assert.ok(resolved.startsWith(prefix), `refusing to delete outside temp: ${resolved}`);
  assert.equal(path.basename(resolved).startsWith(tempPrefix), true);
  const owner = await ownerSid(resolved);
  const allowed = new Set([parentIdentity.sid, administratorsSid]);
  assert.ok(allowed.has(owner), `temp owner ${owner} is outside this test`);
  await fs.rm(resolved, { recursive: true, force: true });
  ownedTemps.delete(dir);
}

async function reapOwned() {
  for (const child of ownedChildren) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  for (const pid of ownedPids) {
    if (processAlive(pid)) {
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const childRunning = [...ownedChildren].some((child) => child.exitCode === null && child.signalCode === null);
    const pidRunning = [...ownedPids].some((pid) => processAlive(pid));
    if (!childRunning && !pidRunning) break;
    await delay(50);
  }
  ownedPids.clear();
}

function spawnLauncher(args, options) {
  const child = spawn(pwshPath, [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    launcherPath,
    ...args,
  ], {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return trackChild(child);
}

function collect(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The timeout path still reports below.
      }
      reject(new Error(`launcher timed out after ${timeoutMs}ms\n${stderr}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = (await fs.readFile(file, "utf8")).trim();
      if (text) return text;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting until ${label}`);
}

test.describe("windows restricted runner", {
  concurrency: false,
  skip: process.platform === "win32" ? false : "Windows-only native runner behavior",
}, () => {
  test.before(async () => {
    pwshPath = await locatePwsh();
    const version = await runFile(pwshPath, ["-NoProfile", "-NonInteractive", "-File", versionProbe]);
    assert.equal(version.code, 0, version.stderr);
    assert.equal(Number(version.stdout.trim()), 7);
    parentIdentity = await readCurrentIdentity();
    assert.match(parentIdentity.sid, /^S-1-5-/);
  });

  test.afterEach(async () => {
    await reapOwned();
    for (const dir of [...ownedTemps]) {
      await removeOwnedTemp(dir);
    }
  });

  test("preserves argv, working directory, and the test environment", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const workDir = path.join(dir, "work dir");
    const launcherDir = path.join(dir, "launcher-cwd");
    await fs.mkdir(workDir);
    await fs.mkdir(launcherDir);
    const args = ["two words", "", "say \"hi\"", "C:\\data\\", "قاعة-π"];
    const child = spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", JSON.stringify([payloadPath, "report", ...args]),
      "-WorkingDirectory", workDir,
    ], {
      cwd: launcherDir,
      env: { ...process.env, BRAVOS_RESTRICTED_PROBE: "probe-value" },
    });
    const result = await collect(child, 20_000);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      argv: args,
      cwd: await fs.realpath(workDir),
      probe: "probe-value",
    });
  });

  test("forwards both streams and the native exit code", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const child = spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", JSON.stringify([payloadPath, "exit23"]),
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: process.env,
    });
    const result = await collect(child, 20_000);
    assert.equal(result.code, 23);
    assert.equal(result.stdout, "restricted-stdout-marker\n");
    assert.equal(result.stderr, "restricted-stderr-marker\n");
  });

  test("propagates a completed child exit code of 259", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const child = spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", JSON.stringify([payloadPath, "exit259"]),
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: process.env,
    });
    const result = await collect(child, 20_000);
    assert.equal(result.code, 259);
  });

  test("rejects embedded NUL, null, and numeric JSON arguments before the payload starts", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const cases = [
      {
        name: "nul",
        argumentsJson: JSON.stringify([payloadPath, "report", "before\u0000after"]),
      },
      {
        name: "null",
        argumentsJson: JSON.stringify([payloadPath, "report", null]),
      },
      {
        name: "number",
        argumentsJson: JSON.stringify([payloadPath, "report", 1]),
      },
    ];
    assert.match(cases[0].argumentsJson, /\\u0000/);
    for (const entry of cases) {
      const beat = path.join(dir, `${entry.name}-started`);
      const run = await collect(spawnLauncher([
        "-FilePath", process.execPath,
        "-ArgumentsJson", entry.argumentsJson,
        "-WorkingDirectory", dir,
      ], {
        cwd: dir,
        env: { ...process.env, BRAVOS_PAYLOAD_HEARTBEAT: beat },
      }), 20_000);
      assert.notEqual(run.code, 0, entry.name);
      await assert.rejects(fs.stat(beat), { code: "ENOENT" });
    }
  });

  test("a missing executable or malformed arguments fail before the payload starts", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const missing = path.join(dir, "missing.exe");
    const missingBeat = path.join(dir, "missing-started");
    const missingRun = await collect(spawnLauncher([
      "-FilePath", missing,
      "-ArgumentsJson", JSON.stringify([payloadPath, "report"]),
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: { ...process.env, BRAVOS_PAYLOAD_HEARTBEAT: missingBeat },
    }), 20_000);
    assert.notEqual(missingRun.code, 0);
    await assert.rejects(fs.stat(missingBeat), { code: "ENOENT" });

    const badBeat = path.join(dir, "bad-json-started");
    const badRun = await collect(spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", "{\"not\":",
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: { ...process.env, BRAVOS_PAYLOAD_HEARTBEAT: badBeat },
    }), 20_000);
    assert.notEqual(badRun.code, 0);
    await assert.rejects(fs.stat(badBeat), { code: "ENOENT" });
  });

  test("keeps the user SID and denies Administrators and Power Users", { timeout: 25_000 }, async () => {
    const dir = await makeTemp();
    const child = spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", JSON.stringify([payloadPath, "identity", pwshPath, identityProbe]),
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: process.env,
    });
    const result = await collect(child, 20_000);
    assert.equal(result.code, 0, result.stderr);
    const identity = JSON.parse(result.stdout);
    assert.equal(identity.sid, parentIdentity.sid);
    assert.equal(identity.admin, false);
    assert.equal(identity.powerUsers, false);
  });

  test("job close stops the launcher subtree and leaves an unrelated process", { timeout: 40_000 }, async () => {
    const dir = await makeTemp();
    const childPidFile = path.join(dir, "child.pid");
    const grandchildPidFile = path.join(dir, "grandchild.pid");
    const sentinelPidFile = path.join(dir, "sentinel.pid");
    const sentinel = trackChild(spawn(process.execPath, [payloadPath, "hold", sentinelPidFile], {
      cwd: dir,
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    }));
    const launcher = spawnLauncher([
      "-FilePath", process.execPath,
      "-ArgumentsJson", JSON.stringify([payloadPath, "tree", childPidFile, grandchildPidFile]),
      "-WorkingDirectory", dir,
    ], {
      cwd: dir,
      env: process.env,
    });
    const sentinelPid = trackPid(Number(await waitForFile(sentinelPidFile, 15_000)));
    const childPid = trackPid(Number(await waitForFile(childPidFile, 15_000)));
    const grandchildPid = trackPid(Number(await waitForFile(grandchildPidFile, 15_000)));
    assert.equal(processAlive(sentinelPid), true);
    assert.equal(processAlive(childPid), true);
    assert.equal(processAlive(grandchildPid), true);
    assert.ok(new Set([launcher.pid, childPid, grandchildPid, sentinelPid]).size === 4);

    launcher.kill();
    await waitUntil(
      () => !processAlive(childPid) && !processAlive(grandchildPid) && !processAlive(launcher.pid),
      15_000,
      "descendant processes exit after the launcher is killed",
    );
    assert.equal(processAlive(sentinelPid), true);
    assert.equal(processAlive(childPid), false);
    assert.equal(processAlive(grandchildPid), false);

    sentinel.kill();
    await waitUntil(() => !processAlive(sentinelPid), 10_000, "sentinel exits");
  });
});
