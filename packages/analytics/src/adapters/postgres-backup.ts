import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

export function createPostgresAnalyticsBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const rows = await queryable.query<Record<string, unknown>>(
        "SELECT * FROM public_analytics_event ORDER BY recorded_at, operation_id",
      );
      return [{ tableName: "public_analytics_event", rows: rows.rows }];
    },
  };
}
