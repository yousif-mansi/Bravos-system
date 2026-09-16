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
    const expectedMigrations = [
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
    ];
    if (first.join(",") !== expectedMigrations.join(",") || afterApply.join(",") !== first.join(",")) {
      throw new Error(`Scratch apply did not record multiple migrations: ${first.join(",")}`);
    }
    const batchStart = first.indexOf("014_bundles.sql");
    const currentBatch = first.slice(batchStart);
    const previous = first.slice(0, batchStart);
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
    if (!tablesAfterApply.includes("inventory_allocation") || !tablesAfterApply.includes("sales_sale")) {
      throw new Error("Scratch apply did not create allocation and sales tables.");
    }
    if (!tablesAfterApply.includes("sales_pos_snapshot") || !tablesAfterApply.includes("sales_pos_snapshot_price")) {
      throw new Error("Scratch apply did not create POS price snapshot tables.");
    }
    if (!(await columnExists(pool, "sales_sale_unit", "quantity"))) {
      throw new Error("Scratch apply did not preserve the sale-unit quantity column from migration 008.");
    }
    if (!tablesAfterApply.includes("inventory_stock_clock")) {
      throw new Error("Scratch apply did not create the inventory stock clock from migration 009.");
    }
    if (
      !(await columnExists(pool, "sales_sale", "recovered_by_staff_id")) ||
      !(await columnExists(pool, "sales_sale", "recovered_at")) ||
      !(await constraintExists(pool, "sales_sale_recovery_pair"))
    ) {
      throw new Error("Scratch apply did not add the sale recovery fields and pairing constraint from migration 009.");
    }
    if (!tablesAfterApply.includes("expense_record") || !tablesAfterApply.includes("expense_change") || !tablesAfterApply.includes("expense_operation")) {
      throw new Error("Scratch apply did not create expense records, changes and operation receipts.");
    }
    if (!tablesAfterApply.includes("pricing_automatic_offer")) {
      throw new Error("Scratch apply did not create automatic offers from migration 011.");
    }
    if (!tablesAfterApply.includes("returns_return") || !tablesAfterApply.includes("returns_return_line") || !tablesAfterApply.includes("returns_refund_event")) {
      throw new Error("Scratch apply did not create physical return records from migration 012.");
    }
    if (!tablesAfterApply.includes("storefront_contacts")) {
      throw new Error("Scratch apply did not create storefront contacts from migration 013.");
    }
    if (!tablesAfterApply.includes("pricing_automatic_offer_bundle_item")
      || !(await columnExists(pool, "sales_sale", "applied_automatic_offer_details"))) {
      throw new Error("Scratch apply did not create bundle pricing storage from migration 014.");
    }

    if (!tablesAfterApply.includes("pricing_coupon") || !tablesAfterApply.includes("pricing_coupon_usage")
      || !(await columnExists(pool, "sales_sale", "coupon_discount_piasters"))) {
      throw new Error("Scratch apply did not create coupon storage from migration 015.");
    }
    if (!tablesAfterApply.includes("recording_correction") || !tablesAfterApply.includes("recording_sale_unit_value")
      || !(await columnExists(pool, "returns_return_unit", "source_recording_sale_unit_id"))) {
      throw new Error("Scratch apply did not create recording correction storage from migration 016.");
    }
    await assertCurrentBatchStorage(pool, true);
    for (const expected of [...currentBatch].reverse()) {
      const reverted = await revertLastMigration(pool);
      if (reverted !== expected) throw new Error(`Scratch down expected ${expected}, got ${reverted}`);
    }
    const afterDown = await listAppliedMigrations(pool);
    if (afterDown.join(",") !== previous.join(",")) {
      throw new Error("Scratch down did not leave earlier migrations applied.");
    }
    const tablesAfterDown = await tableNames(pool);
    await assertCurrentBatchStorage(pool, false);
    if (!tablesAfterDown.includes("user") || !tablesAfterDown.includes("staff_profile")) {
      throw new Error("Scratch down removed identity tables while reverting a later migration.");
    }
    if (!tablesAfterDown.includes("catalog_product") || !tablesAfterDown.includes("inventory_batch")) {
      throw new Error("Scratch down removed earlier feature tables while reverting the latest migration.");
    }
    if (!tablesAfterDown.includes("sales_pos_snapshot") || !tablesAfterDown.includes("sales_pos_snapshot_price")) {
      throw new Error("Scratch down removed POS snapshot tables while reverting a later money-range migration.");
    }
    if (!tablesAfterDown.includes("sales_sale")) {
      throw new Error("Scratch down removed earlier sales tables while reverting the money-range migration.");
    }
    if (!tablesAfterDown.includes("receiving_receipt") || !tablesAfterDown.includes("inventory_allocation")) {
      throw new Error("Scratch down removed earlier receiving or allocation tables.");
    }
    if (!(await columnExists(pool, "sales_sale_unit", "quantity"))) {
      throw new Error("Scratch down removed the sale-unit quantity column from migration 008.");
    }
    if (
      !tablesAfterDown.includes("inventory_stock_clock") ||
      !(await columnExists(pool, "sales_sale", "recovered_by_staff_id")) ||
      !(await columnExists(pool, "sales_sale", "recovered_at")) ||
      !(await constraintExists(pool, "sales_sale_recovery_pair"))
    ) {
      throw new Error("Scratch expense down removed the stock clock or sale recovery schema from migration 009.");
    }
    if (!tablesAfterDown.includes("expense_record") || !tablesAfterDown.includes("pricing_automatic_offer") || !tablesAfterDown.includes("returns_return")) {
      throw new Error("Scratch storefront down removed an earlier feature table.");
    }
    if (!tablesAfterDown.includes("storefront_contacts")) {
      throw new Error("Scratch bundle down removed storefront configuration from migration 013.");
    }
    if (tablesAfterDown.includes("pricing_automatic_offer_bundle_item")
      || await columnExists(pool, "sales_sale", "applied_automatic_offer_details")) {
      throw new Error("Scratch bundle down left migration 014 storage behind.");
    }
    if (tablesAfterDown.includes("pricing_coupon") || tablesAfterDown.includes("pricing_coupon_usage")
      || await columnExists(pool, "sales_sale", "coupon_discount_piasters")) {
      throw new Error("Scratch coupon down left migration 015 storage behind.");
    }

    if (tablesAfterDown.includes("recording_correction") || tablesAfterDown.includes("recording_sale_unit_value")
      || await columnExists(pool, "returns_return_unit", "source_recording_sale_unit_id")) {
      throw new Error("Scratch corrections down left migration 016 storage behind.");
    }

    const reapplied = await applyMigrations(pool);
    const afterReapply = await listAppliedMigrations(pool);
    if (reapplied.join(",") !== currentBatch.join(",") || afterReapply.join(",") !== afterApply.join(",")) {
      throw new Error("Scratch reapply did not restore the latest migration.");
    }
    const tablesAfterReapply = await tableNames(pool);
    await assertCurrentBatchStorage(pool, true);
    if (!tablesAfterReapply.includes("sales_pos_snapshot") || !tablesAfterReapply.includes("sales_sale")) {
      throw new Error("Scratch reapply did not restore snapshot and sales tables.");
    }
    if (!tablesAfterReapply.includes("pricing_automatic_offer_bundle_item")
      || !(await columnExists(pool, "sales_sale", "applied_automatic_offer_details"))) {
      throw new Error("Scratch reapply did not restore bundle pricing storage.");
    }
    if (!tablesAfterReapply.includes("pricing_coupon") || !tablesAfterReapply.includes("pricing_coupon_usage")
      || !(await columnExists(pool, "sales_sale", "coupon_discount_piasters"))) {
      throw new Error("Scratch reapply did not restore coupon storage.");
    }
    if (!(await columnExists(pool, "sales_sale_unit", "quantity"))) {
      throw new Error("Scratch reapply did not preserve the sale-unit quantity column from migration 008.");
    }
    if (
      !tablesAfterReapply.includes("inventory_stock_clock") ||
      !(await columnExists(pool, "sales_sale", "recovered_by_staff_id")) ||
      !(await columnExists(pool, "sales_sale", "recovered_at")) ||
      !(await constraintExists(pool, "sales_sale_recovery_pair"))
    ) {
      throw new Error("Scratch reapply did not restore the stock clock and sale recovery schema from migration 009.");
    }
    if (!tablesAfterReapply.includes("expense_record") || !tablesAfterReapply.includes("expense_change") || !tablesAfterReapply.includes("expense_operation")) {
      throw new Error("Scratch reapply did not restore expense tables.");
    }
    if (!tablesAfterReapply.includes("pricing_automatic_offer") || !tablesAfterReapply.includes("returns_return") || !tablesAfterReapply.includes("storefront_contacts")) {
      throw new Error("Scratch reapply did not restore migrations 011 through 013.");
    }

    if (!tablesAfterReapply.includes("recording_correction") || !tablesAfterReapply.includes("recording_sale_unit_value")
      || !(await columnExists(pool, "returns_return_unit", "source_recording_sale_unit_id"))) {
      throw new Error("Scratch reapply did not restore recording correction storage.");
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
    await assertCurrentBatchStorage(pool, false);
    if (empty.includes("user") || empty.includes("catalog_product") || empty.includes("inventory_batch") || empty.includes("receiving_receipt") || empty.includes("sales_sale") || empty.includes("sales_pos_snapshot") || empty.includes("expense_record") || empty.includes("pricing_automatic_offer") || empty.includes("returns_return") || empty.includes("storefront_contacts")) {
      throw new Error("Scratch full down left feature tables.");
    }

    const restored = await applyMigrations(pool);
    if (restored.join(",") !== first.join(",")) {
      throw new Error("Scratch full reapply did not restore every migration.");
    }
    await assertCurrentBatchStorage(pool, true);

    await expectFailedMigrationRollsBack(pool);

    console.log(
      `scratch migration apply/down/reapply ok: applied=${first.join(",")} reverted=${[...currentBatch].reverse().join(",")} reapplied=${reapplied.join(",")}`,
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

async function columnExists(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function assertCurrentBatchStorage(pool: Pool, present: boolean): Promise<void> {
  const tables = await tableNames(pool);
  for (const table of [
    "returns_exchange", "returns_exchange_quote", "receiving_correction", "receiving_correction_line",
    "inventory_known_till", "inventory_count_coordination", "inventory_count_coordination_device",
    "inventory_stock_correction", "inventory_stock_correction_batch",
    "inventory_stock_reconciliation", "inventory_stock_reconciliation_batch",
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
  ]) {
    if (tables.includes(table) !== present) throw new Error(`Expected ${table} presence=${present}.`);
  }
  for (const [table, column] of [
    ["sales_pos_snapshot", "pricing_version"],
    ["sales_pos_snapshot", "coupon_accounted_operations"],
    ["sales_sale", "coupon_usage_actual_count"],
    ["sales_sale", "cash_received_piasters"],
    ["sales_sale", "exchange_credit_applied_piasters"],
    ["inventory_batch", "effective_received_quantity"],
    ["inventory_batch", "effective_unit_cost_piasters"],
    ["returns_return", "source_online_order_id"],
    ["returns_return_line", "source_online_order_line_id"],
    ["returns_return_unit", "source_online_order_line_id"],
    ["recording_correction", "effective_refund_merchandise_piasters"],
  ] as const) {
    if (await columnExists(pool, table, column) !== present) {
      throw new Error(`Expected ${table}.${column} presence=${present}.`);
    }
  }
  for (const constraint of ["returns_return_source_exact", "returns_return_line_source_exact"]) {
    if (await constraintExists(pool, constraint) !== present) {
      throw new Error(`Expected ${constraint} presence=${present}.`);
    }
  }
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

async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}
