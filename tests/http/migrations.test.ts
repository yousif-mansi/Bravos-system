import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { applyMigrations, inspectMigrations, listAppliedMigrations, resolveMigrationsDir, revertLastMigration } from "@bravos/persistence";
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
      "011_automatic_offers.sql",
      "012_physical_returns.sql",
      "013_storefront_contacts.sql",
      "014_bundles.sql",
      "015_coupons.sql",
      "016_recording_corrections.sql",
      "017_offline_promotions.sql",
      "018_exchanges.sql",
      "019_receiving_corrections.sql",
      "020_stock_quantity_corrections.sql",
      "021_online_checkout.sql",
      "022_protected_order_allocations.sql",
      "023_order_confirmation.sql",
      "024_inventory_order_disposition.sql",
      "025_order_fulfillment.sql",
      "026_opening_import.sql",
      "027_online_returns.sql",
      "028_aggregate_analytics.sql",
      "029_restore.sql",
      "030_branch_inventory.sql",
      "031_sale_payments.sql",
      "032_catalog_online_variants.sql",
      "033_human_references.sql",
      "034_order_recognition_branch.sql",
    ]);
    expect(await listAppliedMigrations(pool)).toEqual(first);
    expect(await tableNames(pool)).toEqual(
      expect.arrayContaining([
        "user",
        "staff_profile",
        "catalog_product",
        "catalog_product_variant",
        "inventory_batch",
        "inventory_batch_balance",
        "receiving_receipt",
        "inventory_allocation",
        "sales_sale",
        "expense_category",
        "expense_operation",
        "expense_record",
        "expense_change",
        "pricing_automatic_offer",
        "returns_return",
        "storefront_contacts",
        "pricing_automatic_offer_bundle_item",
        "pricing_coupon",
        "pricing_coupon_usage",
        "recording_correction",
        "recording_sale_unit_value",
        "returns_exchange",
        "returns_exchange_quote",
        "receiving_correction",
        "receiving_correction_line",
        "inventory_known_till",
        "inventory_count_coordination",
        "inventory_stock_correction",
        "inventory_stock_reconciliation",
        "delivery_area",
        "online_checkout_quote",
        "online_order",
        "online_order_line",
        "inventory_protected_order",
        "inventory_protected_order_allocation",
        "online_order_agreement_quote",
        "online_order_operation",
        "online_order_contact_attempt",
        "online_order_agreed_revision",
        "online_order_confirmation",
        "online_order_unreachable_cancellation",
        "online_order_settings",
        "inventory_order_disposition",
        "inventory_order_disposition_allocation",
        "online_order_fulfillment_event",
        "online_order_failed_return_inspection",
        "online_order_failed_return_inspection_line",
        "opening_import_preview",
        "recording_online_return_unit_value",
        "inventory_delivered_return_allocation_effect",
        "public_analytics_event",
        "restore_preview",
        "restore_runtime",
        "restore_preview_till",
        "restore_activation",
        "sales_restore_deferred_completion",
      ]),
    );

    const batchIndex = first.indexOf("017_offline_promotions.sql");
    expect(batchIndex).toBeGreaterThan(-1);
    for (const migration of first.slice(batchIndex).reverse()) {
      expect(await revertLastMigration(pool)).toBe(migration);
    }
    expect(await listAppliedMigrations(pool)).toEqual(first.slice(0, batchIndex));
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
    expect(await columnExists(pool, "sales_sale", "automatic_offer_discount_piasters")).toBe(true);
    expect(afterDown).toContain("inventory_stock_clock");
    expect(afterDown).toContain("expense_record");
    expect(afterDown).toContain("expense_change");
    expect(afterDown).toContain("expense_operation");
    expect(afterDown).toContain("pricing_automatic_offer");
    expect(afterDown).toContain("returns_return");
    expect(afterDown).toContain("storefront_contacts");
    expect(afterDown).toContain("pricing_automatic_offer_bundle_item");
    expect(await columnExists(pool, "sales_sale", "applied_automatic_offer_details")).toBe(true);
    expect(afterDown).toContain("pricing_coupon");
    expect(afterDown).toContain("pricing_coupon_usage");
    expect(await columnExists(pool, "sales_sale", "coupon_discount_piasters")).toBe(true);
    expect(afterDown).toContain("recording_correction");
    expect(await columnExists(pool, "returns_return_unit", "source_recording_sale_unit_id")).toBe(true);
    expect(afterDown).not.toContain("returns_exchange");
    expect(afterDown).not.toContain("returns_exchange_quote");
    expect(afterDown).not.toContain("receiving_correction");
    expect(afterDown).not.toContain("receiving_correction_line");
    expect(afterDown).not.toContain("inventory_known_till");
    expect(afterDown).not.toContain("inventory_count_coordination");
    expect(afterDown).not.toContain("inventory_stock_correction");
    expect(afterDown).not.toContain("inventory_stock_reconciliation");
    expect(afterDown).not.toContain("delivery_area");
    expect(afterDown).not.toContain("online_checkout_quote");
    expect(afterDown).not.toContain("online_order");
    expect(afterDown).not.toContain("online_order_line");
    expect(afterDown).not.toContain("inventory_protected_order");
    expect(afterDown).not.toContain("inventory_protected_order_allocation");
    expect(afterDown).not.toContain("online_order_agreement_quote");
    expect(afterDown).not.toContain("online_order_operation");
    expect(afterDown).not.toContain("online_order_contact_attempt");
    expect(afterDown).not.toContain("online_order_agreed_revision");
    expect(afterDown).not.toContain("online_order_confirmation");
    expect(afterDown).not.toContain("online_order_unreachable_cancellation");
    expect(afterDown).not.toContain("online_order_settings");
    expect(afterDown).not.toContain("inventory_order_disposition");
    expect(afterDown).not.toContain("inventory_order_disposition_allocation");
    expect(afterDown).not.toContain("online_order_fulfillment_event");
    expect(afterDown).not.toContain("online_order_failed_return_inspection");
    expect(afterDown).not.toContain("online_order_failed_return_inspection_line");
    expect(afterDown).not.toContain("opening_import_preview");
    expect(afterDown).not.toContain("recording_online_return_unit_value");
    expect(afterDown).not.toContain("inventory_delivered_return_allocation_effect");
    expect(await columnExists(pool, "returns_return", "source_online_order_id")).toBe(false);
    expect(await constraintExists(pool, "returns_return_source_exact")).toBe(false);
    expect(await constraintExists(pool, "returns_return_line_source_exact")).toBe(false);
    expect(afterDown).not.toContain("public_analytics_event");
    for (const table of ["restore_preview", "restore_runtime", "restore_preview_till", "restore_activation", "sales_restore_deferred_completion"]) {
      expect(afterDown).not.toContain(table);
    }
    expect(await columnExists(pool, "inventory_known_till", "restore_generation")).toBe(false);
    expect(await columnExists(pool, "sales_pos_snapshot", "pricing_version")).toBe(false);
    expect(await columnExists(pool, "sales_sale", "cash_received_piasters")).toBe(false);
    expect(await columnExists(pool, "inventory_batch", "effective_received_quantity")).toBe(false);

    const reapplied = await applyMigrations(pool);
    expect(reapplied).toEqual(first.slice(batchIndex));
    expect(await listAppliedMigrations(pool)).toEqual(first);
    expect(await tableNames(pool)).toEqual(
      expect.arrayContaining(["user", "staff_profile", "catalog_product", "inventory_batch", "receiving_receipt", "sales_sale", "sales_pos_snapshot", "expense_record", "expense_change", "expense_operation", "storefront_contacts"]),
    );
    expect(await columnType(pool, "sales_sale", "final_total_piasters")).toBe("bigint");
    expect(await columnExists(pool, "sales_sale_unit", "quantity")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "recovered_by_staff_id")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "automatic_offer_discount_piasters")).toBe(true);
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["inventory_stock_clock"]));
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["pricing_automatic_offer"]));
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["returns_return", "returns_return_line", "returns_refund_event"]));
    expect(await tableNames(pool)).toContain("pricing_automatic_offer_bundle_item");
    expect(await columnExists(pool, "sales_sale", "applied_automatic_offer_details")).toBe(true);
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["pricing_coupon", "pricing_coupon_usage"]));
    expect(await columnExists(pool, "sales_sale", "coupon_discount_piasters")).toBe(true);
    expect(await tableNames(pool)).toEqual(expect.arrayContaining(["recording_correction", "recording_sale_unit_value"]));
    expect(await columnExists(pool, "returns_return_unit", "source_recording_sale_unit_id")).toBe(true);

    expect(await tableNames(pool)).toEqual(expect.arrayContaining([
      "returns_exchange", "returns_exchange_quote", "receiving_correction", "receiving_correction_line",
      "inventory_known_till", "inventory_count_coordination", "inventory_stock_correction", "inventory_stock_reconciliation",
      "delivery_area", "online_checkout_quote", "online_order", "online_order_line",
      "inventory_protected_order", "inventory_protected_order_allocation",
      "online_order_agreement_quote", "online_order_operation", "online_order_contact_attempt",
      "online_order_agreed_revision", "online_order_confirmation", "online_order_unreachable_cancellation",
      "online_order_settings",
      "inventory_order_disposition", "inventory_order_disposition_allocation",
      "online_order_fulfillment_event", "online_order_failed_return_inspection",
      "online_order_failed_return_inspection_line",
      "opening_import_preview",
      "recording_online_return_unit_value", "inventory_delivered_return_allocation_effect",
      "public_analytics_event",
      "restore_preview", "restore_runtime", "restore_preview_till", "restore_activation",
      "sales_restore_deferred_completion",
      "inventory_batch_balance",
    ]));
    expect(await columnExists(pool, "sales_pos_snapshot", "restore_generation")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "source_restore_generation")).toBe(true);
    expect(await columnExists(pool, "returns_return", "source_online_order_id")).toBe(true);
    expect(await constraintExists(pool, "returns_return_source_exact")).toBe(true);
    expect(await constraintExists(pool, "returns_return_line_source_exact")).toBe(true);
    expect(await columnExists(pool, "sales_pos_snapshot", "pricing_version")).toBe(true);
    expect(await columnExists(pool, "sales_pos_snapshot", "coupon_accounted_operations")).toBe(true);
    expect(await columnExists(pool, "sales_sale", "cash_received_piasters")).toBe(true);
    expect(await columnExists(pool, "inventory_batch", "effective_received_quantity")).toBe(true);
    expect(await columnExists(pool, "inventory_batch", "effective_unit_cost_piasters")).toBe(true);

    const fullyReverted: string[] = [];
    for (;;) {
      const id = await revertLastMigration(pool);
      if (!id) {
        break;
      }
      fullyReverted.push(id);
    }
    expect(fullyReverted).toEqual([...first].reverse());
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
    expect(await tableNames(pool)).toEqual(expect.arrayContaining([
      "recording_online_return_unit_value",
      "inventory_delivered_return_allocation_effect",
    ]));
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
    for (;;) {
      const applied = await listAppliedMigrations(pool);
      if (applied.at(-1) === "009_sales_sync_ack.sql") break;
      expect(await revertLastMigration(pool)).toBeTruthy();
    }
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

    const reapplied = await applyMigrations(pool);
    expect(reapplied).toEqual([
      "008_sales_money_ranges.sql",
      "009_sales_sync_ack.sql",
      "010_expenses.sql",
      "011_automatic_offers.sql",
      "012_physical_returns.sql",
      "013_storefront_contacts.sql",
      "014_bundles.sql",
      "015_coupons.sql",
      "016_recording_corrections.sql",
      "017_offline_promotions.sql",
      "018_exchanges.sql",
      "019_receiving_corrections.sql",
      "020_stock_quantity_corrections.sql",
      "021_online_checkout.sql",
      "022_protected_order_allocations.sql",
      "023_order_confirmation.sql",
      "024_inventory_order_disposition.sql",
      "025_order_fulfillment.sql",
      "026_opening_import.sql",
      "027_online_returns.sql",
      "028_aggregate_analytics.sql",
      "029_restore.sql",
      "030_branch_inventory.sql",
      "031_sale_payments.sql",
      "032_catalog_online_variants.sql",
      "033_human_references.sql",
      "034_order_recognition_branch.sql",
    ]);
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

