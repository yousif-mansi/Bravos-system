import { backupSchemaProfile, OPERATIONAL_STOCK_SCHEMA, type BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const SUPPLIER_TABLE: { tableName: string; orderBy: string; where?: string } = {
  tableName: "supplier",
  orderBy: "created_at, id",
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "receiving_receipt", orderBy: "id" },
  { tableName: "receiving_receipt_line", orderBy: "receipt_id, line_index, id" },
  { tableName: "receiving_correction", orderBy: "id" },
  { tableName: "receiving_correction_line", orderBy: "correction_id, receipt_line_id" },
];

export function createPostgresReceivingBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const latest = await queryable.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1");
      const tables = backupSchemaProfile(latest.rows[0]?.id) === OPERATIONAL_STOCK_SCHEMA ? [SUPPLIER_TABLE, ...TABLES] : TABLES;
      const result: BackupTableSnapshot[] = [];
      for (const table of tables) {
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
