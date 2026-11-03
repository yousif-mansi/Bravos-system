import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { windowsPowerShellPath } from "../adapters/owned-helper.ts";

export { windowsPowerShellPath };

const HELPER_SUFFIX = "\\apps\\print-connector\\helpers\\native-print.ps1";

export const STDIN_MAX_BYTES = 48_000;
export const PROBE_TIMEOUT_MS = 15_000;
export const PREVIEW_TIMEOUT_MS = 30_000;
export const PRINT_TIMEOUT_MS = 30_000;
export const PROBE_STDOUT_MAX = 32_000;
export const PREVIEW_STDOUT_MAX = 3_000_000;
export const PRINT_STDOUT_MAX = 8_000;

export type NativeAction = "probe" | "preview" | "print";

export type NativeSpawnPlan = {
  file: string;
  args: readonly string[];
  shell: false;
  windowsHide: true;
};

export type NativeSpawnOptions = {
  shell: false;
  windowsHide: true;
  stdio: ["pipe", "pipe", "pipe"];
};

export type NativeHelperRun = {
  plan: NativeSpawnPlan;
  stdin: Buffer;
  timeoutMs: number;
  stdoutMax: number;
  action: NativeAction;
};

export type HelperExit = {
  code: number | null;
  stdout: Buffer;
  timedOut: boolean;
  spawnError: boolean;
  overflow: boolean;
};

export function defaultNativeHelperPath(): string {
  return fileURLToPath(new URL("../../helpers/native-print.ps1", import.meta.url));
}

export function assertNativeHelper(helperPath: string): string {
  const normalized = helperPath.replaceAll("/", "\\");
  if (normalized.includes("..") || !normalized.toLowerCase().endsWith(HELPER_SUFFIX.toLowerCase())) {
    throw new Error("refusing_helper_path");
  }
  return normalized;
}

/** Fixed Windows PowerShell 5 file. No shell and no caller strings in the argument list. */
export function planNativeHelperSpawn(input: { systemRoot: string; helperPath: string }): NativeSpawnPlan {
  return {
    file: windowsPowerShellPath(input.systemRoot),
    args: ["-NoProfile", "-NonInteractive", "-File", assertNativeHelper(input.helperPath)],
    shell: false,
    windowsHide: true,
  };
}

export function nativeSpawnOptions(plan: NativeSpawnPlan): NativeSpawnOptions {
  if (plan.shell !== false || plan.windowsHide !== true || plan.args.length !== 4) {
    throw new Error("refusing_spawn");
  }
  return {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  };
}

export function runNativeHelper(request: NativeHelperRun): Promise<HelperExit> {
  if (request.plan.shell !== false || request.stdin.length < 2 || request.stdin.length > STDIN_MAX_BYTES) {
    return Promise.reject(new Error("refusing_helper_request"));
  }
  const options = nativeSpawnOptions(request.plan);
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.plan.file, [...request.plan.args], options);
    } catch {
      resolve({ code: null, stdout: Buffer.alloc(0), timedOut: false, spawnError: true, overflow: false });
      return;
    }
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let started = false;
    let timedOut = false;
    let overflow = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: HelperExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      resolve(result);
    };
    const snapshot = (): HelperExit => ({
      code: null,
      stdout: Buffer.concat(stdout),
      timedOut,
      spawnError: false,
      overflow,
    });
    const settle = () => {
      if (settleTimer) return;
      settleTimer = setTimeout(() => finish(snapshot()), 2_000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      settle();
    }, request.timeoutMs);
    child.once("spawn", () => {
      started = true;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > request.stdoutMax) {
        overflow = true;
        child.kill();
        settle();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 512) {
        child.kill();
        settle();
      }
    });
    child.on("error", () => {
      if (!started) {
        finish({ code: null, stdout: Buffer.alloc(0), timedOut: false, spawnError: true, overflow: false });
        return;
      }
      settle();
    });
    child.on("close", (code) => {
      finish({
        code,
        stdout: Buffer.concat(stdout),
        timedOut,
        spawnError: false,
        overflow,
      });
    });
    const input = child.stdin;
    if (input) {
      input.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") return;
        if (!started) {
          finish({ code: null, stdout: Buffer.alloc(0), timedOut: false, spawnError: true, overflow: false });
        }
      });
      input.end(request.stdin);
    }
  });
}
