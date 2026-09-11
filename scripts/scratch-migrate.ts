import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, listAppliedMigrations, revertLastMigration } from "@bravos/persistence";
import { Pool } from "pg";
import { startPostgresCluster } from "@bravos/testkit";

const cluster = await startPostgresCluster({ port: 55434 });
const databaseName = "bravos_scratch_roundtrip";
try {
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    const first = await applyMigrations(pool);
    const afterApply = await listAppliedMigrations(pool);
    if (first.length < 2 || afterApply.join(",") !== first.join(",")) {
      throw new Error(`Scratch apply did not record multiple migrations: ${first.join(",")}`);
    }
    const latest = first.at(-1);
    const previous = first.slice(0, -1);
    const tablesAfterApply = await tableNames(pool);
    if (!tablesAfterApply.includes("user") || !tablesAfterApply.includes("staff_profile")) {
      throw new Error("Scratch apply did not create identity tables.");
    }
    if (!tablesAfterApply.includes("catalog_product") || !tablesAfterApply.includes("catalog_product_variant")) {
      throw new Error("Scratch apply did not create catalog tables.");
    }
    if (!tablesAfterApply.includes("inventory_batch") || !tablesAfterApply.includes("receiving_receipt")) {
      throw new Error("Scratch apply did not create inventory and receiving tables.");
    }

    const reverted = await revertLastMigration(pool);
    if (reverted !== latest) {
      throw new Error(`Scratch down did not revert the latest migration: ${reverted}`);
    }
    const afterDown = await listAppliedMigrations(pool);
    if (afterDown.join(",") !== previous.join(",")) {
      throw new Error("Scratch down did not leave earlier migrations applied.");
    }
    const tablesAfterDown = await tableNames(pool);
    if (!tablesAfterDown.includes("user") || !tablesAfterDown.includes("staff_profile")) {
      throw new Error("Scratch down removed identity tables while reverting a later migration.");
    }
    if (!tablesAfterDown.includes("catalog_product") || !tablesAfterDown.includes("inventory_batch")) {
      throw new Error("Scratch down removed earlier feature tables while reverting the latest migration.");
    }
    if (tablesAfterDown.includes("receiving_receipt") || tablesAfterDown.includes("receiving_receipt_line")) {
      throw new Error("Scratch down did not remove the latest receiving tables.");
    }

    const reapplied = await applyMigrations(pool);
    const afterReapply = await listAppliedMigrations(pool);
    if (reapplied.join(",") !== latest || afterReapply.join(",") !== afterApply.join(",")) {
      throw new Error("Scratch reapply did not restore the latest migration.");
    }
    const tablesAfterReapply = await tableNames(pool);
    if (!tablesAfterReapply.includes("receiving_receipt") || !tablesAfterReapply.includes("inventory_batch")) {
      throw new Error("Scratch reapply did not restore receiving and inventory tables.");
    }

    const fullyReverted: string[] = [];
    for (;;) {
      const id = await revertLastMigration(pool);
      if (!id) {
        break;
      }
      fullyReverted.push(id);
    }
    if (fullyReverted.join(",") !== [...first].reverse().join(",")) {
      throw new Error(`Scratch full down order was ${fullyReverted.join(",")}`);
    }
    const empty = await tableNames(pool);
    if (empty.includes("user") || empty.includes("catalog_product") || empty.includes("inventory_batch") || empty.includes("receiving_receipt")) {
      throw new Error("Scratch full down left feature tables.");
    }

    const restored = await applyMigrations(pool);
    if (restored.join(",") !== first.join(",")) {
      throw new Error("Scratch full reapply did not restore every migration.");
    }

    await expectFailedMigrationRollsBack(pool);

    console.log(
      `scratch migration apply/down/reapply ok: applied=${first.join(",")} reverted=${reverted} reapplied=${reapplied.join(",")}`,
    );
  } finally {
    await pool.end();
  }
} finally {
  await cluster.stop();
}

async function expectFailedMigrationRollsBack(pool: Pool): Promise<void> {
  const before = await listAppliedMigrations(pool);
  const dir = await mkdtemp(path.join(tmpdir(), "bravos-scratch-fail-"));
  await writeFile(
    path.join(dir, "002_fail_probe.sql"),
    "CREATE TABLE scratch_fail_probe (id integer PRIMARY KEY);\nSELECT 1 / 0;\n",
    "utf8",
  );
  try {
    await applyMigrations(pool, dir);
    throw new Error("Expected applyMigrations to reject the failing scratch migration.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/division by zero/i.test(message)) {
      throw error;
    }
  }
  const leftover = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scratch_fail_probe'
     ) AS exists`,
  );
  if (leftover.rows[0]?.exists) {
    throw new Error("Failed migration left a partial table on the scratch database.");
  }
  const bookkeeping = await pool.query<{ id: string }>(
    "SELECT id FROM schema_migrations WHERE id = $1",
    ["002_fail_probe.sql"],
  );
  if (bookkeeping.rows.length > 0) {
    throw new Error("Failed migration left a schema_migrations row.");
  }
  const after = await listAppliedMigrations(pool);
  if (after.join(",") !== before.join(",")) {
    throw new Error("Failed migration changed applied migration bookkeeping.");
  }
}

async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}