test("029 refuses to discard restore history or retained sales during rollback", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    await applyMigrations(pool);
    await revertToMigration(pool, "029_restore.sql");
    expect((await pool.query("SELECT current_generation::text AS generation FROM restore_runtime")).rows).toEqual([{ generation: "0" }]);
    await pool.query("UPDATE restore_runtime SET current_generation = 1");
    await expect(revertLastMigration(pool)).rejects.toThrow(/Cannot remove restore history/);
    expect((await listAppliedMigrations(pool)).at(-1)).toBe("029_restore.sql");

    await pool.query("UPDATE restore_runtime SET current_generation = 0");
    await pool.query(
      `INSERT INTO sales_restore_deferred_completion (
         operation_id, sale_id, payload_fingerprint, source_generation, original_staff_id, branch_id,
         occurred_at, payload_json, retained_at
       ) VALUES ($1, $2, repeat('b', 64), 0, 'staff', '11111111-1111-4111-8111-111111111111', now(), '{}'::jsonb, now())`,
      [crypto.randomUUID(), crypto.randomUUID()],
    );
    await expect(revertLastMigration(pool)).rejects.toThrow(/Cannot remove restore history/);
    expect(await tableNames(pool)).toContain("sales_restore_deferred_completion");

    await pool.query("DELETE FROM sales_restore_deferred_completion");
    expect(await revertLastMigration(pool)).toBe("029_restore.sql");
    expect(await tableNames(pool)).not.toContain("restore_runtime");
    expect(await triggerCount(pool, "restore_write_guard_%")).toBe(0);
    expect(await constraintDeferrable(pool, "expense_operation_expense_fk")).toBe(false);
    expect(await applyMigrations(pool)).toEqual([
      "029_restore.sql", "030_branch_inventory.sql", "031_sale_payments.sql",
      "032_catalog_online_variants.sql", "033_human_references.sql", "034_order_recognition_branch.sql",
    ]);
    expect(await unguardedBusinessTables(pool)).toEqual([]);
    expect(await constraintDeferrable(pool, "expense_operation_expense_fk")).toBe(true);
  } finally {
    await pool.end();
  }
});

