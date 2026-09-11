import type { VariantLowStockDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import { InventoryValidationError, OperationConflictError } from "../domain/errors.ts";
import { fingerprintReceivePayload } from "../domain/fingerprint.ts";

import type {
  BatchRecord,
  ClaimedOperation,
  InventoryReadStore,
  InventoryTransaction,
  ReceivedBatchRecord,
  SettingsRecord,
} from "../application/ports.ts";

const FIFO_BATCH_ORDER_SQL = "recorded_at ASC, id ASC";

type Queryable = Pick<Pool, "query"> | PoolClient;

type OperationRow = {
  id: string;
  payload_fingerprint: string;
  recorded_at: Date;
};

type BatchRow = {
  id: string;
  variant_id: string;
  received_quantity: number;
  remaining_quantity: number;
  unit_cost_piasters: number;
  recorded_at: Date;
  source_receipt_id: string;
  receipt_date: string;
  source_line_id: string;
};

type SettingsRow = {
  low_stock_threshold: number;
};

export function createPostgresInventoryStore(queryable: Queryable): InventoryReadStore {
  return {
    quantitiesFor: (variantIds) => quantitiesFor(queryable, variantIds),
    referencedVariantIds: (variantIds) => referencedVariantIds(queryable, variantIds),
    async listBatches() {
      const result = await queryable.query<BatchRow>(
        `SELECT id, variant_id, received_quantity, remaining_quantity, unit_cost_piasters,
                recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
         FROM inventory_batch
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
      );
      return result.rows.map(toBatchRecord);
    },
    async getSettings() {
      return loadSettings(queryable);
    },
    async updateSettings(lowStockThreshold, actorStaffId) {
      const result = await queryable.query<SettingsRow>(
        `UPDATE inventory_settings
         SET low_stock_threshold = $1, updated_by_staff_id = $2, updated_at = now()
         WHERE id = 'default'
         RETURNING low_stock_threshold`,
        [lowStockThreshold, actorStaffId],
      );
      return { lowStockThreshold: mustRow(result.rows[0]).low_stock_threshold };
    },
    async upsertVariantThreshold(variantId, lowStockThreshold, actorStaffId) {
      return writeVariantThreshold(queryable, variantId, lowStockThreshold, actorStaffId);
    },
    async clearVariantThreshold(variantId, actorStaffId) {
      return writeVariantThreshold(queryable, variantId, null, actorStaffId);
    },
    async listVariantThresholds() {
      const result = await queryable.query<{ variant_id: string; low_stock_threshold: number | null }>(
        `SELECT variant_id, low_stock_threshold FROM inventory_variant_setting`,
      );
      return new Map(result.rows.map((row) => [row.variant_id, row.low_stock_threshold]));
    },
  };
}

export function createInventoryTransaction(client: PoolClient): InventoryTransaction {
  return {
    async claimReceiveOperation(input) {
      const fingerprint = fingerprintReceivePayload(input.payload);
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, 'receive', $2, $3, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, fingerprint, input.actorStaffId],
      );
      const created = inserted.rows[0];
      if (created) {
        return { kind: "created", operationId: created.id, recordedAt: created.recorded_at };
      }
      const existing = await client.query<OperationRow>(
        `SELECT id, payload_fingerprint, recorded_at
         FROM inventory_operation
         WHERE id = $1`,
        [input.operationId],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new OperationConflictError();
      }
      if (row.payload_fingerprint !== fingerprint) {
        throw new OperationConflictError();
      }
      return { kind: "replay", operationId: row.id, recordedAt: row.recorded_at };
    },

    async receiveBatches(input) {
      const created: ReceivedBatchRecord[] = [];
      try {
        for (const line of input.lines) {
          const inserted = await client.query<BatchRow>(
            `INSERT INTO inventory_batch (
               id, variant_id, received_quantity, remaining_quantity, unit_cost_piasters,
               recorded_at, operation_id, source_receipt_id, receipt_date, source_line_id
             ) VALUES (
               gen_random_uuid(), $1, $2, $2, $3, $4, $5, $6, $7::date, $8
             ) RETURNING id, variant_id, received_quantity, remaining_quantity, unit_cost_piasters,
                         recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id`,
            [
              line.variantId,
              line.quantity,
              line.unitCostPiasters,
              input.recordedAt,
              input.operationId,
              input.receiptId,
              input.receiptDate,
              line.lineId,
            ],
          );
          const batch = toReceivedBatch(mustRow(inserted.rows[0]));
          await client.query(
            `INSERT INTO inventory_movement (
               id, batch_id, variant_id, operation_id, kind, quantity, recorded_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, 'receive', $4, $5)`,
            [batch.id, batch.variantId, input.operationId, line.quantity, input.recordedAt],
          );
          created.push(batch);
        }
      } catch (error) {
        if (isForeignKeyViolation(error, "inventory_batch_variant_fk") || isForeignKeyViolation(error, "inventory_movement_variant_fk")) {
          throw new InventoryValidationError("المتغير المحدد غير موجود.");
        }
        throw error;
      }
      return created;
    },

    quantitiesFor: (variantIds) => quantitiesFor(client, variantIds),
    referencedVariantIds: (variantIds) => referencedVariantIds(client, variantIds),
    async listAvailableBatchesFifo(variantId) {
      const result = await client.query<BatchRow>(
        `SELECT id, variant_id, received_quantity, remaining_quantity, unit_cost_piasters,
                recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
         FROM inventory_batch
         WHERE variant_id = $1 AND remaining_quantity > 0
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
        [variantId],
      );
      return result.rows.map(toReceivedBatch);
    },
  };
}

async function quantitiesFor(queryable: Queryable, variantIds: string[]): Promise<Map<string, number>> {
  const quantities = new Map(variantIds.map((id) => [id, 0]));
  if (variantIds.length === 0) {
    return quantities;
  }
  const result = await queryable.query<{ variant_id: string; available_quantity: number }>(
    `SELECT variant_id, SUM(remaining_quantity)::int AS available_quantity
     FROM inventory_batch
     WHERE variant_id = ANY($1::uuid[])
     GROUP BY variant_id`,
    [variantIds],
  );
  for (const row of result.rows) {
    quantities.set(row.variant_id, row.available_quantity);
  }
  return quantities;
}

async function referencedVariantIds(queryable: Queryable, variantIds: string[]): Promise<string[]> {
  if (variantIds.length === 0) {
    return [];
  }
  const result = await queryable.query<{ variant_id: string }>(
    `SELECT DISTINCT variant_id
     FROM inventory_batch
     WHERE variant_id = ANY($1::uuid[])`,
    [variantIds],
  );
  return result.rows.map((row) => row.variant_id);
}

async function writeVariantThreshold(
  queryable: Queryable,
  variantId: string,
  lowStockThreshold: number | null,
  actorStaffId: string,
): Promise<VariantLowStockDto> {
  try {
    const result = await queryable.query<{
      variant_id: string;
      low_stock_threshold: number | null;
      updated_by_staff_id: string | null;
      updated_at: Date;
    }>(
      `INSERT INTO inventory_variant_setting (variant_id, low_stock_threshold, updated_by_staff_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (variant_id) DO UPDATE
         SET low_stock_threshold = EXCLUDED.low_stock_threshold,
             updated_by_staff_id = EXCLUDED.updated_by_staff_id,
             updated_at = now()
       RETURNING variant_id, low_stock_threshold, updated_by_staff_id, updated_at`,
      [variantId, lowStockThreshold, actorStaffId],
    );
    const row = mustRow(result.rows[0]);
    return {
      variantId: row.variant_id,
      lowStockThreshold: row.low_stock_threshold,
      updatedByStaffId: row.updated_by_staff_id,
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (error) {
    if (isForeignKeyViolation(error, "inventory_variant_setting_variant_fk")) {
      throw new InventoryValidationError("المتغير المحدد غير موجود.");
    }
    throw error;
  }
}

function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || (error as { code?: string }).code !== "23503") {
    return false;
  }
  if (!constraint) {
    return true;
  }
  return (error as { constraint?: string }).constraint === constraint;
}

async function loadSettings(queryable: Queryable): Promise<SettingsRecord> {
  const result = await queryable.query<SettingsRow>(
    `SELECT low_stock_threshold FROM inventory_settings WHERE id = 'default'`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new InventoryValidationError("إعدادات المخزون غير موجودة.");
  }
  return { lowStockThreshold: row.low_stock_threshold };
}

function toBatchRecord(row: BatchRow): BatchRecord {
  return {
    id: row.id,
    variantId: row.variant_id,
    receivedQuantity: row.received_quantity,
    remainingQuantity: row.remaining_quantity,
    unitCostPiasters: row.unit_cost_piasters,
    recordedAt: row.recorded_at,
    receiptId: row.source_receipt_id,
    receiptDate: row.receipt_date,
  };
}

function toReceivedBatch(row: BatchRow): ReceivedBatchRecord {
  return {
    ...toBatchRecord(row),
    sourceLineId: row.source_line_id,
  };
}

function mustRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error("Expected a database row.");
  }
  return row;
}

export type { VariantLowStockDto };
