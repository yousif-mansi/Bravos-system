import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  operatorDirectoriesOverlap,
  prepareExternalOperatorDirectory,
  prepareOperatorRecoveryDirectory,
  resolveExternalOperatorDirectory,
} from "@bravos/identity/node";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acknowledgement = process.env.BRAVOS_REHEARSAL_LOOPBACK_HTTP_ACK;
if (acknowledgement !== "true") {
  throw new Error("Set BRAVOS_REHEARSAL_LOOPBACK_HTTP_ACK=true to acknowledge this loopback HTTP rehearsal has no TLS evidence.");
}
required("DATABASE_URL");
required("BETTER_AUTH_SECRET");
if (process.env.BRAVOS_OWNER_RECOVERY_ADAPTER !== "operator-file") {
  throw new Error("BRAVOS_OWNER_RECOVERY_ADAPTER must be operator-file for release rehearsal.");
}
if (process.env.BRAVOS_PUBLIC_ORDERING_ENABLED !== "true" && process.env.BRAVOS_PUBLIC_ORDERING_ENABLED !== "false") {
  throw new Error("BRAVOS_PUBLIC_ORDERING_ENABLED must be explicitly true or false for release rehearsal.");
}

const artifacts = {
  api: path.join(root, "apps/api/dist/main.js"),
  migrations: path.join(root, "apps/api/dist/migrations/001_identity.sql"),
  internal: path.join(root, "apps/internal/dist/index.html"),
  storefront: path.join(root, "apps/storefront/.next/BUILD_ID"),
  vite: path.join(root, "apps/internal/node_modules/vite/bin/vite.js"),
  next: path.join(root, "apps/storefront/node_modules/next/dist/bin/next"),
};
for (const [name, artifact] of Object.entries(artifacts)) {
  if (!existsSync(artifact)) throw new Error(`Missing ${name} artifact at ${artifact}. Run pnpm build first.`);
}

const recoveryInput = required("BRAVOS_OWNER_RECOVERY_OUTBOX_DIR");
const mediaInput = required("BRAVOS_PRODUCT_MEDIA_DIR");
const [recoveryCandidate, mediaCandidate] = await Promise.all([
  resolveExternalOperatorDirectory(recoveryInput, "Recovery directory", root),
  resolveExternalOperatorDirectory(mediaInput, "Product media directory", root),
]);
if (operatorDirectoriesOverlap(recoveryCandidate, mediaCandidate)) {
  throw new Error("Recovery and product media must use separate, non-overlapping external directories.");
}
const [recoveryDirectory, mediaDirectory] = await Promise.all([
  prepareOperatorRecoveryDirectory(recoveryInput),
  prepareExternalOperatorDirectory(mediaInput, "Product media directory", root),
]);

const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  BRAVOS_LOOPBACK_REHEARSAL: "true",
  BRAVOS_LOAD_LOCAL_ENV: "false",
  BRAVOS_SECURE_COOKIES: "false",
  BRAVOS_TRUSTED_ORIGINS: "",
  BRAVOS_API_ORIGIN: "http://127.0.0.1:3010",
  BETTER_AUTH_URL: "http://127.0.0.1:3010",
  BRAVOS_INTERNAL_ORIGIN: "http://127.0.0.1:5173",
  BRAVOS_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  BRAVOS_OWNER_RECOVERY_OUTBOX_DIR: recoveryDirectory,
  BRAVOS_PRODUCT_MEDIA_DIR: mediaDirectory,
};

let stopping = false;
let shutdownPromise: Promise<void> | undefined;
const children: ChildProcess[] = [];
let apiChild: ChildProcess | undefined;
let failChild: (error: Error) => void = () => undefined;
const childFailure = new Promise<never>((_resolve, reject) => { failChild = reject; });
const launch = (label: string, executable: string, args: string[], cwd: string, ipc = false) => {
  const child = spawn(executable, args, {
    cwd,
    env: childEnvironment,
    stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.once("error", (error) => {
    if (!stopping) failChild(error);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) failChild(new Error(`${label} exited before shutdown (${signal ?? code ?? "unknown"}).`));
  });
  return child;
};
apiChild = launch("API", process.execPath, [artifacts.api], root, true);
launch("staff app", process.execPath, [artifacts.vite, "preview", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], path.join(root, "apps/internal"));
launch("storefront", process.execPath, [artifacts.next, "start", "--hostname", "127.0.0.1", "--port", "3000"], path.join(root, "apps/storefront"));

const stopRequested = new Promise<"stopped">((resolve, reject) => {
  const stop = () => void stopAll().then(() => resolve("stopped"), reject);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});

try {
  const outcome = await Promise.race([
    Promise.all([
      waitFor("http://127.0.0.1:3010/api/public/health"),
      waitFor("http://127.0.0.1:5173/"),
      waitFor("http://127.0.0.1:3000/"),
    ]).then(() => "ready" as const),
    stopRequested,
    childFailure,
  ]);
  if (outcome === "ready") {
    console.log("BRAVOS built-artifact rehearsal is ready on loopback ports 3010, 5173 and 3000.");
    console.log("This records local process/artifact behavior only; it does not provide HTTPS, proxy or hosting evidence.");
    await Promise.race([stopRequested, childFailure]);
  }
} catch (error) {
  await stopAll();
  throw error;
}

async function stopAll(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = Promise.all(children.map((child) => stopChild(child))).then(() => undefined);
  return shutdownPromise;
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let forceError: unknown;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(deadlineTimer);
      child.off("exit", onStopped);
      child.off("close", onStopped);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onStopped = () => finish();
    const onError = (error: Error) => finish(error);
    child.once("exit", onStopped);
    child.once("close", onStopped);
    child.once("error", onError);
    const forceTimer = setTimeout(() => {
      void forceStopTree(child).catch((error: unknown) => { forceError = error; });
    }, 5_000);
    const deadlineTimer = setTimeout(() => {
      const detail = forceError instanceof Error ? ` ${forceError.message}` : "";
      finish(new Error(`Timed out stopping child process ${child.pid}.${detail}`));
    }, 10_000);

    if (child === apiChild && child.connected) {
      try {
        child.send("bravos-supervisor-shutdown", (error) => {
          if (error && !settled) void forceStopTree(child).catch((failure: unknown) => { forceError = failure; });
        });
      } catch (error) {
        forceError = error;
        void forceStopTree(child).catch((failure: unknown) => { forceError = failure; });
      }
    } else if (process.platform === "win32") {
      void stopWindowsTree(child, false).catch(() => undefined);
    } else {
      child.kill("SIGTERM");
    }
  });
}

async function forceStopTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    await stopWindowsTree(child, true);
    return;
  }
  child.kill("SIGKILL");
}

async function stopWindowsTree(child: ChildProcess, force: boolean): Promise<void> {
  if (!child.pid) return;
  await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], {
    timeout: 3_000,
    windowsHide: true,
  });
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (stopping) return;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The supervised process is still starting.
    }
    if (stopping) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
