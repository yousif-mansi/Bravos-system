import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

export function createPostgresIdentityBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const actors = await queryable.query<Record<string, unknown>>(`
        SELECT actor.id, actor.username, actor."displayUsername" AS display_username,
          CASE WHEN actor.role = 'manager' THEN 'manager' ELSE 'employee' END AS role,
          COALESCE(actor.banned, FALSE) AS disabled, actor."banReason" AS disable_reason,
          actor."banExpires" AS disable_expires_at, actor."createdAt" AS created_at,
          actor."updatedAt" AS updated_at
        FROM "user" actor
        INNER JOIN staff_profile profile ON profile.staff_id = actor.id
        ORDER BY actor.id
      `);
      const tables: Array<{ tableName: string; orderBy: string }> = [
        { tableName: "branch", orderBy: "id" },
        { tableName: "staff_profile", orderBy: "staff_id" },
        { tableName: "staff_branch_grant", orderBy: "staff_id, branch_id" },
        { tableName: "staff_operation", orderBy: "occurred_at, id" },
      ];
      const result: BackupTableSnapshot[] = [{ tableName: "identity_actor", rows: actors.rows }];
      for (const table of tables) {
        const rows = await queryable.query<Record<string, unknown>>(
          `SELECT * FROM ${table.tableName} ORDER BY ${table.orderBy}`,
        );
        result.push({ tableName: table.tableName, rows: rows.rows });
      }
      return result;
    },
  };
}
