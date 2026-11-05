import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "customer",
  "sales_pos_snapshot",
  "sales_pos_snapshot_price",
  "sales_sale",
  "sales_sale_line",
  "sales_sale_unit",
  "sales_restore_deferred_completion",
  "sales_receipt_registration",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const BIGINT_MAX = 9223372036854775807n;

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
      const storage = await queryable.query<{ has_counter: boolean }>(
        "SELECT to_regclass('sales_pos_reference_counter') IS NOT NULL AS has_counter",
      );
      if (storage.rows[0]?.has_counter) {
        await queryable.query(
          `UPDATE sales_pos_reference_counter
           SET last_number = GREATEST(last_number, $1::bigint)
           WHERE singleton`,
          [(next - 1n).toString()],
        );
        return;
      }
      await queryable.query("SELECT setval('sales_sale_reference_number_seq', $1::bigint, false)", [next.toString()]);
    },
    // Exact pre-036 sale columns, then receipt_identity: null. Does not default any other missing field.
    async upgradeReceiptlessRestoreRows(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
      const columns = await queryable.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sales_sale'",
      );
      if (!columns.rows.some((row) => row.column_name === "receipt_identity")) {
        throw restoreDataError("Receipt identity schema is missing.");
      }
      const expected = columns.rows.map((row) => row.column_name).filter((name) => name !== "receipt_identity").sort();
      return rows.map((row) => {
        if (!isRecord(row)) throw restoreDataError("Legacy sale row does not match the pre-receipt profile.");
        const keys = Object.keys(row).sort();
        if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
          throw restoreDataError("Legacy sale row does not match the pre-receipt profile.");
        }
        return { ...row, receipt_identity: null };
      });
    },
    // Assigned identities must bind to a retained registration. Conflict identities are left unchanged.
    async assertAssignedReceiptIdentities(input: {
      registrations: Array<Record<string, unknown>>;
      sales: Array<Record<string, unknown>>;
    }): Promise<void> {
      const registrations = registrationBindings(input.registrations);
      const references = new Set<string>();
      for (const sale of input.sales) {
        if (!isRecord(sale)) throw restoreDataError("Invalid restored sale row.");
        if (!Object.prototype.hasOwnProperty.call(sale, "receipt_identity")) {
          throw restoreDataError("Restored sale row is missing receipt_identity.");
        }
        assertSaleReceiptIdentity(sale.receipt_identity, registrations, references);
      }
    },
    // Call after retained registry rows are inserted. Uses BigInt and the current prefix sequence.
    // PostgreSQL setval is not rolled back, so this never moves the next prefix backward.
    // Independent of sales_sale_reference_number_seq.
    async restoreReceiptPrefixSequence(sequence: { lastValue: string; isCalled: boolean }): Promise<void> {
      if (!isRecord(sequence) || Object.keys(sequence).length !== 2) throw restoreDataError("Invalid receipt prefix sequence.");
      const recordedNext = nextPrefixAllocation(sequence.lastValue, sequence.isCalled);
      const live = await queryable.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text AS last_value, is_called FROM sales_receipt_prefix_seq",
      );
      const current = live.rows[0];
      if (!current) throw restoreDataError("Receipt prefix sequence is missing.");
      const liveNext = nextPrefixAllocation(current.last_value, current.is_called);
      const prefixes = await queryable.query<{ prefix: string }>("SELECT prefix FROM sales_receipt_registration");
      let registryNext = 1n;
      for (const row of prefixes.rows) {
        const candidate = prefixSuccessor(row.prefix);
        if (candidate > registryNext) registryNext = candidate;
      }
      let chosen = recordedNext;
      if (liveNext > chosen) chosen = liveNext;
      if (registryNext > chosen) chosen = registryNext;
      if (chosen > BIGINT_MAX) throw restoreDataError("Receipt prefix sequence is exhausted.");
      await queryable.query("SELECT setval('sales_receipt_prefix_seq', $1::bigint, false)", [chosen.toString()]);
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

