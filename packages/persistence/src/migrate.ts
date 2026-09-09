import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

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

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<string[]> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const client = await pool.connect();
    try {
      await ensureMigrationsTable(client);
      const applied = await client.query<{ id: string }>(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [file],
      );
      if (applied.rows[0]) {
        continue;
      }
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
    } finally {
      client.release();
    }
  }
  return ran;
}

export async function revertLastMigration(
  pool: Pool,
  migrationsDir = resolveMigrationsDir(),
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    const last = applied.rows.at(-1)?.id;
    if (!last) {
      return null;
    }
    const downFile = last.replace(/\.sql$/, ".down.sql");
    const downPath = path.join(migrationsDir, downFile);
    if (!existsSync(downPath)) {
      throw new Error(`Missing down migration for ${last}`);
    }
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
  } finally {
    client.release();
  }
}

export async function listAppliedMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id",
    );
    return result.rows.map((row) => row.id);
  } finally {
    client.release();
  }
}
