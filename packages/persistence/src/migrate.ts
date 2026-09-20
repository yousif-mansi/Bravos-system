import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_NAMESPACE = 1_115_128_527;
const MIGRATION_LOCK_RESOURCE = 1;

export type MigrationStatus = {
  known: string[];
  applied: string[];
  pending: string[];
  unexpected: string[];
  outOfOrder: boolean;
};

export function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),
    path.join(here, "../src/migrations"),
    path.join(process.cwd(), "packages/persistence/src/migrations"),
    path.join(process.cwd(), "apps/api/dist/migrations"),
    path.join(process.cwd(), "dist/migrations"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not locate SQL migrations directory.");
}

async function migrationFiles(migrationsDir: string): Promise<string[]> {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort();
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: PoolClient): Promise<string[]> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  if (!exists.rows[0]?.exists) return [];
  const result = await client.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
  return result.rows.map((row) => row.id);
}

function statusFor(known: string[], applied: string[]): MigrationStatus {
  const knownSet = new Set(known);
  const appliedSet = new Set(applied);
  const unexpected = applied.filter((id) => !knownSet.has(id));
  const recognized = applied.filter((id) => knownSet.has(id));
  const expectedPrefix = known.slice(0, recognized.length);
  const outOfOrder = unexpected.length > 0
    || recognized.length !== applied.length
    || recognized.some((id, index) => id !== expectedPrefix[index]);
  return {
    known,
    applied,
    pending: known.filter((id) => !appliedSet.has(id)),
    unexpected,
    outOfOrder,
  };
}

function assertNoMigrationDrift(status: MigrationStatus): void {
  if (status.unexpected.length === 0 && !status.outOfOrder) return;
  const details = [
    status.unexpected.length > 0 ? `unexpected: ${status.unexpected.join(", ")}` : null,
    status.outOfOrder ? `applied order is not a prefix of ${status.known.join(", ")}` : null,
  ].filter(Boolean).join("; ");
  throw new Error(`Migration history drift detected (${details}).`);
}

async function withMigrationLock<T>(pool: Pool, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_RESOURCE]);
    locked = true;
    return await task(client);
  } finally {
    try {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_RESOURCE]);
      }
    } catch (error) {
      client.release(error instanceof Error ? error : true);
      throw error;
    }
    client.release();
  }
}

export async function inspectMigrations(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<MigrationStatus> {
  return withMigrationLock(pool, async (client) => statusFor(
    await migrationFiles(migrationsDir),
    await appliedMigrations(client),
  ));
}

export async function applyMigrations(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    const known = await migrationFiles(migrationsDir);
    const before = statusFor(known, await appliedMigrations(client));
    assertNoMigrationDrift(before);
    await ensureMigrationsTable(client);

    const ran: string[] = [];
    for (const file of before.pending) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
        ran.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return ran;
  });
}

export async function revertLastMigration(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<string | null> {
  return withMigrationLock(pool, async (client) => {
    const status = statusFor(await migrationFiles(migrationsDir), await appliedMigrations(client));
    assertNoMigrationDrift(status);
    const last = status.applied.at(-1);
    if (!last) return null;

    const downFile = last.replace(/\.sql$/, ".down.sql");
    const downPath = path.join(migrationsDir, downFile);
    if (!existsSync(downPath)) throw new Error(`Missing down migration for ${last}`);
    const sql = await readFile(downPath, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("DELETE FROM schema_migrations WHERE id = $1", [last]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return last;
  });
}

export async function listAppliedMigrations(pool: Pool): Promise<string[]> {
  return withMigrationLock(pool, appliedMigrations);
}
