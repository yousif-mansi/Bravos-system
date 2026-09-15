import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations, listAppliedMigrations, revertLastMigration } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { Pool } from "pg";

let cluster: PostgresCluster;

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55436 });
}, 120_000);

afterAll(async () => {
  await cluster.stop();
});

test("apply, down the latest migration, and reapply works with multiple migrations", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    const first = await applyMigrations(pool);
    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual([
      "001_identity.sql",
      "002_catalog.sql",
      "003_inventory.sql",
      "004_receiving.sql",
      "005_inventory_allocation.sql",
      "006_sales.sql",
      "007_sales_pos_snapshot.sql",
      "008_sales_money_ranges.sql",
      "009_sales_sync_ack.sql",
      "010_expenses.sql",
    ]);
    expect(await listAppliedMigrations(pool)).toEqual(first);
    expect(await tableNames(pool)).toEqual(
      expect.arrayContaining([
        "user",
        "staff_profile",
        "catalog_product",
        "catalog_product_variant",
        "inventory_batch",
        "receiving_receipt",
        "inventory_allocation",
        "sales_sale",
        "expense_category",
        "expense_operation",
        "expense_record",
        "expense_change",
      ]),
    );

    const reverted = await revertLastMigration(pool);
    expect(reverted).toBe("010_expenses.sql");
    expect(await listAppliedMigrations(pool)).toEqual([
      "001_identity.sql",
      "002_catalog.sql",
      "003_inventory.sql",
      "004_receiving.sql",
      "005_inventory_allocation.sql",
      "006_sales.sql",
      "007_sales_pos_snapshot.sql",
      "008_sales_money_ranges.sql",
      "009_sales_sync_ack.sql",
    ]);
    const afterDown = await tableNames(pool);
    expect(afterDown).toEqual(
      expect.arrayContaining([
        "user",
        "staff_profile",
        "catalog_product",
        "inventory_batch",
        "receiving_receipt",
        "inventory_allocation",
        "sales_sale",
        "sales_pos_snapshot",
      ]),
    );
    expect(await columnType(pool, "sales_sale", "final_total_piasters")).toBe("bigint");
    expect(await columnExists(pool, "sales_sale_unit", "quantity")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "recovered_by_staff_id")).toBe(true);
    expect(afterDown).toContain("inventory_stock_clock");
    expect(afterDown).not.toContain("expense_record");
    expect(afterDown).not.toContain("expense_change");
    expect(afterDown).not.toContain("expense_operation");

    const reapplied = await applyMigrations(pool);
    expect(reapplied).toEqual(["010_expenses.sql"]);
    expect(await listAppliedMigrations(pool)).toEqual(first);
    expect(await tableNames(pool)).toEqual(
      expect.arrayContaining(["user", "staff_profile", "catalog_product", "inventory_batch", "receiving_receipt", "sales_sale", "sales_pos_snapshot", "expense_record", "expense_change", "expense_operation"]),
    );
    expect(await columnType(pool, "sales_sale", "final_total_piasters")).toBe("bigint");
    expect(await columnExists(pool, "sales_sale_unit", "quantity")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "recovered_by_staff_id")).toBe(true);
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["inventory_stock_clock"]));

    const fullyReverted: string[] = [];
    for (;;) {
      const id = await revertLastMigration(pool);
      if (!id) {
        break;
      }
      fullyReverted.push(id);
    }
    expect(fullyReverted).toEqual([
      "010_expenses.sql",
      "009_sales_sync_ack.sql",
      "008_sales_money_ranges.sql",
      "007_sales_pos_snapshot.sql",
      "006_sales.sql",
      "005_inventory_allocation.sql",
      "004_receiving.sql",
      "003_inventory.sql",
      "002_catalog.sql",
      "001_identity.sql",
    ]);
    expect(await listAppliedMigrations(pool)).toEqual([]);
    const empty = await tableNames(pool);
    expect(empty).not.toContain("user");
    expect(empty).not.toContain("catalog_product");
    expect(empty).not.toContain("inventory_batch");
    expect(empty).not.toContain("receiving_receipt");
    expect(empty).not.toContain("sales_sale");

    const restored = await applyMigrations(pool);
    expect(restored).toEqual(first);
    expect(await listAppliedMigrations(pool)).toEqual(first);
  } finally {
    await pool.end();
  }
});