test("028 refuses to discard retained analytics events during rollback", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    await applyMigrations(pool);
    await revertToMigration(pool, "029_restore.sql");
    expect(await revertLastMigration(pool)).toBe("029_restore.sql");
    await pool.query(
      `INSERT INTO public_analytics_event
         (operation_id,payload_fingerprint,event_type,product_id,variant_id,quantity,recorded_at)
       VALUES ($1,repeat('a',64),'visit',NULL,NULL,NULL,'2026-09-16T10:00:00Z')`,
      [crypto.randomUUID()],
    );

    await expect(revertLastMigration(pool)).rejects.toThrow(/Cannot remove aggregate analytics/);
    expect((await listAppliedMigrations(pool)).at(-1)).toBe("028_aggregate_analytics.sql");
    expect(await tableNames(pool)).toContain("public_analytics_event");

    await pool.query("DELETE FROM public_analytics_event");
    expect(await revertLastMigration(pool)).toBe("028_aggregate_analytics.sql");
    expect(await tableNames(pool)).not.toContain("public_analytics_event");
    expect(await applyMigrations(pool)).toEqual([
      "028_aggregate_analytics.sql", "029_restore.sql", "030_branch_inventory.sql",
      "031_sale_payments.sql", "032_catalog_online_variants.sql", "033_human_references.sql",
      "034_order_recognition_branch.sql",
    ]);
  } finally {
    await pool.end();
  }
});

