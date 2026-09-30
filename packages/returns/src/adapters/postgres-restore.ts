import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "returns_return",
  "returns_return_line",
  "returns_return_unit",
  "returns_batch_restoration",
  "returns_refund_event",
  "returns_exchange_quote",
  "returns_exchange",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

export function createPostgresReturnsRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      await queryable.query(`DELETE FROM ${restoreTable(tableName)}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      await insertRestoreRows(queryable, table, rows);
      return rows.length;
    },
    async restoreReferenceSequence(sequence: { lastValue: string; isCalled: boolean }): Promise<void> {
      if (!/^(0|[1-9]\d*)$/.test(sequence.lastValue)) throw restoreDataError("Invalid return reference sequence.");
      const highest = await queryable.query<{ max_number: string }>(
        `SELECT COALESCE(MAX(substring(reference FROM '^RET-([0-9]+)$')::bigint), 0)::text AS max_number
         FROM returns_return`,
      );
      const recordedNext = BigInt(sequence.lastValue) + (sequence.isCalled ? 1n : 0n);
      const referencedNext = BigInt(highest.rows[0]?.max_number ?? "0") + 1n;
      const next = recordedNext > referencedNext ? recordedNext : referencedNext;
      await queryable.query("SELECT setval('returns_return_reference_number_seq', $1::bigint, false)", [next.toString()]);
    },
  };
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved returns restore table: ${tableName}`);
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
