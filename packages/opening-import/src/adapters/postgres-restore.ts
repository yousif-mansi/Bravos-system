import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "opening_import_preview",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

export function createPostgresOpeningImportRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      await queryable.query(`DELETE FROM ${restoreTable(tableName)}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      await insertRestoreRows(queryable, table, rows);
      if (rows.some((row) => row.status !== "accepted")) {
        throw restoreDataError("Only accepted opening-import previews can be restored.");
      }
      return rows.length;
    },
  };
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved opening import restore table: ${tableName}`);
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
