import pg, { type Pool, type PoolClient, type QueryResultRow } from "pg";
import { OPERATIONAL_STOCK_SCHEMA } from "@bravos/contracts";
import { KNOWN_BACKUP_SCHEMAS, RECEIPT_NUMBERING_SCHEMA } from "../application/backup.ts";
import type { BackupReaderSet, BackupSnapshotMetadata, BackupUnitOfWork } from "../application/ports.ts";

export type BackupQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

// Dates and timestamps stay as PostgreSQL text so business dates never shift by server time zone
// and timestamps keep their full microsecond precision.
const RAW_TEXT_TYPE_IDS = new Set([
  pg.types.builtins.DATE,
  pg.types.builtins.TIME,
  pg.types.builtins.TIMETZ,
  pg.types.builtins.TIMESTAMP,
  pg.types.builtins.TIMESTAMPTZ,
  pg.types.builtins.INTERVAL,
]);

const rawTemporalTypes = {
  getTypeParser(typeId: number, format?: "text" | "binary") {
    if (RAW_TEXT_TYPE_IDS.has(typeId)) return (value: string) => value;
    return format === "binary" ? pg.types.getTypeParser(typeId, "binary") : pg.types.getTypeParser(typeId, "text");
  },
};

export function createPostgresBackupUnitOfWork(
  pool: Pool,
  bindReaders: (queryable: BackupQueryable) => BackupReaderSet,
): BackupUnitOfWork {
  return {
    async run<T>(work: (transaction: { readers: BackupReaderSet; metadata(): Promise<BackupSnapshotMetadata> }) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          await client.query("SET LOCAL TIME ZONE 'UTC'");
          const readers = bindReaders(rawTemporalQueryable(client));
          const value = await work({
            readers,
            metadata: () => readMetadata(client, readers),
          });
          await client.query("COMMIT");
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        client.release();
      }
    },
  };
}

// Restore reads live rows inside its own activation transaction with the same value encoding.
export function createBackupQueryable(client: PoolClient): BackupQueryable {
  return rawTemporalQueryable(client);
}

function rawTemporalQueryable(client: PoolClient): BackupQueryable {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string) {
      const result = await client.query<T>({ text: sql, types: rawTemporalTypes });
      return { rows: result.rows };
    },
  };
}

async function readMetadata(client: PoolClient, readers: BackupReaderSet): Promise<BackupSnapshotMetadata> {
  const captured = await client.query<{ captured_at: Date }>("SELECT transaction_timestamp() AS captured_at");
  const migration = await client.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1");
  const stockVersion = await readers.inventory.readStockVersion();
  const onlineOrderReferenceSequence = await readers.onlineOrders.readReferenceSequence();
  const salesSaleReferenceSequence = await readers.sales.readReferenceSequence();
  const returnsReturnReferenceSequence = await readers.returns.readReferenceSequence();
  const sourceGeneration = await readers.restore.readRestoreGeneration();
  const capturedAt = captured.rows[0]?.captured_at;
  const schemaVersion = migration.rows[0]?.id;
  if (!capturedAt || !schemaVersion || !Number.isSafeInteger(sourceGeneration) || sourceGeneration < 0) {
    throw new Error("Backup metadata is incomplete.");
  }
  if (!(KNOWN_BACKUP_SCHEMAS as readonly string[]).includes(schemaVersion)) {
    throw new Error(`Unsupported backup schema profile: ${schemaVersion}`);
  }
  const metadata: BackupSnapshotMetadata = {
    capturedAt: capturedAt.toISOString(),
    schemaVersion,
    stockVersion,
    onlineOrderReferenceSequence,
    salesSaleReferenceSequence,
    returnsReturnReferenceSequence,
    sourceGeneration,
  };
  // Only the receipt-numbering profile owns this sequence. Older databases must not be queried for it.
  if (schemaVersion === RECEIPT_NUMBERING_SCHEMA || schemaVersion === OPERATIONAL_STOCK_SCHEMA) {
    metadata.salesReceiptPrefixSequence = await readers.sales.readReceiptPrefixSequence();
  }
  return metadata;
}
