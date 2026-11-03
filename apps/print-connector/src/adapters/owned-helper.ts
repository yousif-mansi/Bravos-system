import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DPAPI_HELPER_FILE = "dpapi-current-user.ps1";
const HELPER_SUFFIX = "\\apps\\print-connector\\helpers\\dpapi-current-user.ps1";

export type FixedSpawnPlan = {
  file: string;
  args: readonly string[];
  shell: false;
  windowsHide: true;
};

export type HelperRun = {
  plan: FixedSpawnPlan;
  stdin: Buffer;
};

export type HelperResult = {
  code: number;
  stdout: Buffer;
};

export type HelperRunner = (request: HelperRun) => Promise<HelperResult>;

export function defaultHelperPath(): string {
  return fileURLToPath(new URL("../../helpers/dpapi-current-user.ps1", import.meta.url));
}

export function windowsPowerShellPath(systemRoot: string): string {
  if (!/^[A-Za-z]:\\Windows$/i.test(systemRoot)) {
    throw new Error("unsupported_system_root");
  }
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export function assertOwnedHelper(helperPath: string): string {
  const normalized = helperPath.replaceAll("/", "\\");
  if (normalized.includes("..") || !normalized.toLowerCase().endsWith(HELPER_SUFFIX)) {
    throw new Error("refusing_helper_path");
  }
  return normalized;
}

/**
 * Fixed Windows PowerShell file and argument array. `shell` stays false.
 * Do not set `windowsVerbatimArguments`: Node must quote `-File` when the
 * script path contains spaces.
 */
export function planOwnedHelperSpawn(input: { systemRoot: string; helperPath: string }): FixedSpawnPlan {
  return {
    file: windowsPowerShellPath(input.systemRoot),
    args: ["-NoProfile", "-NonInteractive", "-File", assertOwnedHelper(input.helperPath)],
    shell: false,
    windowsHide: true,
  };
}

export function dpapiStdin(op: "protect" | "unprotect", payload: Buffer): Buffer {
  if (payload.length < 1 || payload.length > 4096) {
    throw new Error("dpapi_payload_bounds");
  }
  const body = JSON.stringify({ op, payloadBase64: payload.toString("base64") });
  if (Buffer.byteLength(body) > 12_000) {
    throw new Error("dpapi_payload_bounds");
  }
  return Buffer.from(body, "utf8");
}

export function runOwnedHelper(request: HelperRun): Promise<HelperResult> {
  if (request.plan.shell !== false) {
    return Promise.reject(new Error("refusing_shell"));
  }
  if (request.stdin.length < 1 || request.stdin.length > 12_000) {
    return Promise.reject(new Error("dpapi_payload_bounds"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(request.plan.file, [...request.plan.args], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error: Error | null, result?: HelperResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("helper_timeout"));
    }, 5_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 12_000) {
        child.kill();
        finish(new Error("dpapi_payload_bounds"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1_024) child.kill();
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code) => {
      finish(null, { code: code ?? 1, stdout: Buffer.concat(stdout) });
    });
    const input = child.stdin;
    if (input) {
      input.on("error", (error: Error) => {
        finish(error);
      });
      input.end(request.stdin);
    }
  });
}
