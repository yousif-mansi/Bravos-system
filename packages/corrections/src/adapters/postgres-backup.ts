import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "recording_correction", orderBy: "id" },
  { tableName: "recording_sale_line_value", orderBy: "correction_id, sale_line_id" },
  { tableName: "recording_sale_unit_value", orderBy: "correction_id, sale_line_id, unit_index, id" },
  { tableName: "recording_return_line_value", orderBy: "correction_id, return_line_id" },
  { tableName: "recording_merchandise_fact", orderBy: "correction_id, id" },
  { tableName: "recording_online_return_unit_value", orderBy: "correction_id, return_line_id, source_online_order_unit_index, start_offset" },
];

export function createPostgresCorrectionsBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const result: BackupTableSnapshot[] = [];
      for (const table of TABLES) {
        const where = table.where ? ` WHERE ${table.where}` : "";
        const rows = await queryable.query<Record<string, unknown>>(
          `SELECT * FROM ${table.tableName}${where} ORDER BY ${table.orderBy}`,
        );
        result.push({ tableName: table.tableName, rows: rows.rows });
      }
      return result;
    },
  };
}
