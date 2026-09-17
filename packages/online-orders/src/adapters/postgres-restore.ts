import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "delivery_area",
  "online_order_settings",
  "online_checkout_quote",
  "online_order",
  "online_order_line",
  "online_order_agreement_quote",
  "online_order_operation",
  "online_order_contact_attempt",
  "online_order_agreed_revision",
  "online_order_confirmation",
  "online_order_unreachable_cancellation",
  "online_order_fulfillment_event",
  "online_order_failed_return_inspection",
  "online_order_failed_return_inspection_line",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

export function createPostgresOnlineOrdersRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      await queryable.query(`DELETE FROM ${restoreTable(tableName)}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      if (table === "online_order_settings" && rows.length !== 1) {
        throw restoreDataError("A restore must contain exactly one online-order settings row.");
      }
      await insertRestoreRows(queryable, table, rows);
      return rows.length;
    },
    // New references continue after both the recorded sequence and every restored order reference.
    async restoreReferenceSequence(sequence: { lastValue: string; isCalled: boolean }): Promise<void> {
      if (!/^(0|[1-9]\d*)$/.test(sequence.lastValue)) throw restoreDataError("Invalid online-order reference sequence.");
      const highest = await queryable.query<{ next_value: string }>(
        `SELECT COALESCE(MAX(substring(reference FROM '^BRV-([0-9]+)$')::bigint), 0)::text AS next_value
         FROM online_order`,
      );
      const recordedNext = BigInt(sequence.lastValue) + (sequence.isCalled ? 1n : 0n);
      const referencedNext = BigInt(highest.rows[0]?.next_value ?? "0") + 1n;
      const next = recordedNext > referencedNext ? recordedNext : referencedNext;
      await queryable.query("SELECT setval('online_order_reference_number_seq', $1::bigint, false)", [next.toString()]);
    },
  };
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved online-order restore table: ${tableName}`);
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
