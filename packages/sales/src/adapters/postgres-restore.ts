import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "sales_pos_snapshot",
  "sales_pos_snapshot_price",
  "sales_sale",
  "sales_sale_line",
  "sales_sale_unit",
  "sales_restore_deferred_completion",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresSalesRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      await queryable.query(`DELETE FROM ${restoreTable(tableName)}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      await insertRestoreRows(queryable, table, rows);
      if (table === "sales_sale_unit") await assertSaleUnitTotals(queryable);
      return rows.length;
    },
    async restoreReferenceSequence(sequence: { lastValue: string; isCalled: boolean }): Promise<void> {
      if (!/^(0|[1-9]\d*)$/.test(sequence.lastValue)) throw restoreDataError("Invalid physical-sale reference sequence.");
      const highest = await queryable.query<{ max_number: string }>(
        `SELECT COALESCE(MAX(substring(reference FROM '^POS-([0-9]+)$')::bigint), 0)::text AS max_number
         FROM sales_sale`,
      );
      const recordedNext = BigInt(sequence.lastValue) + (sequence.isCalled ? 1n : 0n);
      const referencedNext = BigInt(highest.rows[0]?.max_number ?? "0") + 1n;
      const next = recordedNext > referencedNext ? recordedNext : referencedNext;
      await queryable.query("SELECT setval('sales_sale_reference_number_seq', $1::bigint, false)", [next.toString()]);
    },
    // A pending till operation is safe for restore when the server holds it as an applied sale
    // or as a retained completed sale awaiting manager recovery.
    async listRestoreCustodyProofs(operationIds: string[]) {
      const unique = [...new Set(operationIds)].filter((value) => UUID_PATTERN.test(value));
      if (unique.length === 0) return [];
      const result = await queryable.query<{
        operation_id: string;
        sale_id: string;
        payload_fingerprint: string;
        custody: "applied" | "deferred";
      }>(
        `SELECT DISTINCT ON (operation_id) operation_id, sale_id, payload_fingerprint, custody
         FROM (
           SELECT operation_id, id AS sale_id, payload_fingerprint, 'applied'::text AS custody, 0 AS priority
           FROM sales_sale
           WHERE physically_completed = TRUE AND operation_id = ANY($1::uuid[])
           UNION ALL
           SELECT operation_id, sale_id, payload_fingerprint, 'deferred'::text AS custody, 1 AS priority
           FROM sales_restore_deferred_completion
           WHERE operation_id = ANY($1::uuid[])
         ) proof
         ORDER BY operation_id, priority`,
        [unique],
      );
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        saleId: row.sale_id,
        contentDigest: row.payload_fingerprint,
        custody: row.custody,
      }));
    },
  };
}

async function assertSaleUnitTotals(queryable: Queryable): Promise<void> {
  const invalid = await queryable.query<{ id: string }>(
    `SELECT line.id
     FROM sales_sale_line line
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(unit.quantity), 0) AS quantity,
         COALESCE(SUM(unit.paid_piasters::bigint * unit.quantity), 0) AS paid_piasters,
         BOOL_AND(unit.sale_id = line.sale_id) AS same_sale
       FROM sales_sale_unit unit WHERE unit.line_id = line.id
     ) totals ON TRUE
     WHERE totals.quantity <> line.quantity
       OR totals.paid_piasters <> line.paid_piasters
       OR totals.same_sale IS DISTINCT FROM TRUE
     LIMIT 1`,
  );
  if (invalid.rows[0]) throw restoreDataError(`Restored sale line ${invalid.rows[0].id} has incoherent paid-unit totals.`);
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved sales restore table: ${tableName}`);
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
