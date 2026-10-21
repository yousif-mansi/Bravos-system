import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { applyMigrations } from "@bravos/persistence";
import { appendCapturedPostgresLog, wrapEmbeddedPostgresStageError } from "./embedded-postgres-stage-error.ts";
import { probeWindowsListen, tcpListenerMayBeOpen, waitForOwnedPortClose } from "./owned-port-close.ts";
import {
  ownedPostgresChildHasExited,
  resolveWindowsPostgresExecutable,
  startOwnedWindowsPostgres,
  watchOwnedPostgresChildClose,
  windowsPostgresServerArgs,
  type OwnedPostgresProcess,
} from "./windows-postgres-start.ts";

const FAILED_START_CLOSE_BUDGET_MS = 5_000;
const OWNED_CHILD_CLOSE_BUDGET_MS = 15_000;

class ManagedEmbeddedPostgres extends EmbeddedPostgres {
  private readonly databaseDir: string;
  private readonly port: number;
  private stopPromise: Promise<void> | null = null;
  private ownedWindowsChild: OwnedPostgresProcess | null = null;

  constructor(databaseDir: string, port: number, options: ConstructorParameters<typeof EmbeddedPostgres>[0]) {
    super(options);
    this.databaseDir = databaseDir;
    this.port = port;
  }

  retainOwnedWindowsChild(child: OwnedPostgresProcess): void {
    this.ownedWindowsChild = child;
  }

  override async createDatabase(name: string): Promise<void> {
    if (process.platform !== "win32") {
      await super.createDatabase(name);
      return;
    }
    const client = this.getPgClient("postgres", "127.0.0.1");
    try {
      await client.connect();
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
    } finally {
      await client.end();
    }
  }

  override stop(): Promise<void> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce(): Promise<void> {
    if (process.platform !== "win32") {
      await super.stop();
      return;
    }
    try {
      await stopWindowsPostgres(this.databaseDir);
    } catch (gracefulError) {
      try {
        await terminateOwnedWindowsChild(this.ownedWindowsChild);
      } catch (fallbackError) {
        throw new AggregateError(
          [gracefulError, fallbackError],
          "Postgres graceful shutdown and the owned Windows child fallback both failed.",
        );
      }
    }
    await waitForPortToClose(this.port);
  }
}

export type PostgresCluster = {
  port: number;
  user: string;
  password: string;
  host: string;
  connectionString(database: string): string;
  createDatabase(name: string): Promise<void>;
  stop(): Promise<void>;
};

