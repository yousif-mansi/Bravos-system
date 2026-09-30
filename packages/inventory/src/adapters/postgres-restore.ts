import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "inventory_settings",
  "inventory_variant_setting",
  "inventory_stock_clock",
  "inventory_operation",
  "inventory_batch",
  "inventory_batch_balance",
  "inventory_movement",
  "inventory_allocation",
  "inventory_discrepancy",
  "inventory_known_till",
  "inventory_count_coordination",
  "inventory_count_coordination_device",
  "inventory_stock_correction",
  "inventory_stock_correction_batch",
  "inventory_stock_reconciliation",
  "inventory_stock_reconciliation_batch",
  "inventory_protected_order",
  "inventory_protected_order_allocation",
  "inventory_order_disposition",
  "inventory_order_disposition_allocation",
  "inventory_delivered_return_allocation_effect",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

type KnownTillRow = {
  device_id: string;
  staff_id: string;
  latest_snapshot_id: string;
  latest_snapshot_at: Date;
  stock_version: string | null;
  pending_operation_ids: string[];
  synchronization_complete: boolean;
  restore_generation: string;
};

export function createPostgresInventoryRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      await queryable.query(`DELETE FROM ${restoreTable(tableName)}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      // Archived known tills never carry the destination generation; activation assigns it.
      const loaded = table === "inventory_known_till"
        ? rows.map((row) => ("restore_generation" in row ? row : { ...row, restore_generation: "0" }))
        : rows;
      await insertRestoreRows(queryable, table, loaded);
      if ((table === "inventory_settings" || table === "inventory_stock_clock") && rows.length !== 1) {
        throw restoreDataError(`A restore must contain exactly one ${table} row.`);
      }
      if (table === "inventory_movement" || table === "inventory_allocation") await assertBatchVariantLinks(queryable, table);
      return rows.length;
    },
    async listKnownTillsForRestore() {
      const result = await queryable.query<KnownTillRow>(
        `SELECT device_id, staff_id, latest_snapshot_id, latest_snapshot_at, stock_version::text,
           pending_operation_ids, synchronization_complete, restore_generation::text
         FROM inventory_known_till
         ORDER BY device_id`,
      );
      return result.rows.map((row) => ({
        deviceId: row.device_id,
        staffId: row.staff_id,
        latestSnapshotId: row.latest_snapshot_id,
        latestSnapshotAt: row.latest_snapshot_at,
        stockVersion: row.stock_version,
        pendingOperationIds: row.pending_operation_ids,
        synchronizationComplete: row.synchronization_complete,
        restoreGeneration: Number(row.restore_generation),
      }));
    },
    // Every known till must report again under the activated generation before it is trusted.
    async assignRestoreGeneration(generation: number): Promise<void> {
      await queryable.query(
        "UPDATE inventory_known_till SET restore_generation = $1, synchronization_complete = FALSE",
        [generation],
      );
    },
  };
}

async function assertBatchVariantLinks(queryable: Queryable, table: "inventory_movement" | "inventory_allocation") {
  const invalid = await queryable.query<{ id: string }>(
    `SELECT fact.id FROM ${table} fact
     JOIN inventory_batch batch ON batch.id = fact.batch_id
     WHERE fact.variant_id <> batch.variant_id LIMIT 1`,
  );
  if (invalid.rows[0]) throw restoreDataError(`Restored ${table} ${invalid.rows[0].id} uses a batch from another variant.`);
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved inventory restore table: ${tableName}`);
  return table;
}

// Rows are loaded through jsonb_populate_recordset so PostgreSQL converts each value with the
// column's own type, including arrays, JSON documents, big integers and timestamp text.
async function insertRestoreRows(queryable: Queryable, table: RestoreTableName, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const columns = await queryable.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    [table],
  );
  const expected = columns.rows.map((row) => row.column_name).sort();
  for (const row of rows) {
    const keys = Object.keys(row).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw restoreDataError(`Restore row for ${table} does not match the table columns.`);
    }
  }
  for (let offset = 0; offset < rows.length; offset += 500) {
    await queryable.query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
      [JSON.stringify(rows.slice(offset, offset + 500))],
    );
  }
}

// Marks archive or staged data that cannot be loaded, as opposed to a server fault.
function restoreDataError(message: string) {
  return Object.assign(new Error(message), { code: "RESTORE_DATA_INVALID" });
}
