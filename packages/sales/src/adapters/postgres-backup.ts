import { OPERATIONAL_STOCK_SCHEMA, type BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const BASE_TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "sales_pos_snapshot", orderBy: "id" },
  { tableName: "sales_pos_snapshot_price", orderBy: "snapshot_id, variant_id" },
  { tableName: "sales_sale", orderBy: "id" },
  { tableName: "sales_sale_line", orderBy: "sale_id, line_index, id" },
  { tableName: "sales_sale_unit", orderBy: "line_id, unit_index, id" },
  { tableName: "sales_restore_deferred_completion", orderBy: "retained_at, operation_id" },
];

const REGISTRY_TABLE = { tableName: "sales_receipt_registration", orderBy: "id" } as const;
const CUSTOMER_TABLE = { tableName: "customer", orderBy: "created_at, id" } as const;

const REGISTRY_COLUMNS = ["created_at", "created_by_staff_id", "device_id", "id", "prefix", "restore_generation"];

const BIGINT_MAX = 9223372036854775807n;

const RECEIPT_NUMBERING_SCHEMA = "036_receipt_numbering.sql";

// Same explicit names as the backup package's KNOWN_BACKUP_SCHEMAS. Sales does not import that package.
const HISTORICAL_BACKUP_SCHEMAS = new Set([
  "028_aggregate_analytics.sql",
  "029_restore.sql",
  "030_branch_inventory.sql",
  "031_sale_payments.sql",
  "032_catalog_online_variants.sql",
  "033_human_references.sql",
  "034_order_recognition_branch.sql",
  "035_return_reason.sql",
]);

export function createPostgresSalesBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const profile = await backupProfile(queryable);
      const receiptProfile = profile === "receipt-numbering" || profile === "operational";
      await assertSaleReceiptColumn(queryable, receiptProfile);
      if (receiptProfile) await assertRegistryColumns(queryable);
      const tables = profile === "operational"
        ? [...BASE_TABLES, REGISTRY_TABLE, CUSTOMER_TABLE]
        : profile === "receipt-numbering"
          ? [...BASE_TABLES, REGISTRY_TABLE]
          : BASE_TABLES;
      const result: BackupTableSnapshot[] = [];
      for (const table of tables) {
        const where = "where" in table && table.where ? ` WHERE ${table.where}` : "";
        const rows = await queryable.query<Record<string, unknown>>(
          `SELECT * FROM ${table.tableName}${where} ORDER BY ${table.orderBy}`,
        );
        if (table.tableName === "sales_sale") assertSaleIdentityKeys(rows.rows, receiptProfile);
        if (table.tableName === "sales_receipt_registration") assertRegistryRowKeys(rows.rows);
        result.push({ tableName: table.tableName, rows: rows.rows });
      }
      return result;
    },
    async readReferenceSequence(): Promise<{ lastValue: string; isCalled: boolean }> {
      const rows = await queryable.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text, is_called FROM sales_sale_reference_number_seq",
      );
      const sequence = rows.rows[0];
      if (!sequence) throw new Error("Physical-sale reference sequence is missing.");
      return { lastValue: sequence.last_value, isCalled: sequence.is_called };
    },
    async readReceiptPrefixSequence(): Promise<{ lastValue: string; isCalled: boolean }> {
      const rows = await queryable.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text AS last_value, is_called FROM sales_receipt_prefix_seq",
      );
      const sequence = rows.rows[0];
      if (!sequence || typeof sequence.last_value !== "string" || typeof sequence.is_called !== "boolean") {
        throw new Error("Receipt prefix sequence is missing.");
      }
      if (!isCanonicalBigint(sequence.last_value, 1n)) throw new Error("Invalid receipt prefix sequence.");
      return { lastValue: sequence.last_value, isCalled: sequence.is_called };
    },
  };
}

// Older named profiles must not be queried for the registry or sales_receipt_prefix_seq.
async function backupProfile(queryable: Queryable): Promise<"operational" | "receipt-numbering" | "historical"> {
  const rows = await queryable.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1");
  const schemaVersion = rows.rows[0]?.id;
  if (schemaVersion === OPERATIONAL_STOCK_SCHEMA) return "operational";
  if (schemaVersion === RECEIPT_NUMBERING_SCHEMA) return "receipt-numbering";
  if (schemaVersion && HISTORICAL_BACKUP_SCHEMAS.has(schemaVersion)) return "historical";
  throw new Error(`Unsupported backup schema profile: ${schemaVersion ?? "missing"}`);
}

async function assertSaleReceiptColumn(queryable: Queryable, receiptNumbering: boolean): Promise<void> {
  const columns = await columnNames(queryable, "sales_sale");
  const present = columns.includes("receipt_identity");
  if (receiptNumbering && !present) throw new Error("Receipt numbering sale export is missing receipt_identity.");
  if (!receiptNumbering && present) throw new Error("Historical backup must not export receipt_identity.");
}

async function assertRegistryColumns(queryable: Queryable): Promise<void> {
  const columns = await columnNames(queryable, "sales_receipt_registration");
  if (columns.length === 0) throw new Error("Receipt numbering backup is missing sales_receipt_registration.");
  if (!sameColumns(columns, REGISTRY_COLUMNS)) {
    throw new Error("Receipt registration columns do not match the receipt numbering profile.");
  }
}

async function columnNames(queryable: Queryable, tableName: "sales_sale" | "sales_receipt_registration"): Promise<string[]> {
  const rows = await queryable.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${tableName}'`,
  );
  return rows.rows.map((row) => row.column_name).sort();
}

function assertSaleIdentityKeys(rows: Array<Record<string, unknown>>, receiptNumbering: boolean): void {
  for (const row of rows) {
    const present = Object.prototype.hasOwnProperty.call(row, "receipt_identity");
    if (receiptNumbering && !present) throw new Error("Receipt numbering sale row is missing receipt_identity.");
    if (!receiptNumbering && present) throw new Error("Historical sale row must not contain receipt_identity.");
  }
}

function assertRegistryRowKeys(rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    const keys = Object.keys(row).sort();
    if (!sameColumns(keys, REGISTRY_COLUMNS)) throw new Error("Receipt registration row does not match the receipt numbering columns.");
  }
}

function sameColumns(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function isCanonicalBigint(value: string, min: bigint): boolean {
  if (!/^[1-9][0-9]*$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= min && parsed <= BIGINT_MAX;
}
