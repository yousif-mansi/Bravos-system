import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations, listAppliedMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { Pool } from "pg";

let cluster: PostgresCluster;

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55436 });
}, 120_000);

afterAll(async () => {
  await cluster.stop();
});

test("a failing migration run through applyMigrations rolls back table and bookkeeping", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    const applied = await applyMigrations(pool);
    expect(applied.length).toBeGreaterThan(0);
    const before = await listAppliedMigrations(pool);

    const dir = await mkdtemp(path.join(tmpdir(), "bravos-failing-migration-"));
    await writeFile(
      path.join(dir, "002_fail_probe.sql"),
      `CREATE TABLE scratch_fail_probe (id integer PRIMARY KEY);\nSELECT 1 / 0;\n`,
      "utf8",
    );

    await expect(applyMigrations(pool, dir)).rejects.toThrow(/division by zero/i);

    const leftover = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scratch_fail_probe'
       ) AS exists`,
    );
    expect(leftover.rows[0]?.exists).toBe(false);
    expect(await listAppliedMigrations(pool)).toEqual(before);
    const bookkeeping = await pool.query<{ id: string }>(
      `SELECT id FROM schema_migrations WHERE id = $1`,
      ["002_fail_probe.sql"],
    );
    expect(bookkeeping.rows).toHaveLength(0);
  } finally {
    await pool.end();
  }
});
