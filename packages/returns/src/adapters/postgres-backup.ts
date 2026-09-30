import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "returns_return", orderBy: "id" },
  { tableName: "returns_return_line", orderBy: "return_id, line_index, id" },
  { tableName: "returns_return_unit", orderBy: "return_line_id, start_offset, id" },
  { tableName: "returns_batch_restoration", orderBy: "return_id, id" },
  { tableName: "returns_refund_event", orderBy: "return_id, recorded_at, operation_id" },
  { tableName: "returns_exchange_quote", orderBy: "id" },
  { tableName: "returns_exchange", orderBy: "id" },
];

export function createPostgresReturnsBackupReader(queryable: Queryable) {
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
        "SELECT last_value::text, is_called FROM returns_return_reference_number_seq",
      );
      const sequence = rows.rows[0];
      if (!sequence) throw new Error("Return reference sequence is missing.");
      return { lastValue: sequence.last_value, isCalled: sequence.is_called };
    },
  };
}