test("020 backfills each legacy till from its latest snapshot without inventing synchronization", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    await applyMigrations(pool);
    for (;;) {
      const applied = await listAppliedMigrations(pool);
      if (applied.at(-1) === "019_receiving_corrections.sql") break;
      expect(await revertLastMigration(pool)).toBeTruthy();
    }

    await pool.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('staff-legacy-till', 'Legacy Till', 'legacy-till@bravos.test', true, now(), now());
      INSERT INTO staff_profile (staff_id, display_name_ar, is_owner)
      VALUES ('staff-legacy-till', 'موظف الجهاز القديم', true);
      INSERT INTO sales_pos_snapshot (id, staff_id, branch_id, device_id, issued_at, price_fingerprint)
      VALUES
        (
          '30303030-3030-4030-8030-303030303030',
          'staff-legacy-till',
          '11111111-1111-4111-8111-111111111111',
          '10101010-1010-4010-8010-101010101010',
          '2026-09-13T08:00:00Z',
          'device-one-older'
        ),
        (
          '31313131-3131-4131-8131-313131313131',
          'staff-legacy-till',
          '11111111-1111-4111-8111-111111111111',
          '10101010-1010-4010-8010-101010101010',
          '2026-09-14T08:00:00Z',
          'device-one-latest'
        ),
        (
          '32323232-3232-4232-8232-323232323232',
          'staff-legacy-till',
          '22222222-2222-4222-8222-222222222222',
          '20202020-2020-4020-8020-202020202020',
          '2026-09-12T08:00:00Z',
          'device-two-only'
        );
    `);

    expect(await applyMigrations(pool)).toEqual([
      "020_stock_quantity_corrections.sql",
      "021_online_checkout.sql",
      "022_protected_order_allocations.sql",
      "023_order_confirmation.sql",
      "024_inventory_order_disposition.sql",
      "025_order_fulfillment.sql",
      "026_opening_import.sql",
      "027_online_returns.sql",
      "028_aggregate_analytics.sql",
      "029_restore.sql",
      "030_branch_inventory.sql",
      "031_sale_payments.sql",
      "032_catalog_online_variants.sql",
      "033_human_references.sql",
      "034_order_recognition_branch.sql",
    ]);
    const knownTills = await pool.query<{
      device_id: string;
      latest_snapshot_id: string;
      stock_version: string | null;
      pending_operation_ids: string[];
      included_operation_ids: string[];
      synchronization_complete: boolean;
    }>(`
      SELECT
        device_id,
        latest_snapshot_id,
        stock_version,
        pending_operation_ids,
        included_operation_ids,
        synchronization_complete
      FROM inventory_known_till
      ORDER BY device_id
    `);
    expect(knownTills.rows).toEqual([
      {
        device_id: "10101010-1010-4010-8010-101010101010",
        latest_snapshot_id: "31313131-3131-4131-8131-313131313131",
        stock_version: null,
        pending_operation_ids: [],
        included_operation_ids: [],
        synchronization_complete: false,
      },
      {
        device_id: "20202020-2020-4020-8020-202020202020",
        latest_snapshot_id: "32323232-3232-4232-8232-323232323232",
        stock_version: null,
        pending_operation_ids: [],
        included_operation_ids: [],
        synchronization_complete: false,
      },
    ]);
  } finally {
    await pool.end();
  }
});

test("027 refuses to discard delivered online Return evidence during rollback", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    await applyMigrations(pool);
    await revertToMigration(pool, "029_restore.sql");
    expect(await revertLastMigration(pool)).toBe("029_restore.sql");
    expect(await revertLastMigration(pool)).toBe("028_aggregate_analytics.sql");
    await pool.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES ('staff-online-return', 'Online Return', 'online-return@bravos.test', true, now(), now());
      INSERT INTO staff_profile (staff_id, display_name_ar, is_owner)
      VALUES ('staff-online-return', 'موظف المرتجع الإلكتروني', true);
      INSERT INTO delivery_area (id, name_ar, fee_piasters, changed_by_staff_id, changed_at)
      VALUES (
        '41414141-4141-4141-8141-414141414141', 'منطقة الاختبار', 0, 'staff-online-return', now()
      );
      INSERT INTO online_checkout_quote (
        id, request_fingerprint, request_json, quote_json, created_at
      ) VALUES (
        '42424242-4242-4242-8242-424242424242', repeat('a', 64), '{}'::jsonb, '{}'::jsonb, now()
      );
      INSERT INTO online_order (
        id, operation_id, payload_fingerprint, quote_id, reference, status,
        customer_name, primary_phone, detailed_address, delivery_area_id,
        requested_delivery_area_name_ar, requested_merchandise_original_piasters,
        requested_automatic_offer_discount_piasters, requested_coupon_discount_piasters,
        requested_merchandise_total_piasters, requested_delivery_fee_piasters,
        requested_final_total_piasters, submitted_at, confirmed_by_staff_id, confirmed_at
      ) VALUES (
        '43434343-4343-4343-8343-434343434343',
        '44444444-4444-4444-8444-444444444444',
        repeat('b', 64),
        '42424242-4242-4242-8242-424242424242',
        'WEB-GUARD-027',
        'delivered',
        'عميل الاختبار',
        '01000000000',
        'عنوان الاختبار',
        '41414141-4141-4141-8141-414141414141',
        'منطقة الاختبار',
        0, 0, 0, 0, 0, 0, now(), 'staff-online-return', now()
      );
      INSERT INTO returns_return (
        id, operation_id, source_online_order_id, handling_branch_id, status,
        payload_fingerprint, draft_payload_fingerprint, suggested_refund_piasters,
        authorized_refund_piasters, created_by_staff_id, updated_by_staff_id
      ) VALUES (
        '45454545-4545-4545-8545-454545454545',
        '46464646-4646-4646-8646-464646464646',
        '43434343-4343-4343-8343-434343434343',
        '11111111-1111-4111-8111-111111111111',
        'draft',
        'guard-027',
        'guard-027-draft',
        0,
        0,
        'staff-online-return',
        'staff-online-return'
      );
    `);

    await expect(revertLastMigration(pool)).rejects.toThrow(/Cannot downgrade migration 027/i);
    expect((await listAppliedMigrations(pool)).at(-1)).toBe("027_online_returns.sql");
    expect(await tableNames(pool)).toEqual(expect.arrayContaining([
      "recording_online_return_unit_value",
      "inventory_delivered_return_allocation_effect",
    ]));

    await pool.query(`DELETE FROM returns_return WHERE id = '45454545-4545-4545-8545-454545454545'`);
    expect(await revertLastMigration(pool)).toBe("027_online_returns.sql");
    const afterDown = await tableNames(pool);
    expect(afterDown).not.toContain("recording_online_return_unit_value");
    expect(afterDown).not.toContain("inventory_delivered_return_allocation_effect");
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
    await cp(resolveMigrationsDir(), dir, { recursive: true });
    await writeFile(
      path.join(dir, "999_fail_probe.sql"),
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
      ["999_fail_probe.sql"],
    );
    expect(bookkeeping.rows).toHaveLength(0);
  } finally {
    await pool.end();
  }
});

