import type { Pool, PoolClient } from "pg";
import type { InventoryTransaction } from "@bravos/inventory";
import type { ReceiptLineWrite, ReceiptRecord, ReceiptStore, ReceivingUnitOfWork } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

type ReceiptRow = {
  id: string;
  operation_id: string;
  receipt_date: string;
  received_by_staff_id: string;
  recorded_at: Date;
};

type LineRow = {
  id: string;
  receipt_id: string;
  variant_id: string;
  quantity: number;
  unit_cost_piasters: number;
  batch_id: string;
  line_index: number;
};

export function createPostgresReceiptStore(queryable: Queryable): ReceiptStore {
  return {
    async insert(input) {
      await queryable.query(
        `INSERT INTO receiving_receipt (
           id, operation_id, receipt_date, received_by_staff_id, recorded_at
         ) VALUES ($1, $2, $3::date, $4, $5)`,
        [input.id, input.operationId, input.receiptDate, input.receivedByStaffId, input.recordedAt],
      );
      for (const [index, line] of input.lines.entries()) {
        await queryable.query(
          `INSERT INTO receiving_receipt_line (
             id, receipt_id, variant_id, quantity, unit_cost_piasters, batch_id, line_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [line.id, input.id, line.variantId, line.quantity, line.unitCostPiasters, line.batchId, index],
        );
      }
      const loaded = await loadById(queryable, input.id);
      if (!loaded) {
        throw new Error("Created receiving receipt could not be loaded.");
      }
      return loaded;
    },

    getByOperationId: (operationId) => loadByOperationId(queryable, operationId),
    getById: (id) => loadById(queryable, id),
    async list() {
      const receipts = await queryable.query<ReceiptRow>(
        `SELECT id, operation_id, receipt_date::text AS receipt_date, received_by_staff_id, recorded_at
         FROM receiving_receipt
         ORDER BY recorded_at DESC, id DESC`,
      );
      const lines = await queryable.query<LineRow>(
        `SELECT id, receipt_id, variant_id, quantity, unit_cost_piasters, batch_id, line_index
         FROM receiving_receipt_line
         ORDER BY receipt_id, line_index`,
      );
      const grouped = new Map<string, ReceiptLineWrite[]>();
      for (const row of lines.rows) {
        const list = grouped.get(row.receipt_id) ?? [];
        list.push(toLine(row));
        grouped.set(row.receipt_id, list);
      }
      return receipts.rows.map((row) => toReceipt(row, grouped.get(row.id) ?? []));
    },
  };
}

export function createPostgresReceivingUnitOfWork(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
): ReceivingUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          receipts: createPostgresReceiptStore(client),
          inventory: inventoryFor(client),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function loadById(queryable: Queryable, id: string): Promise<ReceiptRecord | null> {
  const receipt = await queryable.query<ReceiptRow>(
    `SELECT id, operation_id, receipt_date::text AS receipt_date, received_by_staff_id, recorded_at
     FROM receiving_receipt
     WHERE id = $1`,
    [id],
  );
  const row = receipt.rows[0];
  if (!row) {
    return null;
  }
  return toReceipt(row, await loadLines(queryable, row.id));
}

async function loadByOperationId(queryable: Queryable, operationId: string): Promise<ReceiptRecord | null> {
  const receipt = await queryable.query<ReceiptRow>(
    `SELECT id, operation_id, receipt_date::text AS receipt_date, received_by_staff_id, recorded_at
     FROM receiving_receipt
     WHERE operation_id = $1`,
    [operationId],
  );
  const row = receipt.rows[0];
  if (!row) {
    return null;
  }
  return toReceipt(row, await loadLines(queryable, row.id));
}

async function loadLines(queryable: Queryable, receiptId: string): Promise<ReceiptLineWrite[]> {
  const result = await queryable.query<LineRow>(
    `SELECT id, receipt_id, variant_id, quantity, unit_cost_piasters, batch_id, line_index
     FROM receiving_receipt_line
     WHERE receipt_id = $1
     ORDER BY line_index`,
    [receiptId],
  );
  return result.rows.map(toLine);
}

function toLine(row: LineRow): ReceiptLineWrite {
  return {
    id: row.id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitCostPiasters: row.unit_cost_piasters,
    batchId: row.batch_id,
  };
}

function toReceipt(row: ReceiptRow, lines: ReceiptLineWrite[]): ReceiptRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    receiptDate: row.receipt_date,
    receivedByStaffId: row.received_by_staff_id,
    recordedAt: row.recorded_at,
    lines,
  };
}
