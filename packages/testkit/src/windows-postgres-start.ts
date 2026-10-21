import { spawn as nodeSpawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendCapturedPostgresLog, wrapEmbeddedPostgresStageError } from "./embedded-postgres-stage-error.ts";

export const WINDOWS_POSTGRES_READY_MARKER = "database system is ready to accept connections";
export const DEFAULT_WINDOWS_POSTGRES_START_TIMEOUT_MS = 30_000;
const MAX_START_TIMEOUT_MS = 120_000;
const MAX_FAILURE_DETAIL_CHARS = 500;

export type OwnedPostgresProcess = {
  pid?: number | undefined;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  stdout?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  removeListener(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(): boolean;
};

export type OwnedPostgresSpawn = (
  executable: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    windowsHide: true;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => OwnedPostgresProcess;

export function windowsPostgresEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...parent, LC_MESSAGES: "C" };
}

export function windowsPostgresServerArgs(databaseDir: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Windows Postgres port must be an integer from 1 to 65535: ${port}`);
  }
  const dataDirectory = path.resolve(databaseDir);
  return ["-D", dataDirectory, "-p", String(port), "-c", "io_method=sync"];
}

export async function resolveWindowsPostgresExecutable(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Windows Postgres binaries are only resolved on win32.");
  }
  if (process.arch !== "x64") {
    throw new Error(`Unsupported embedded Postgres Windows architecture: ${process.arch}`);
  }
  const require = createRequire(import.meta.url);
  const embeddedEntry = require.resolve("embedded-postgres");
  const embeddedRequire = createRequire(embeddedEntry);
  const binariesEntry = embeddedRequire.resolve("@embedded-postgres/windows-x64");
  const binaries = await import(pathToFileURL(binariesEntry).href) as { postgres?: unknown };
  if (typeof binaries.postgres !== "string" || path.basename(binaries.postgres).toLowerCase() !== "postgres.exe") {
    throw new Error("The installed Windows Postgres package did not expose postgres.exe.");
  }
  return path.resolve(binaries.postgres);
}

export function ownedPostgresChildHasExited(child: OwnedPostgresProcess): boolean {
  return child.exitCode != null || child.signalCode != null;
}

export function watchOwnedPostgresChildClose(
  child: OwnedPostgresProcess,
  timeoutMs: number,
): { closed: Promise<boolean>; stop: () => void } {
  if (ownedPostgresChildHasExited(child)) {
    return { closed: Promise.resolve(true), stop() {} };
  }
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveClosed: (closed: boolean) => void = () => {};
  const onClose = () => {
    finish(true);
  };
  const finish = (closed: boolean) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    child.removeListener("close", onClose);
    resolveClosed(closed);
  };
  const closed = new Promise<boolean>((resolve) => {
    resolveClosed = resolve;
  });
  timer = setTimeout(() => {
    finish(ownedPostgresChildHasExited(child));
  }, timeoutMs);
  child.on("close", onClose);
  if (ownedPostgresChildHasExited(child)) {
    finish(true);
  }
  return {
    closed,
    stop() {
      finish(ownedPostgresChildHasExited(child));
    },
  };
}

export function startOwnedWindowsPostgres(options: {
  executable: string;
  args: readonly string[];
  parentEnv: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  onSpawned?: (child: OwnedPostgresProcess) => void;
  spawn?: OwnedPostgresSpawn;
}): Promise<OwnedPostgresProcess> {
  let timeoutMs = DEFAULT_WINDOWS_POSTGRES_START_TIMEOUT_MS;
  try {
    if (options.timeoutMs !== undefined) {
      timeoutMs = options.timeoutMs;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_START_TIMEOUT_MS) {
      throw new Error(`Windows Postgres startup timeout must be an integer from 1 to ${MAX_START_TIMEOUT_MS} ms.`);
    }
    if (typeof options.executable !== "string" || options.executable.trim() === "") {
      throw new Error("Windows Postgres executable path is empty.");
    }
    if (!Array.isArray(options.args) || options.args.some((arg) => typeof arg !== "string")) {
      throw new Error("Windows Postgres arguments must be an array of strings.");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Promise.reject(stageFailure(boundedDetail(detail), ""));
  }

  const spawnProcess = options.spawn ?? defaultSpawn;
  return new Promise<OwnedPostgresProcess>((resolve, reject) => {
    let settled = false;
    let captured = "";
    let child: OwnedPostgresProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fail = (detail: string) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      const owned = child;
      const error = stageFailure(detail, captured);
      killOwned(owned);
      reject(error);
    };

    try {
      child = spawnProcess(options.executable, options.args, {
        env: windowsPostgresEnvironment(options.parentEnv),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      fail(`postgres.exe could not be spawned: ${boundedDetail(detail)}`);
      return;
    }
    if (!child || typeof child.on !== "function") {
      fail("postgres.exe could not be spawned: spawn returned no process.");
      return;
    }

    const owned = child;
    timer = setTimeout(() => {
      fail(`postgres.exe was not ready within ${timeoutMs}ms.`);
    }, timeoutMs);

    const acceptChunk = (chunk: Buffer | string, pending: { text: string }) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (!settled) {
        captured = appendCapturedPostgresLog(captured, text);
      }
      options.onOutput?.(text);
      if (settled) {
        return;
      }
      pending.text += text;
      if (pending.text.includes(WINDOWS_POSTGRES_READY_MARKER)) {
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        resolve(owned);
        return;
      }
      const keep = WINDOWS_POSTGRES_READY_MARKER.length - 1;
      if (pending.text.length > keep) {
        pending.text = pending.text.slice(-keep);
      }
    };

    attachOutput(owned.stderr, (chunk) => acceptChunk(chunk, stderrPending));
    attachOutput(owned.stdout, (chunk) => acceptChunk(chunk, stdoutPending));
    const stderrPending = { text: "" };
    const stdoutPending = { text: "" };

    owned.on("error", (error: unknown) => {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? `${error.code}: `
        : "";
      const message = error instanceof Error ? error.message : String(error);
      fail(`postgres.exe could not be spawned: ${boundedDetail(`${code}${message}`)}`);
    });
    owned.on("close", (code, signal) => {
      const codeText = code === null || code === undefined ? "null" : String(code);
      const signalText = signal === null || signal === undefined ? "null" : String(signal);
      fail(`postgres.exe closed before it was ready with code ${codeText} and signal ${signalText}.`);
    });
    options.onSpawned?.(owned);
  });
}

function defaultSpawn(
  executable: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; windowsHide: true; stdio: ["ignore", "pipe", "pipe"] },
): OwnedPostgresProcess {
  return nodeSpawn(executable, args, options);
}

function attachOutput(
  stream: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null | undefined,
  onChunk: (chunk: Buffer | string) => void,
): void {
  stream?.on("data", onChunk);
}

function stageFailure(detail: string, captured: string): Error {
  return wrapEmbeddedPostgresStageError("start", detail, captured);
}

function boundedDetail(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_FAILURE_DETAIL_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_FAILURE_DETAIL_CHARS);
}

function killOwned(owned: OwnedPostgresProcess | undefined): void {
  if (!owned || owned.exitCode != null || owned.signalCode != null) {
    return;
  }
  try {
    owned.kill();
  } catch {
    // The startup Error is the rejection. A kill failure must not replace it.
  }
}
