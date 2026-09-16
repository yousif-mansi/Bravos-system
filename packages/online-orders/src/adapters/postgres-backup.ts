import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "delivery_area", orderBy: "id" },
  { tableName: "online_checkout_quote", orderBy: "id" },
  { tableName: "online_order", orderBy: "id" },
  { tableName: "online_order_line", orderBy: "order_id, line_index, id" },
  { tableName: "online_order_agreement_quote", orderBy: "id" },
  { tableName: "online_order_operation", orderBy: "operation_id" },
  { tableName: "online_order_contact_attempt", orderBy: "id" },
  { tableName: "online_order_agreed_revision", orderBy: "order_id, version" },
  { tableName: "online_order_confirmation", orderBy: "order_id" },
  { tableName: "online_order_unreachable_cancellation", orderBy: "order_id" },
  { tableName: "online_order_settings", orderBy: "singleton" },
  { tableName: "online_order_fulfillment_event", orderBy: "id" },
  { tableName: "online_order_failed_return_inspection", orderBy: "id" },
  { tableName: "online_order_failed_return_inspection_line", orderBy: "inspection_id, line_index, confirmed_line_id" },
];

export function createPostgresOnlineOrdersBackupReader(queryable: Queryable) {
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
        "SELECT last_value::text, is_called FROM online_order_reference_number_seq",
      );
      const sequence = rows.rows[0];
      if (!sequence) throw new Error("Online order reference sequence is missing.");
      return { lastValue: sequence.last_value, isCalled: sequence.is_called };
    },
  };
}