test("concurrent forward migration commands serialize under one database lock", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 3 });
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "bravos-locked-migration-"));
    await writeFile(path.join(dir, "001_lock_probe.sql"), "CREATE TABLE lock_probe (id integer PRIMARY KEY);\n", "utf8");
    const [first, second] = await Promise.all([applyMigrations(pool, dir), applyMigrations(pool, dir)]);
    const status = await inspectMigrations(pool, dir);
    expect([first.length, second.length].sort((left, right) => left - right)).toEqual([0, status.known.length]);
    expect(status.applied).toEqual(status.known);
    expect(status.pending).toEqual([]);
    expect(status.unexpected).toEqual([]);
    expect(status.outOfOrder).toBe(false);
  } finally {
    await pool.end();
  }
});

test("migration inspection and apply fail closed on a gap in recorded history", async () => {
  const databaseName = `bravos_migrate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const pool = new Pool({ connectionString: cluster.connectionString(databaseName), max: 2 });
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "bravos-drift-migration-"));
    await writeFile(path.join(dir, "001_probe.sql"), "CREATE TABLE drift_probe_1 (id integer PRIMARY KEY);\n", "utf8");
    await writeFile(path.join(dir, "002_probe.sql"), "CREATE TABLE drift_probe_2 (id integer PRIMARY KEY);\n", "utf8");
    await writeFile(path.join(dir, "003_probe.sql"), "CREATE TABLE drift_probe_3 (id integer PRIMARY KEY);\n", "utf8");
    await applyMigrations(pool, dir);
    await pool.query("DELETE FROM schema_migrations WHERE id = $1", ["002_probe.sql"]);
    const status = await inspectMigrations(pool, dir);
    expect(status.outOfOrder).toBe(true);
    expect(status.unexpected).toEqual([]);
    await expect(applyMigrations(pool, dir)).rejects.toThrow(/migration history drift/i);
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

async function revertToMigration(pool: Pool, target: string): Promise<void> {
  const applied = await listAppliedMigrations(pool);
  if (!applied.includes(target)) throw new Error(`Migration ${target} is not applied.`);
  for (const migration of applied.slice(applied.indexOf(target) + 1).reverse()) {
    expect(await revertLastMigration(pool)).toBe(migration);
  }
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

async function constraintExists(pool: Pool, constraintName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = $1
     ) AS exists`,
    [constraintName],
  );
  return result.rows[0]?.exists === true;
}

