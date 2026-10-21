import { execFile, type ExecFileException } from "node:child_process";
import { connect } from "node:net";

const CLOSED_CONNECT_CODES = ["ECONNREFUSED", "EADDRNOTAVAIL", "EHOSTUNREACH", "ENETUNREACH"];
const DEFAULT_BUDGET_MS = 5_000;

export type HiddenExecFile = (
  file: string,
  args: readonly string[],
  options: { encoding: "utf8"; timeout: number; windowsHide: boolean },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => void;

export type WaitForOwnedPortCloseDeps = {
  platform: NodeJS.Platform;
  connect: (host: string, port: number) => Promise<boolean>;
  nativeListening: (port: number, remainingMs: number) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  budgetMs?: number;
};

export async function waitForOwnedPortClose(port: number, deps: WaitForOwnedPortCloseDeps): Promise<void> {
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const deadline = deps.now() + budgetMs;
  do {
    const open = await Promise.all([
      listenerMayBeOpen("127.0.0.1", port, deadline, deps),
      listenerMayBeOpen("::1", port, deadline, deps),
    ]);
    if (open.every((value) => !value)) {
      return;
    }
    const remainingMs = deadline - deps.now();
    if (remainingMs <= 0) {
      break;
    }
    await deps.sleep(Math.min(100, remainingMs));
  } while (deps.now() < deadline);
  throw stillListeningError(port);
}

export async function tcpListenerMayBeOpen(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (CLOSED_CONNECT_CODES.includes(error.code ?? "")) {
        finish(false);
        return;
      }
      fail(error);
    });
    socket.once("timeout", () => finish(true));
  });
}

export async function probeWindowsListen(
  port: number,
  remainingMs: number,
  runExecFile: HiddenExecFile = execFile as HiddenExecFile,
): Promise<boolean> {
  const ownedPort = assertOwnedTcpPort(port);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error("Windows listen probe requires a positive remaining shutdown budget.");
  }
  const timeout = Math.floor(remainingMs);
  if (timeout <= 0) {
    throw new Error("Windows listen probe requires a positive remaining shutdown budget.");
  }
  const invocation = windowsListenProbeInvocation(ownedPort);
  return await new Promise<boolean>((resolve, reject) => {
    runExecFile(
      invocation.file,
      invocation.args,
      { encoding: "utf8", timeout, windowsHide: true },
      (error, stdout, stderr) => {
        try {
          resolve(interpretWindowsListenProbe(stdout ?? "", error, stderr ?? ""));
        } catch (cause) {
          reject(cause);
        }
      },
    );
  });
}

function listenerMayBeOpen(
  host: string,
  port: number,
  deadline: number,
  deps: WaitForOwnedPortCloseDeps,
): Promise<boolean> {
  return deps.connect(host, port).catch((error: unknown) => {
    if (deps.platform === "win32" && errnoCode(error) === "EACCES") {
      const remainingMs = deadline - deps.now();
      if (remainingMs <= 0) {
        throw stillListeningError(port);
      }
      return deps.nativeListening(port, remainingMs);
    }
    throw error;
  });
}

function windowsListenProbeInvocation(port: number): { file: string; args: readonly string[] } {
  const command = [
    "try { $ErrorActionPreference='Stop';",
    "$conns = Get-NetTCPConnection -ErrorAction Stop;",
    "$listen = @($conns | Where-Object { $_.State -eq 'Listen' -and ($_.LocalPort -as [int]) -eq " + port + " });",
    "if ($listen.Count -gt 0) { 'OPEN' } else { 'CLOSED' }",
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
  ].join(" ");
  return {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
  };
}

function stillListeningError(port: number): Error {
  return new Error(`Embedded Postgres stopped but its owned port ${port} is still listening.`);
}

function interpretWindowsListenProbe(stdout: string, error: ExecFileException | null, stderr: string): boolean {
  if (error) {
    const detail = stderr.trim() || error.message;
    if (error.killed) {
      throw new Error(`Windows listen probe timed out: ${detail}`, { cause: error });
    }
    throw new Error(`Windows listen probe failed: ${detail}`, { cause: error });
  }
  const output = stdout.replace(/^\uFEFF/u, "").trim();
  if (output === "OPEN") {
    return true;
  }
  if (output === "CLOSED") {
    return false;
  }
  throw new Error(`Windows listen probe returned malformed output: ${JSON.stringify(stdout)}`);
}

function assertOwnedTcpPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TCP port: ${port}`);
  }
  return port;
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}
