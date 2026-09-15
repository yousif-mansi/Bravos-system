import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { applyMigrations } from "@bravos/persistence";

class ManagedEmbeddedPostgres extends EmbeddedPostgres {
  private readonly databaseDir: string;
  private stopPromise: Promise<void> | null = null;

  constructor(databaseDir: string, options: ConstructorParameters<typeof EmbeddedPostgres>[0]) {
    super(options);
    this.databaseDir = databaseDir;
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
      return;
    } catch (gracefulError) {
      try {
        await super.stop();
        return;
      } catch (fallbackError) {
        throw new AggregateError(
          [gracefulError, fallbackError],
          "Postgres graceful shutdown and embedded-postgres fallback both failed.",
        );
      }
    }
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
  const pg = new ManagedEmbeddedPostgres(databaseDir, {
    databaseDir,
    user,
    password,
    port,
    // Own temporary cleanup here: Windows child processes may still be closing
    // handles when the dependency observes the parent process exit.
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (message) => {
      if (process.env.BRAVOS_PG_LOG === "1") {
        console.log(message);
      }
    },
    onError: (error) => {
      console.error(error);
    },
  });
  try {
    await pg.initialise();
  } catch (error) {
    if (!options?.persistentDir) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exist|init/i.test(message)) {
      throw error;
    }
  }
  await pg.start();
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

export async function createMigratedPool(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString });
  await applyMigrations(pool);
  return pool;
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