async function triggerCount(pool: Pool, pattern: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_trigger WHERE tgname LIKE $1 AND NOT tgisinternal",
    [pattern],
  );
  return Number(result.rows[0]?.count ?? 0);
}

// A deferrable delete check must use NO ACTION: PostgreSQL checks RESTRICT immediately even when deferred.
async function constraintDeferrable(pool: Pool, constraintName: string): Promise<boolean> {
  const result = await pool.query<{ condeferrable: boolean; confdeltype: string }>(
    "SELECT condeferrable, confdeltype FROM pg_constraint WHERE conname = $1",
    [constraintName],
  );
  return result.rows[0]?.condeferrable === true && result.rows[0]?.confdeltype === "a";
}

// Every business table must enter the restore write barrier; only restore control, session and
// till-evidence tables are exempt. A table added by a later migration needs its own guard.
async function unguardedBusinessTables(pool: Pool): Promise<string[]> {
  const exempt = new Set([
    "schema_migrations", "session", "account", "verification", "owner_recovery_challenge", "staff_session_branch",
    "sales_pos_snapshot", "sales_pos_snapshot_price", "inventory_known_till", "inventory_count_coordination_device",
    "sales_restore_deferred_completion", "restore_preview", "restore_runtime", "restore_preview_till", "restore_activation",
  ]);
  const result = await pool.query<{ tablename: string }>(
    `SELECT t.tablename FROM pg_tables t
     WHERE t.schemaname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
         WHERE c.relname = t.tablename AND g.tgfoid = 'restore_business_write_guard'::regproc AND NOT g.tgisinternal
       )
     ORDER BY t.tablename`,
  );
  return result.rows.map((row) => row.tablename).filter((table) => !exempt.has(table));
}
