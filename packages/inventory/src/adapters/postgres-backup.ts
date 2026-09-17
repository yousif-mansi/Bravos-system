import type { BackupKnownUnsynchronizedTillDto, BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES = [
  { tableName: "inventory_settings", orderBy: "id" },
  { tableName: "inventory_variant_setting", orderBy: "variant_id" },
  { tableName: "inventory_stock_clock", orderBy: "id" },
  { tableName: "inventory_operation", orderBy: "recorded_at, id" },
  { tableName: "inventory_batch", orderBy: "recorded_at, id" },
  { tableName: "inventory_movement", orderBy: "recorded_at, id" },
  { tableName: "inventory_allocation", orderBy: "recorded_at, id" },
  { tableName: "inventory_discrepancy", orderBy: "recorded_at, id" },
  { tableName: "inventory_known_till", orderBy: "device_id" },
  { tableName: "inventory_count_coordination", orderBy: "boundary_at, id" },
  { tableName: "inventory_count_coordination_device", orderBy: "coordination_id, device_id" },
  { tableName: "inventory_stock_correction", orderBy: "changed_at, id" },
  { tableName: "inventory_stock_correction_batch", orderBy: "correction_id, batch_id, direction" },
  { tableName: "inventory_stock_reconciliation", orderBy: "resolved_at, id" },
  { tableName: "inventory_stock_reconciliation_batch", orderBy: "reconciliation_id, batch_id, direction" },
  { tableName: "inventory_protected_order", orderBy: "order_id" },
  { tableName: "inventory_protected_order_allocation", orderBy: "protected_order_id, allocation_id" },
  { tableName: "inventory_order_disposition", orderBy: "recorded_at, operation_id" },
  { tableName: "inventory_order_disposition_allocation", orderBy: "recorded_at, id" },
  { tableName: "inventory_delivered_return_allocation_effect", orderBy: "recorded_at, id" },
] as const;

type UnsynchronizedTillRow = {
  device_id: string;
  staff_id: string;
  latest_snapshot_id: string;
  latest_snapshot_at: Date | string;
  stock_version: string | null;
  pending_operation_ids: string[];
};

export function createPostgresInventoryBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const result: BackupTableSnapshot[] = [];
      for (const table of TABLES) {
        // A known till's restore generation belongs to the destination database, so it is not archived.
        const columns = table.tableName === "inventory_known_till"
          ? "device_id, staff_id, latest_snapshot_id, latest_snapshot_at, stock_version, pending_operation_ids, included_operation_ids, synchronization_complete"
          : "*";
        const rows = await queryable.query<Record<string, unknown>>(
          `SELECT ${columns} FROM ${table.tableName} ORDER BY ${table.orderBy}`,
        );
        result.push({ tableName: table.tableName, rows: rows.rows });
      }
      return result;
    },
    async readStockVersion(): Promise<string> {
      const rows = await queryable.query<{ version: string }>("SELECT version::text FROM inventory_stock_clock WHERE id = TRUE");
      const version = rows.rows[0]?.version;
      if (version === undefined) throw new Error("Inventory stock clock is missing.");
      return version;
    },
    async listKnownUnsynchronizedTills(): Promise<BackupKnownUnsynchronizedTillDto[]> {
      const rows = await queryable.query<UnsynchronizedTillRow>(`
        SELECT device_id, staff_id, latest_snapshot_id,
          to_char(latest_snapshot_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS latest_snapshot_at,
          stock_version::text, pending_operation_ids
        FROM inventory_known_till
        WHERE NOT synchronization_complete OR cardinality(pending_operation_ids) > 0
        ORDER BY device_id
      `);
      return rows.rows.map((row) => ({
        deviceId: row.device_id,
        staffId: row.staff_id,
        latestSnapshotId: row.latest_snapshot_id,
        latestSnapshotAt: typeof row.latest_snapshot_at === "string"
          ? new Date(row.latest_snapshot_at).toISOString()
          : row.latest_snapshot_at.toISOString(),
        stockVersion: row.stock_version,
        pendingOperationIds: row.pending_operation_ids,
        pendingOperationCount: row.pending_operation_ids.length,
      }));
    },
  };
}