test("008 down expands counted unit ranges into one legacy row per ordinal", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    await applyMigrations(pool);
    await pool.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('staff-range', 'Range', 'range@bravos.test', true, now(), now());
      INSERT INTO staff_profile (staff_id, display_name_ar, is_owner)
      VALUES ('staff-range', 'موظف النطاق', true);
      INSERT INTO catalog_category (id, name_ar)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'تصنيف');
      INSERT INTO catalog_size (id, name_ar)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'مقاس');
      INSERT INTO catalog_color (id, name_ar)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'لون');
      INSERT INTO catalog_product (
        id, code, name_ar, description_ar, category_id, default_selling_price_piasters, publication
      ) VALUES (
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'RNG-001', 'قميص', 'قطن',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 100, 'hidden'
      );
      INSERT INTO catalog_product_variant (id, product_id, size_id, color_id)
      VALUES (
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      );
      INSERT INTO sales_sale (
        id, operation_id, branch_id, sold_by_staff_id, sold_by_display_name,
        occurred_at, recorded_at, original_total_piasters, employee_discount_piasters,
        final_total_piasters, payload_fingerprint, physically_completed
      ) VALUES (
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '99999999-9999-4999-8999-999999999999',
        '11111111-1111-4111-8111-111111111111',
        'staff-range',
        'موظف النطاق',
        now(),
        now(),
        200,
        2,
        198,
        'range-fingerprint',
        true
      );
      INSERT INTO sales_sale_line (
        id, sale_id, variant_id, quantity, listed_unit_price_piasters, original_piasters,
        discount_piasters, paid_piasters, allocated_quantity, unallocated_quantity, line_index
      ) VALUES (
        '12121212-1212-4121-8121-121212121212',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        2,
        100,
        200,
        2,
        198,
        0,
        0,
        0
      );
      INSERT INTO sales_sale_unit (
        id, sale_id, line_id, unit_index, quantity, listed_piasters, discount_piasters, paid_piasters
      ) VALUES (
        '34343434-3434-4343-8343-343434343434',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '12121212-1212-4121-8121-121212121212',
        0,
        1,
        100,
        1,
        99
      ), (
        '56565656-5656-4565-8565-565656565656',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '12121212-1212-4121-8121-121212121212',
        1,
        1,
        100,
        1,
        99
      );
    `);
    await pool.query(`
      DELETE FROM sales_sale_unit WHERE id = '56565656-5656-4565-8565-565656565656';
      UPDATE sales_sale_unit
      SET quantity = 2, unit_index = 0
      WHERE id = '34343434-3434-4343-8343-343434343434';
    `);
    const before = await pool.query<{ unit_index: number; quantity: number; paid_piasters: number }>(
      `SELECT unit_index, quantity, paid_piasters FROM sales_sale_unit ORDER BY unit_index`,
    );
    expect(before.rows).toEqual([{ unit_index: 0, quantity: 2, paid_piasters: 99 }]);

    expect(await revertLastMigration(pool)).toBe("010_expenses.sql");
    expect(await revertLastMigration(pool)).toBe("009_sales_sync_ack.sql");
    expect(await columnExists(pool, "sales_sale", "recovered_by_staff_id")).toBe(false);
    expect(await tableNames(pool)).not.toContain("inventory_stock_clock");
    expect(await revertLastMigration(pool)).toBe("008_sales_money_ranges.sql");
    expect(await columnExists(pool, "sales_sale_unit", "quantity")).toBe(false);
    const expanded = await pool.query<{ unit_index: number; paid_piasters: number }>(
      `SELECT unit_index, paid_piasters FROM sales_sale_unit ORDER BY unit_index`,
    );
    expect(expanded.rows).toEqual([
      { unit_index: 0, paid_piasters: 99 },
      { unit_index: 1, paid_piasters: 99 },
    ]);

    expect(await applyMigrations(pool)).toEqual(["008_sales_money_ranges.sql", "009_sales_sync_ack.sql", "010_expenses.sql"]);
    const restored = await pool.query<{ unit_index: number; quantity: number; paid_piasters: number }>(
      `SELECT unit_index, quantity, paid_piasters FROM sales_sale_unit ORDER BY unit_index`,
    );
    expect(restored.rows).toEqual([
      { unit_index: 0, quantity: 1, paid_piasters: 99 },
      { unit_index: 1, quantity: 1, paid_piasters: 99 },
    ]);
  } finally {
    await pool.end();
  }
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

async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return result.rows[0]?.exists === true;
}

async function columnType(pool: Pool, table: string, column: string): Promise<string | undefined> {
  const result = await pool.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return result.rows[0]?.data_type;
}
