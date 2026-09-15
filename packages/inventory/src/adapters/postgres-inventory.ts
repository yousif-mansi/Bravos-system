import type { VariantLowStockDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import { InventoryValidationError, OperationConflictError } from "../domain/errors.ts";
import { fingerprintReceivePayload } from "../domain/fingerprint.ts";

import type {
  AllocateResult,
  AllocationRecord,
  BatchRecord,
  ClaimedOperation,
  DiscrepancyRecord,
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
  effective_received_quantity: number;
  remaining_quantity: number;
  unit_cost_piasters: number;
  effective_unit_cost_piasters: number;
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
    currentStockVersion: () => currentStockVersion(queryable),
    referencedVariantIds: (variantIds) => referencedVariantIds(queryable, variantIds),
    async listBatches() {
      const result = await queryable.query<BatchRow>(
        `SELECT id, variant_id, received_quantity, effective_received_quantity,
                remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
                recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
         FROM inventory_batch
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
      );
      return result.rows.map(toBatchRecord);
    },
    getBatchStates: (batchIds) => getBatchStates(queryable, batchIds),
    listAllocations: (operationId) => listAllocations(queryable, operationId),
    listDiscrepancies: (operationId) => listDiscrepancies(queryable, operationId),
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

    async claimSaleOperation(input) {
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, 'sale', $2, $3, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, input.payloadFingerprint, input.actorStaffId],
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
      if (row.payload_fingerprint !== input.payloadFingerprint) {
        throw new OperationConflictError();
      }
      return { kind: "replay", operationId: row.id, recordedAt: row.recorded_at };
    },

    async claimReturnOperation(input) {
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, 'return', $2, $3, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, input.payloadFingerprint, input.actorStaffId],
      );
      const created = inserted.rows[0];
      if (created) {
        return { kind: "created", operationId: created.id, recordedAt: created.recorded_at };
      }
      const existing = await client.query<OperationRow>(
        `SELECT id, payload_fingerprint, recorded_at FROM inventory_operation WHERE id = $1`,
        [input.operationId],
      );
      const row = existing.rows[0];
      if (!row || row.payload_fingerprint !== input.payloadFingerprint) {
        throw new OperationConflictError();
      }
      return { kind: "replay", operationId: row.id, recordedAt: row.recorded_at };
    },

    async claimCorrectionOperation(input) {
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, 'correction', $2, $3, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, input.payloadFingerprint, input.actorStaffId],
      );
      const created = inserted.rows[0];
      if (created) return { kind: "created", operationId: created.id, recordedAt: created.recorded_at };
      const existing = await client.query<OperationRow & { kind: string }>(
        `SELECT id, kind, payload_fingerprint, recorded_at FROM inventory_operation WHERE id = $1`,
        [input.operationId],
      );
      const row = existing.rows[0];
      if (!row || row.kind !== "correction" || row.payload_fingerprint !== input.payloadFingerprint) {
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
               id, variant_id, received_quantity, effective_received_quantity,
               remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
               recorded_at, operation_id, source_receipt_id, receipt_date, source_line_id
             ) VALUES (
               gen_random_uuid(), $1, $2, $2, $2, $3, $3, $4, $5, $6, $7::date, $8
             ) RETURNING id, variant_id, received_quantity, effective_received_quantity,
                         remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
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

    async applyReceivingCorrection(input) {
      const batchIds = [...new Set(input.lines.map((line) => line.batchId))].sort();
      const locked = await client.query<BatchRow>(
        `SELECT id, variant_id, received_quantity, effective_received_quantity,
                remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
                recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
         FROM inventory_batch
         WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
        [batchIds],
      );
      const byId = new Map(locked.rows.map((row) => [row.id, row]));
      if (byId.size !== batchIds.length) {
        throw new InventoryValidationError("تعذر العثور على دفعة التكلفة الأصلية.");
      }
      const results = [];
      for (const line of [...input.lines].sort((left, right) => left.batchId.localeCompare(right.batchId))) {
        const row = mustRow(byId.get(line.batchId));
        if (row.variant_id !== line.variantId) {
          throw new InventoryValidationError("دفعة التكلفة لا تخص المتغير المحدد.");
        }
        const allocatedQuantity = row.effective_received_quantity - row.remaining_quantity;
        if (line.effectiveQuantity < allocatedQuantity) {
          throw new InventoryValidationError("لا يمكن تقليل كمية الاستلام عن الوحدات المستهلكة حالياً.");
        }
        const quantityDelta = line.effectiveQuantity - row.effective_received_quantity;
        const unitCostDeltaPiasters = line.effectiveUnitCostPiasters - row.effective_unit_cost_piasters;
        const updated = await client.query<{ remaining_quantity: number }>(
          `UPDATE inventory_batch
           SET effective_received_quantity = $2,
               effective_unit_cost_piasters = $3,
               remaining_quantity = remaining_quantity + $4
           WHERE id = $1
             AND remaining_quantity + $4 >= 0
             AND remaining_quantity + $4 <= $2
           RETURNING remaining_quantity`,
          [line.batchId, line.effectiveQuantity, line.effectiveUnitCostPiasters, quantityDelta],
        );
        const remainingQuantity = updated.rows[0]?.remaining_quantity;
        if (remainingQuantity === undefined) {
          throw new InventoryValidationError("لا يمكن تقليل كمية الاستلام عن الوحدات المستهلكة حالياً.");
        }
        if (quantityDelta !== 0) {
          await client.query(
            `INSERT INTO inventory_movement (
               id, batch_id, variant_id, operation_id, kind, quantity, recorded_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [line.batchId, line.variantId, input.operationId,
              quantityDelta > 0 ? "correction_restore" : "correction_deduct",
              Math.abs(quantityDelta), input.recordedAt],
          );
        }
        results.push({
          batchId: row.id,
          variantId: row.variant_id,
          originalQuantity: row.received_quantity,
          originalUnitCostPiasters: row.unit_cost_piasters,
          previousQuantity: row.effective_received_quantity,
          previousUnitCostPiasters: row.effective_unit_cost_piasters,
          effectiveQuantity: line.effectiveQuantity,
          effectiveUnitCostPiasters: line.effectiveUnitCostPiasters,
          remainingQuantity,
          allocatedQuantity,
          quantityDelta,
          unitCostDeltaPiasters,
        });
      }
      return results;
    },

    async allocateFromOldestAvailable(input) {
      return allocateFromOldestAvailable(client, input);
    },
    async allocateCorrectionFromOldestAvailable(input) {
      return allocateFromOldestAvailable(client, { ...input, allowPartial: false, movementKind: "correction_deduct" });
    },
    async restoreToOriginalBatch(input) {
      const updated = await client.query<{ remaining_quantity: number }>(
        `UPDATE inventory_batch
         SET remaining_quantity = remaining_quantity + $3
         WHERE id = $1 AND variant_id = $2
           AND remaining_quantity + $3 <= effective_received_quantity
         RETURNING remaining_quantity`,
        [input.batchId, input.variantId, input.quantity],
      );
      if (!updated.rows[0]) {
        throw new InventoryValidationError("تعذر استعادة الصنف إلى دفعة التكلفة الأصلية.");
      }
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, 'return', $4, $5)`,
        [input.batchId, input.variantId, input.operationId, input.quantity, input.recordedAt],
      );
    },
    async adjustCorrectionBatch(input) {
      const delta = input.direction === "restore" ? input.quantity : -input.quantity;
      const updated = await client.query<{
        unit_cost_piasters: number | string;
        effective_unit_cost_piasters: number | string;
      }>(
        `UPDATE inventory_batch
         SET remaining_quantity = remaining_quantity + $3
         WHERE id = $1 AND variant_id = $2
           AND remaining_quantity + $3 BETWEEN 0 AND effective_received_quantity
         RETURNING unit_cost_piasters, effective_unit_cost_piasters`,
        [input.batchId, input.variantId, delta],
      );
      const row = updated.rows[0];
      if (!row) throw new InventoryValidationError(
        input.direction === "restore"
          ? "تعذر استعادة الصنف إلى دفعة التكلفة الأصلية."
          : "تعذر خصم الصنف من دفعة التكلفة الأصلية لأن الكمية لم تعد متاحة.",
      );
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [input.batchId, input.variantId, input.operationId,
          input.direction === "restore" ? "correction_restore" : "correction_deduct",
          input.quantity, input.recordedAt],
      );
      return {
        unitCostPiasters: asSafeInteger(row.unit_cost_piasters),
        effectiveUnitCostPiasters: asSafeInteger(row.effective_unit_cost_piasters),
      };
    },
    async recordDiscrepancy(input) {
      const unallocatedQuantity = input.requestedQuantity - input.allocatedQuantity;
      if (unallocatedQuantity <= 0) {
        throw new InventoryValidationError("لا توجد كمية غير مخصصة لتسجيلها.");
      }
      const inserted = await client.query<{
        variant_id: string;
        requested_quantity: number;
        allocated_quantity: number;
        unallocated_quantity: number;
      }>(
        `INSERT INTO inventory_discrepancy (
           id, operation_id, variant_id, requested_quantity, allocated_quantity,
           unallocated_quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         RETURNING variant_id, requested_quantity, allocated_quantity, unallocated_quantity`,
        [
          input.operationId,
          input.variantId,
          input.requestedQuantity,
          input.allocatedQuantity,
          unallocatedQuantity,
          input.recordedAt,
        ],
      );
      const row = mustRow(inserted.rows[0]);
      return {
        variantId: row.variant_id,
        requestedQuantity: row.requested_quantity,
        allocatedQuantity: row.allocated_quantity,
        unallocatedQuantity: row.unallocated_quantity,
      };
    },
    listAllocations: (operationId) => listAllocations(client, operationId),
    listDiscrepancies: (operationId) => listDiscrepancies(client, operationId),
    quantitiesFor: (variantIds) => quantitiesFor(client, variantIds),
    referencedVariantIds: (variantIds) => referencedVariantIds(client, variantIds),
    async listAvailableBatchesFifo(variantId) {
      const result = await client.query<BatchRow>(
        `SELECT id, variant_id, received_quantity, effective_received_quantity,
                remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
                recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
         FROM inventory_batch
         WHERE variant_id = $1 AND remaining_quantity > 0
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
        [variantId],
      );
      return result.rows.map(toReceivedBatch);
    },
    getBatchStates: (batchIds) => getBatchStates(client, batchIds),
    lockStockClock: (mode) => lockStockClock(client, mode),
    bumpStockVersion: () => bumpStockVersion(client),
    currentStockVersion: () => currentStockVersion(client),
  };
}

async function allocateFromOldestAvailable(
  client: PoolClient,
  input: {
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
    allowPartial: boolean;
    movementKind?: "sale" | "correction_deduct";
  },
): Promise<AllocateResult> {
  const locked = await client.query<BatchRow>(
    `SELECT id, variant_id, received_quantity, effective_received_quantity,
            remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
            recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
     FROM inventory_batch
     WHERE variant_id = $1 AND remaining_quantity > 0
     ORDER BY ${FIFO_BATCH_ORDER_SQL}
     FOR UPDATE`,
    [input.variantId],
  );
  await client.query(
    `SELECT id FROM inventory_discrepancy WHERE variant_id = $1 FOR UPDATE`,
    [input.variantId],
  );
  const held = await client.query<{ held: number }>(
    `SELECT COALESCE(SUM(unallocated_quantity), 0)::int AS held
     FROM inventory_discrepancy
     WHERE variant_id = $1`,
    [input.variantId],
  );
  const batchRemaining = locked.rows.reduce((sum, row) => sum + row.remaining_quantity, 0);
  const unresolved = held.rows[0]?.held ?? 0;
  if (unresolved > 0) {
    if (!input.allowPartial) {
      throw new InventoryValidationError("الكمية المتاحة غير كافية.");
    }
    return {
      allocations: [],
      allocatedQuantity: 0,
      unallocatedQuantity: input.quantity,
    };
  }
  const allocatable = batchRemaining;
  if (!input.allowPartial && allocatable < input.quantity) {
    throw new InventoryValidationError("الكمية المتاحة غير كافية.");
  }
  const allocations: AllocationRecord[] = [];
  let remainingNeed = Math.min(input.quantity, allocatable);
  try {
    for (const row of locked.rows) {
      if (remainingNeed <= 0) {
        break;
      }
      const take = Math.min(remainingNeed, row.remaining_quantity);
      if (take <= 0) {
        continue;
      }
      const updated = await client.query<{ remaining_quantity: number }>(
        `UPDATE inventory_batch
         SET remaining_quantity = remaining_quantity - $2
         WHERE id = $1 AND remaining_quantity >= $2
         RETURNING remaining_quantity`,
        [row.id, take],
      );
      if (!updated.rows[0]) {
        throw new InventoryValidationError("الكمية المتاحة غير كافية.");
      }
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [row.id, input.variantId, input.operationId, input.movementKind ?? "sale", take, input.recordedAt],
      );
      await client.query(
        `INSERT INTO inventory_allocation (
           id, batch_id, variant_id, operation_id, quantity, unit_cost_piasters, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [row.id, input.variantId, input.operationId, take, row.unit_cost_piasters, input.recordedAt],
      );
      allocations.push({
        batchId: row.id,
        variantId: input.variantId,
        quantity: take,
        unitCostPiasters: row.unit_cost_piasters,
        effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
        recordedAt: input.recordedAt,
      });
      remainingNeed -= take;
    }
  } catch (error) {
    if (isForeignKeyViolation(error, "inventory_allocation_variant_fk") || isForeignKeyViolation(error, "inventory_movement_variant_fk")) {
      throw new InventoryValidationError("المتغير المحدد غير موجود.");
    }
    throw error;
  }
  if (!input.allowPartial && remainingNeed > 0) {
    throw new InventoryValidationError("الكمية المتاحة غير كافية.");
  }
  const allocatedQuantity = Math.min(input.quantity, allocatable) - remainingNeed;
  return {
    allocations,
    allocatedQuantity,
    unallocatedQuantity: input.quantity - allocatedQuantity,
  };
}

async function listAllocations(queryable: Queryable, operationId: string): Promise<AllocationRecord[]> {
  const result = await queryable.query<{
    batch_id: string;
    variant_id: string;
    quantity: number;
    unit_cost_piasters: number;
    effective_unit_cost_piasters: number;
    recorded_at: Date;
  }>(
    `SELECT a.batch_id, a.variant_id, a.quantity, a.unit_cost_piasters,
            b.effective_unit_cost_piasters, a.recorded_at
     FROM inventory_allocation a
     JOIN inventory_batch b ON b.id = a.batch_id
     WHERE a.operation_id = $1
     ORDER BY a.recorded_at ASC, a.batch_id ASC`,
    [operationId],
  );
  return result.rows.map((row) => ({
    batchId: row.batch_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitCostPiasters: row.unit_cost_piasters,
    effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
    recordedAt: row.recorded_at,
  }));
}

async function listDiscrepancies(queryable: Queryable, operationId: string): Promise<DiscrepancyRecord[]> {
  const result = await queryable.query<{
    variant_id: string;
    requested_quantity: number;
    allocated_quantity: number;
    unallocated_quantity: number;
  }>(
    `SELECT variant_id, requested_quantity, allocated_quantity, unallocated_quantity
     FROM inventory_discrepancy
     WHERE operation_id = $1
     ORDER BY variant_id`,
    [operationId],
  );
  return result.rows.map((row) => ({
    variantId: row.variant_id,
    requestedQuantity: row.requested_quantity,
    allocatedQuantity: row.allocated_quantity,
    unallocatedQuantity: row.unallocated_quantity,
  }));
}

async function lockStockClock(queryable: Queryable, mode: "share" | "update"): Promise<void> {
  const locking = mode === "update" ? "FOR UPDATE" : "FOR SHARE";
  const result = await queryable.query(
    `SELECT version FROM inventory_stock_clock WHERE id = TRUE ${locking}`,
  );
  if (!result.rows[0]) {
    throw new InventoryValidationError("ساعة المخزون غير موجودة.");
  }
}

async function bumpStockVersion(queryable: Queryable): Promise<number> {
  const result = await queryable.query<{ version: string | number }>(
    `UPDATE inventory_stock_clock SET version = version + 1 WHERE id = TRUE RETURNING version`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new InventoryValidationError("ساعة المخزون غير موجودة.");
  }
  return Number(row.version);
}

async function currentStockVersion(queryable: Queryable): Promise<number> {
  const result = await queryable.query<{ version: string | number }>(
    `SELECT version FROM inventory_stock_clock WHERE id = TRUE`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new InventoryValidationError("ساعة المخزون غير موجودة.");
  }
  return Number(row.version);
}

async function quantitiesFor(queryable: Queryable, variantIds: string[]): Promise<Map<string, number>> {
  const quantities = new Map(variantIds.map((id) => [id, 0]));
  if (variantIds.length === 0) {
    return quantities;
  }
  const result = await queryable.query<{ variant_id: string; available_quantity: number }>(
    `SELECT v.variant_id,
            CASE
              WHEN COALESCE(d.held, 0) > 0 THEN 0
              ELSE COALESCE(b.remaining, 0)
            END::int AS available_quantity
     FROM UNNEST($1::uuid[]) AS v(variant_id)
     LEFT JOIN (
       SELECT variant_id, SUM(remaining_quantity)::int AS remaining
       FROM inventory_batch
       WHERE variant_id = ANY($1::uuid[])
       GROUP BY variant_id
     ) b ON b.variant_id = v.variant_id
     LEFT JOIN (
       SELECT variant_id, SUM(unallocated_quantity)::int AS held
       FROM inventory_discrepancy
       WHERE variant_id = ANY($1::uuid[])
       GROUP BY variant_id
     ) d ON d.variant_id = v.variant_id`,
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
     WHERE variant_id = ANY($1::uuid[])
     UNION
     SELECT DISTINCT variant_id
     FROM inventory_discrepancy
     WHERE variant_id = ANY($1::uuid[])
     UNION
     SELECT DISTINCT variant_id
     FROM inventory_allocation
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
    effectiveReceivedQuantity: row.effective_received_quantity,
    remainingQuantity: row.remaining_quantity,
    unitCostPiasters: row.unit_cost_piasters,
    effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
    recordedAt: row.recorded_at,
    receiptId: row.source_receipt_id,
    receiptDate: row.receipt_date,
  };
}

async function getBatchStates(queryable: Queryable, batchIds: string[]): Promise<BatchRecord[]> {
  if (batchIds.length === 0) return [];
  const result = await queryable.query<BatchRow>(
    `SELECT id, variant_id, received_quantity, effective_received_quantity,
            remaining_quantity, unit_cost_piasters, effective_unit_cost_piasters,
            recorded_at, source_receipt_id, receipt_date::text AS receipt_date, source_line_id
     FROM inventory_batch
     WHERE id = ANY($1::uuid[])
     ORDER BY id`,
    [batchIds],
  );
  return result.rows.map(toBatchRecord);
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

function asSafeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Inventory piaster value exceeds the safe integer range.");
  }
  return parsed;
}

export type { VariantLowStockDto };