export async function startPostgresCluster(options?: {
  port?: number;
  persistentDir?: string;
}): Promise<PostgresCluster> {
  const port = options?.port ?? 55432;
  const databaseDir = options?.persistentDir
    ? path.resolve(options.persistentDir)
    : await mkdtemp(path.join(tmpdir(), "bravos-pg-"));
  const user = "bravos";
  const password = "bravos-test";
  let nativeLogTail: string | null = "";
  const recordNativeLog = (message: string) => {
    if (nativeLogTail !== null) {
      nativeLogTail = appendCapturedPostgresLog(nativeLogTail, message);
    }
    if (process.env.BRAVOS_PG_LOG === "1") {
      console.log(message);
    }
  };
  const pg = new ManagedEmbeddedPostgres(databaseDir, port, {
    databaseDir,
    user,
    password,
    port,
    // Own temporary cleanup here: Windows child processes may still be closing
    // handles when the dependency observes the parent process exit.
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: process.platform === "win32" ? ["-c", "io_method=sync"] : [],
    onLog: recordNativeLog,
    onError: (error) => {
      recordNativeLog(error instanceof Error ? error.message : String(error));
      console.error(error);
    },
  });
  try {
    await pg.initialise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!options?.persistentDir || !/already|exist|init/i.test(message)) {
      await abandonFailedStartup(databaseDir, options?.persistentDir);
      throw wrapEmbeddedPostgresStageError("initialise", error, nativeLogTail ?? "");
    }
  }
  let ownedChild: OwnedPostgresProcess | undefined;
  try {
    if (process.platform === "win32") {
      ownedChild = await startOwnedWindowsPostgres({
        executable: await resolveWindowsPostgresExecutable(),
        args: windowsPostgresServerArgs(databaseDir, port),
        parentEnv: process.env,
        onOutput: recordNativeLog,
        onSpawned(child) {
          ownedChild = child;
          pg.retainOwnedWindowsChild(child);
        },
      });
      pg.retainOwnedWindowsChild(ownedChild);
    } else {
      await pg.start();
    }
  } catch (error) {
    await abandonFailedStartup(databaseDir, options?.persistentDir, ownedChild);
    throw wrapEmbeddedPostgresStageError("start", error, nativeLogTail ?? "");
  }
  nativeLogTail = null;
  return {
    port,
    user,
    password,
    host: "127.0.0.1",
    connectionString(database: string) {
      return `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
    },
    async createDatabase(name: string) {
      await pg.createDatabase(name);
    },
    async stop() {
      await pg.stop();
      if (!options?.persistentDir) {
        await removeOwnedScratch(databaseDir);
      }
    },
  };
}

async function stopWindowsPostgres(databaseDir: string): Promise<void> {
  if (process.arch !== "x64") {
    throw new Error(`Unsupported embedded Postgres Windows architecture: ${process.arch}`);
  }
  const require = createRequire(import.meta.url);
  const embeddedEntry = require.resolve("embedded-postgres");
  const embeddedRequire = createRequire(embeddedEntry);
  const binariesEntry = embeddedRequire.resolve("@embedded-postgres/windows-x64");
  const binaries = await import(pathToFileURL(binariesEntry).href) as { pg_ctl?: unknown };
  if (typeof binaries.pg_ctl !== "string" || path.basename(binaries.pg_ctl).toLowerCase() !== "pg_ctl.exe") {
    throw new Error("The installed Windows Postgres package did not expose pg_ctl.exe.");
  }
  const pgCtl = path.resolve(binaries.pg_ctl);
  const resolvedDatabaseDir = path.resolve(databaseDir);
  await new Promise<void>((resolve, reject) => {
    execFile(
      pgCtl,
      ["stop", "-D", resolvedDatabaseDir, "-m", "fast", "-w", "-t", "30"],
      { encoding: "utf8", timeout: 35_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = stderr.trim() || stdout.trim() || error.message;
        reject(new Error(`pg_ctl could not stop the embedded Postgres cluster: ${detail}`, { cause: error }));
      },
    );
  });
}

async function waitForPortToClose(port: number): Promise<void> {
  await waitForOwnedPortClose(port, {
    platform: process.platform,
    connect: tcpListenerMayBeOpen,
    nativeListening: probeWindowsListen,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

export async function createMigratedPool(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString });
  await applyMigrations(pool);
  return pool;
}

async function abandonFailedStartup(
  databaseDir: string,
  persistentDir: string | undefined,
  owned?: OwnedPostgresProcess,
): Promise<void> {
  if (persistentDir) {
    return;
  }
  // A failed spawn may still be alive after kill(); deleting the data directory
  // before close can hit a live postgres.exe. Leave the scratch if close is unconfirmed.
  if (owned && !ownedPostgresChildHasExited(owned)) {
    const watch = watchOwnedPostgresChildClose(owned, FAILED_START_CLOSE_BUDGET_MS);
    const closed = await watch.closed;
    if (!closed) {
      return;
    }
  }
  try {
    await removeOwnedScratch(databaseDir);
  } catch {
    // Preserve the original initialise/start error; leftover scratch is secondary.
  }
}

async function terminateOwnedWindowsChild(owned: OwnedPostgresProcess | null): Promise<void> {
  if (!owned) {
    throw new Error("No owned Windows Postgres child is available to stop.");
  }
  if (ownedPostgresChildHasExited(owned)) {
    return;
  }
  const watch = watchOwnedPostgresChildClose(owned, OWNED_CHILD_CLOSE_BUDGET_MS);
  try {
    if (ownedPostgresChildHasExited(owned)) {
      return;
    }
    let killed: boolean;
    try {
      killed = owned.kill();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Owned Windows Postgres child could not be stopped: ${detail}`, { cause: error });
    }
    if (killed === false) {
      throw new Error("Owned Windows Postgres child could not be stopped: kill returned false.");
    }
    const closed = await watch.closed;
    if (!closed) {
      throw new Error("Owned Windows Postgres child did not close after it was stopped.");
    }
  } finally {
    watch.stop();
  }
}

async function removeOwnedScratch(databaseDir: string): Promise<void> {
  const resolved = path.resolve(databaseDir);
  const tmpRoot = path.resolve(tmpdir());
  const relative = path.relative(tmpRoot, resolved);
  const owned =
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    path.dirname(relative) === "." &&
    path.basename(relative).startsWith("bravos-pg-");
  if (!owned) {
    throw new Error(`Refusing to delete unmanaged postgres directory: ${resolved}`);
  }
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