function registrationBindings(rows: Array<Record<string, unknown>>): Map<string, { deviceId: string; prefix: string }> {
  const byId = new Map<string, { deviceId: string; prefix: string }>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.device_id !== "string" || typeof row.prefix !== "string"
      || !RECEIPT_UUID_PATTERN.test(row.id) || !RECEIPT_UUID_PATTERN.test(row.device_id) || !isCanonicalBigint(row.prefix, 1n)) {
      throw restoreDataError("Invalid receipt registration binding.");
    }
    const id = row.id.toLowerCase();
    const existing = byId.get(id);
    if (existing && (existing.deviceId.toLowerCase() !== row.device_id.toLowerCase() || existing.prefix !== row.prefix)) {
      throw restoreDataError("Invalid receipt registration binding.");
    }
    if (!existing) byId.set(id, { deviceId: row.device_id, prefix: row.prefix });
  }
  return byId;
}

function assertSaleReceiptIdentity(
  value: unknown,
  registrations: Map<string, { deviceId: string; prefix: string }>,
  references: Set<string>,
): void {
  if (value === null) return;
  if (!isRecord(value) || (value.status !== "assigned" && value.status !== "conflict")) {
    throw restoreDataError("Invalid receipt identity in restored sale.");
  }
  if (value.status === "conflict") {
    if (Object.prototype.hasOwnProperty.call(value, "reference") && !isAllowedConflictReference(value.reference)) {
      throw restoreDataError("Invalid receipt identity in restored sale.");
    }
    return;
  }
  if (typeof value.registrationId !== "string" || !RECEIPT_UUID_PATTERN.test(value.registrationId)
    || typeof value.deviceId !== "string" || !RECEIPT_UUID_PATTERN.test(value.deviceId)
    || typeof value.prefix !== "string" || !isCanonicalBigint(value.prefix, 1n)
    || typeof value.sequence !== "string" || !isCanonicalDecimal(value.sequence)
    || value.reference !== canonicalReceiptReference(value.prefix, value.sequence)) {
    throw restoreDataError("Invalid receipt identity in restored sale.");
  }
  const registration = registrations.get(value.registrationId.toLowerCase());
  if (!registration || registration.deviceId.toLowerCase() !== value.deviceId.toLowerCase() || registration.prefix !== value.prefix) {
    throw restoreDataError("Assigned receipt identity does not match a retained registration.");
  }
  if (typeof value.reference !== "string" || references.has(value.reference)) {
    throw restoreDataError("Assigned receipt reference is duplicated.");
  }
  references.add(value.reference);
}

function nextPrefixAllocation(lastValue: unknown, isCalled: unknown): bigint {
  if (typeof lastValue !== "string" || typeof isCalled !== "boolean" || !isCanonicalBigint(lastValue, 1n)) {
    throw restoreDataError("Invalid receipt prefix sequence.");
  }
  const last = BigInt(lastValue);
  if (!isCalled) return last;
  if (last === BIGINT_MAX) throw restoreDataError("Receipt prefix sequence is exhausted.");
  return last + 1n;
}

function prefixSuccessor(prefix: string): bigint {
  if (!isCanonicalBigint(prefix, 1n)) throw restoreDataError("Invalid receipt registration prefix.");
  const value = BigInt(prefix);
  if (value === BIGINT_MAX) throw restoreDataError("Receipt prefix sequence is exhausted.");
  return value + 1n;
}

function canonicalReceiptReference(prefix: string, sequence: string): string {
  const prefixText = prefix.length >= 3 ? prefix : prefix.padStart(3, "0");
  const sequenceText = sequence.length >= 6 ? sequence : sequence.padStart(6, "0");
  return `BRV-${prefixText}-${sequenceText}`;
}

function isCanonicalDecimal(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

function isCanonicalReceiptReference(value: string): boolean {
  const match = /^BRV-(\d{3,})-(\d{6,})$/.exec(value);
  const prefix = match?.[1]?.replace(/^0+/, "");
  const sequence = match?.[2]?.replace(/^0+/, "");
  if (!prefix || !sequence || !isCanonicalDecimal(prefix) || !isCanonicalDecimal(sequence)) return false;
  return value === canonicalReceiptReference(prefix, sequence);
}

function isCanonicalBigint(value: string, min: bigint): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= min && parsed <= BIGINT_MAX;
}

function isAllowedConflictReference(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) return false;
  // A canonical printed claim is kept at its full length. Other text stays within the sanitized 80-character claim.
  if (isCanonicalReceiptReference(value)) return true;
  const length = [...value].length;
  return length >= 1 && length <= 80;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Marks archive or staged data that cannot be loaded, as opposed to a server fault.
function restoreDataError(message: string) {
  return Object.assign(new Error(message), { code: "RESTORE_DATA_INVALID" });
}
