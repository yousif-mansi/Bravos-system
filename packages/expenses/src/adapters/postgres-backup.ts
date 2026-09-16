import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "expense_category", orderBy: "id" },
  { tableName: "expense_operation", orderBy: "operation_id" },
  { tableName: "expense_record", orderBy: "id" },
  { tableName: "expense_change", orderBy: "expense_id, result_revision, id" },
];

export function createPostgresExpensesBackupReader(queryable: Queryable) {
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
