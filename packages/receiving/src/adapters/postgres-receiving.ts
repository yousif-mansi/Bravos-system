import type { Pool, PoolClient } from "pg";
import type { InventoryTransaction } from "@bravos/inventory";
import type {
  ReceiptCorrectionLineRecord,
  ReceiptCorrectionRecord,
  ReceiptCorrectionStore,
  ReceiptLineWrite,
  ReceiptRecord,
  ReceiptStore,
  ReceivingUnitOfWork,
} from "../application/ports.ts";

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

type CorrectionRow = {
  id: string;
  operation_id: string;
  receipt_id: string;
  revision: number;
  reason: string;
  changed_by_staff_id: string;
  changed_at: Date;
};

type CorrectionLineRow = {
  correction_id: string;
  receipt_line_id: string;
  previous_quantity: number;
  previous_unit_cost_piasters: number;
  effective_quantity: number;
  effective_unit_cost_piasters: number;
  remaining_quantity: number;
  allocated_quantity: number;
  quantity_delta: number;
  unit_cost_delta_piasters: number;
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
    getById: (id, lock = false) => loadById(queryable, id, lock),
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

export function createPostgresReceiptCorrectionStore(queryable: Queryable): ReceiptCorrectionStore {
  return {
    async insert(input) {
      await queryable.query(
        `INSERT INTO receiving_correction (
           id, operation_id, receipt_id, revision, reason, changed_by_staff_id, changed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.id, input.operationId, input.receiptId, input.revision, input.reason,
          input.changedByStaffId, input.changedAt],
      );
      for (const line of input.lines) {
        await queryable.query(
          `INSERT INTO receiving_correction_line (
             correction_id, receipt_line_id, previous_quantity, previous_unit_cost_piasters,
             effective_quantity, effective_unit_cost_piasters, remaining_quantity, allocated_quantity,
             quantity_delta, unit_cost_delta_piasters
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [input.id, line.lineId, line.previousQuantity, line.previousUnitCostPiasters,
            line.effectiveQuantity, line.effectiveUnitCostPiasters,
            line.remainingQuantity, line.allocatedQuantity,
            line.quantityDelta, line.unitCostDeltaPiasters],
        );
      }
      const loaded = await loadCorrectionByOperation(queryable, input.operationId);
      if (!loaded) throw new Error("Created receiving correction could not be loaded.");
      return loaded;
    },
    getByOperationId: (operationId) => loadCorrectionByOperation(queryable, operationId),
    listForReceipt: (receiptId) => loadCorrectionsForReceipt(queryable, receiptId),
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
        await client.query("SELECT restore_enter_business_write()");
        const result = await work({
          receipts: createPostgresReceiptStore(client),
          corrections: createPostgresReceiptCorrectionStore(client),
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

async function loadById(queryable: Queryable, id: string, lock = false): Promise<ReceiptRecord | null> {
  const receipt = await queryable.query<ReceiptRow>(
    `SELECT id, operation_id, receipt_date::text AS receipt_date, received_by_staff_id, recorded_at
     FROM receiving_receipt
     WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  const row = receipt.rows[0];
  if (!row) {
    return null;
  }
  return toReceipt(row, await loadLines(queryable, row.id));
}

async function loadCorrectionByOperation(
  queryable: Queryable,
  operationId: string,
): Promise<ReceiptCorrectionRecord | null> {
  const result = await queryable.query<CorrectionRow>(
    `SELECT id, operation_id, receipt_id, revision, reason, changed_by_staff_id, changed_at
     FROM receiving_correction WHERE operation_id = $1`,
    [operationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toCorrection(row, await loadCorrectionLines(queryable, [row.id]).then((lines) => lines.get(row.id) ?? []));
}

async function loadCorrectionsForReceipt(
  queryable: Queryable,
  receiptId: string,
): Promise<ReceiptCorrectionRecord[]> {
  const result = await queryable.query<CorrectionRow>(
    `SELECT id, operation_id, receipt_id, revision, reason, changed_by_staff_id, changed_at
     FROM receiving_correction WHERE receipt_id = $1 ORDER BY revision`,
    [receiptId],
  );
  const grouped = await loadCorrectionLines(queryable, result.rows.map((row) => row.id));
  return result.rows.map((row) => toCorrection(row, grouped.get(row.id) ?? []));
}

async function loadCorrectionLines(
  queryable: Queryable,
  correctionIds: string[],
): Promise<Map<string, ReceiptCorrectionLineRecord[]>> {
  if (correctionIds.length === 0) return new Map();
  const result = await queryable.query<CorrectionLineRow>(
    `SELECT correction_id, receipt_line_id, previous_quantity, previous_unit_cost_piasters,
            effective_quantity, effective_unit_cost_piasters, remaining_quantity, allocated_quantity,
            quantity_delta, unit_cost_delta_piasters
     FROM receiving_correction_line
     WHERE correction_id = ANY($1::uuid[])
     ORDER BY correction_id, receipt_line_id`,
    [correctionIds],
  );
  const grouped = new Map<string, ReceiptCorrectionLineRecord[]>();
  for (const row of result.rows) {
    const lines = grouped.get(row.correction_id) ?? [];
    lines.push({
      lineId: row.receipt_line_id,
      previousQuantity: row.previous_quantity,
      previousUnitCostPiasters: row.previous_unit_cost_piasters,
      effectiveQuantity: row.effective_quantity,
      effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
      remainingQuantity: row.remaining_quantity,
      allocatedQuantity: row.allocated_quantity,
      quantityDelta: row.quantity_delta,
      unitCostDeltaPiasters: row.unit_cost_delta_piasters,
    });
    grouped.set(row.correction_id, lines);
  }
  return grouped;
}

function toCorrection(row: CorrectionRow, lines: ReceiptCorrectionLineRecord[]): ReceiptCorrectionRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    receiptId: row.receipt_id,
    revision: row.revision,
    reason: row.reason,
    changedByStaffId: row.changed_by_staff_id,
    changedAt: row.changed_at,
    lines,
  };
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
