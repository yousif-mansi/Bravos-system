import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Pool } from "pg";
import { applyMigrations, resolveMigrationsDir } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

let cluster: PostgresCluster;

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55490 });
}, 120_000);

afterAll(async () => {
  if (cluster) await cluster.stop();
});

test("branch migration refuses existing unlocated inventory activity", async () => {
  const database = `bravos_branch_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  const pool = new Pool({ connectionString: cluster.connectionString(database) });
  const oldMigrations = await mkdtemp(path.join(tmpdir(), "bravos-legacy-migrations-"));
  const source = resolveMigrationsDir();
  try {
    const prior = (await readdir(source)).filter((name) => /^0\d\d_.*\.sql$/.test(name)
      && !name.endsWith(".down.sql") && name < "030_branch_inventory.sql");
    for (const file of prior) await copyFile(path.join(source, file), path.join(oldMigrations, file));
    await applyMigrations(pool, oldMigrations);
    await pool.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
      VALUES ('legacy-owner','Legacy Owner','legacy@example.test',true,now(),now())`);
    await pool.query(`INSERT INTO staff_profile (staff_id,display_name_ar,is_owner)
      VALUES ('legacy-owner','مالك قديم',true)`);
    const operationId = crypto.randomUUID();
    await pool.query(`INSERT INTO inventory_operation (id,kind,payload_fingerprint,actor_staff_id)
      VALUES ($1,'receive',$2,'legacy-owner')`, [operationId, "a".repeat(64)]);
    await pool.query(`INSERT INTO receiving_receipt (id,operation_id,receipt_date,received_by_staff_id,recorded_at)
      VALUES ($1,$2,current_date,'legacy-owner',now())`, [crypto.randomUUID(), operationId]);

    const migration = await readFile(path.join(source, "030_branch_inventory.sql"), "utf8");
    await expect(pool.query(migration)).rejects.toThrow(/requires an empty business inventory/);
    const oldReceipt = await pool.query("SELECT COUNT(*)::int AS count FROM receiving_receipt");
    expect(oldReceipt.rows[0]?.count).toBe(1);
    const newTable = await pool.query("SELECT to_regclass('public.inventory_batch_balance') AS name");
    expect(newTable.rows[0]?.name).toBeNull();
  } finally {
    await pool.end();
    await rm(oldMigrations, { recursive: true, force: true });
  }
}, 120_000);
