import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { applyMigrations } from "@bravos/persistence";

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
  const pg = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: Boolean(options?.persistentDir),
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

export async function createMigratedPool(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString });
  await applyMigrations(pool);
  return pool;
}

async function removeOwnedScratch(databaseDir: string): Promise<void> {
  const resolved = path.resolve(databaseDir);
  const tmpRoot = path.resolve(tmpdir());
  const owned =
    resolved.startsWith(tmpRoot) &&
    (resolved.includes(`${path.sep}bravos-pg-`) || resolved.includes("/bravos-pg-"));
  if (!owned) {
    throw new Error(`Refusing to delete unmanaged postgres directory: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
