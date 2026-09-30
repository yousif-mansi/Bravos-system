import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "sales_pos_snapshot", orderBy: "id" },
  { tableName: "sales_pos_snapshot_price", orderBy: "snapshot_id, variant_id" },
  { tableName: "sales_sale", orderBy: "id" },
  { tableName: "sales_sale_line", orderBy: "sale_id, line_index, id" },
  { tableName: "sales_sale_unit", orderBy: "line_id, unit_index, id" },
  { tableName: "sales_restore_deferred_completion", orderBy: "retained_at, operation_id" },
];

export function createPostgresSalesBackupReader(queryable: Queryable) {
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
    async readReferenceSequence(): Promise<{ lastValue: string; isCalled: boolean }> {
      const rows = await queryable.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text, is_called FROM sales_sale_reference_number_seq",
      );
      const sequence = rows.rows[0];
      if (!sequence) throw new Error("Physical-sale reference sequence is missing.");
      return { lastValue: sequence.last_value, isCalled: sequence.is_called };
    },
  };
}
