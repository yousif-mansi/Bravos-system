import type { VariantLowStockDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import { InventoryValidationError, OperationConflictError, StockMutationPausedError } from "../domain/errors.ts";
import { fingerprintReceivePayload } from "../domain/fingerprint.ts";

import type {
  AllocateResult,
  AllocationRecord,
  BatchRecord,
  ClaimedOperation,
  DiscrepancyRecord,
  InventoryReadStore,
  InventoryTransaction,
  OnlineOrderDispositionResult,
  ProtectOnlineOrderResult,
  ReceivedBatchRecord,
  SettingsRecord,
} from "../application/ports.ts";

const FIFO_BATCH_ORDER_SQL = "b.recorded_at ASC, b.id ASC";

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
  branch_balances?: Array<{ branch_id: string; remaining_quantity: number }>;
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

type ProtectedOrderRow = {
  order_id: string;
  branch_id: string;
  operation_id: string;
  protected_at: Date;
};

type ProtectedAllocationRow = {
  allocation_id: string;
  branch_id: string;
  variant_id: string;
  quantity: number;
  protected_at: Date;
};

type ActiveProtectedAllocationRow = {
  allocation_id: string;
  batch_id: string;
  source_line_id: string;
  variant_id: string;
  quantity: number;
  disposed_quantity: number;
  batch_recorded_at: Date;
};

type DispositionAllocationRow = {
  allocation_id: string;
  source_line_id: string;
  variant_id: string;
  disposition: "sellable_restored" | "nonsellable_removed";
  quantity: number;
};

export function createPostgresInventoryStore(queryable: Queryable): InventoryReadStore {
  return {
    async listBranchIds() {
      const result = await queryable.query<{ id: string }>(`SELECT id FROM branch ORDER BY id`);
      return result.rows.map((row) => row.id);
    },
    quantitiesFor: (branchId, variantIds) => quantitiesFor(queryable, branchId, variantIds),
    quantitiesByBranchFor: (variantIds) => quantitiesByBranchFor(queryable, variantIds),
    currentStockVersion: () => currentStockVersion(queryable),
    referencedVariantIds: (variantIds) => referencedVariantIds(queryable, variantIds),
    async listBatches() {
      const result = await queryable.query<BatchRow>(
        `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
                ${batchBalanceColumns("b")}, b.unit_cost_piasters, b.effective_unit_cost_piasters,
                b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
         FROM inventory_batch b
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
      );
      return result.rows.map(toBatchRecord);
    },
    getBatchStates: (batchIds) => getBatchStates(queryable, batchIds),
    listAllocations: (operationId) => listAllocations(queryable, operationId),
    listAllocationsForOperations: (operationIds) => listAllocationsForOperations(queryable, operationIds),
    listProtectedOrderAllocations: (orderId) => loadProtectedOrderAllocationProvenance(queryable, orderId, false),
    listDiscrepancies: (operationId) => listDiscrepancies(queryable, operationId),
    listDiscrepanciesForOperations: (operationIds) => listDiscrepanciesForOperations(queryable, operationIds),
    async unresolvedDiscrepancyQuantity() {
      const result = await queryable.query<{ quantity: number | string }>(
        `SELECT COALESCE(SUM(unallocated_quantity),0)::bigint AS quantity FROM inventory_discrepancy`,
      );
      return asSafeInteger(result.rows[0]?.quantity ?? 0);
    },
    async listProtectedOrderAllocationProvenance(orderIds) {
      return loadProtectedOrderAllocationProvenanceForOrders(queryable, orderIds);
    },
    async summarizeAuthoritativeAvailableInventory() {
      const result = await queryable.query<{ quantity: number | string; value_piasters: number | string }>(
        `SELECT COALESCE(SUM(balance.remaining_quantity),0)::bigint AS quantity,
                COALESCE(SUM(balance.remaining_quantity::bigint * b.effective_unit_cost_piasters::bigint),0)::bigint AS value_piasters
         FROM inventory_batch b
         JOIN inventory_batch_balance balance ON balance.batch_id=b.id
         WHERE balance.remaining_quantity > 0
           AND NOT EXISTS (
             SELECT 1 FROM inventory_discrepancy d
             WHERE d.variant_id=b.variant_id AND d.branch_id=balance.branch_id AND d.unallocated_quantity > 0
           )`,
      );
      return { quantity: asSafeInteger(result.rows[0]?.quantity ?? 0),
        valuePiasters: asSafeInteger(result.rows[0]?.value_piasters ?? 0) };
    },
    async summarizeProtectedOrderInventory(orderIds) {
      if (orderIds.length === 0) return { quantity: 0, valuePiasters: 0 };
      const result = await queryable.query<{ quantity: number | string; value_piasters: number | string }>(
        `SELECT COALESCE(SUM(GREATEST(a.quantity
                  - COALESCE(disposed.sellable_restored,0)
                  - COALESCE(disposed.nonsellable_removed,0)
                  - COALESCE(disposed.customer_returned,0),0)),0)::bigint AS quantity,
                COALESCE(SUM(GREATEST(a.quantity
                  - COALESCE(disposed.sellable_restored,0)
                  - COALESCE(disposed.nonsellable_removed,0)
                  - COALESCE(disposed.customer_returned,0),0)::bigint * b.effective_unit_cost_piasters::bigint),0)::bigint AS value_piasters
         FROM inventory_protected_order_allocation protected
         JOIN inventory_allocation a ON a.id=protected.allocation_id
         JOIN inventory_batch b ON b.id=a.batch_id
         LEFT JOIN LATERAL (
           SELECT COALESCE((SELECT SUM(quantity) FROM inventory_order_disposition_allocation d
                    WHERE d.allocation_id=a.id AND d.disposition='sellable_restored'),0)::int AS sellable_restored,
                  COALESCE((SELECT SUM(quantity) FROM inventory_order_disposition_allocation d
                    WHERE d.allocation_id=a.id AND d.disposition='nonsellable_removed'),0)::int AS nonsellable_removed,
                  COALESCE((SELECT SUM(quantity_delta) FROM inventory_delivered_return_allocation_effect e
                    WHERE e.allocation_id=a.id),0)::int AS customer_returned
         ) disposed ON true
         WHERE protected.protected_order_id=ANY($1::uuid[])`,
        [orderIds],
      );
      return { quantity: asSafeInteger(result.rows[0]?.quantity ?? 0),
        valuePiasters: asSafeInteger(result.rows[0]?.value_piasters ?? 0) };
    },
    async listOrderRestoredCostByOperations(operationIds) {
      const costs = new Map<string, number>();
      if (operationIds.length === 0) return costs;
      const result = await queryable.query<{ operation_id: string; cost_piasters: number | string }>(
        `SELECT disposition.operation_id,
                SUM(effect.quantity::bigint * batch.effective_unit_cost_piasters::bigint)::bigint AS cost_piasters
         FROM inventory_order_disposition disposition
         JOIN inventory_order_disposition_allocation effect ON effect.operation_id = disposition.operation_id
         JOIN inventory_allocation allocation ON allocation.id = effect.allocation_id
         JOIN inventory_batch batch ON batch.id = allocation.batch_id
         WHERE disposition.operation_id = ANY($1::uuid[]) AND effect.disposition = 'sellable_restored'
         GROUP BY disposition.operation_id`,
        [operationIds],
      );
      for (const row of result.rows) costs.set(row.operation_id, asSafeInteger(row.cost_piasters));
      return costs;
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

export function createInventoryTransaction(
  client: PoolClient,
  returnOperationClock?: { now(): Date },
): InventoryTransaction {
  return {
    async openingImportState(variantIds) {
      const [version, settings, thresholds] = await Promise.all([
        currentStockVersion(client),
        loadSettings(client),
        client.query<{ variant_id: string; low_stock_threshold: number | null }>(
          "SELECT variant_id,low_stock_threshold FROM inventory_variant_setting WHERE variant_id=ANY($1::uuid[]) ORDER BY variant_id",
          [variantIds],
        ),
      ]);
      return {
        stockVersion: version,
        defaultThreshold: settings.lowStockThreshold,
        variantThresholds: thresholds.rows.map((row) => ({ variantId: row.variant_id, threshold: row.low_stock_threshold })),
      };
    },
    async claimOpeningImportOperation(input) {
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, 'receive', $2, $3, now())
         ON CONFLICT (id) DO NOTHING RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, input.payloadFingerprint, input.actorStaffId],
      );
      const created = inserted.rows[0];
      if (created) return { kind: "created", operationId: created.id, recordedAt: created.recorded_at };
      const existing = await client.query<OperationRow & { kind: string }>("SELECT id,kind,payload_fingerprint,recorded_at FROM inventory_operation WHERE id=$1", [input.operationId]);
      const row = existing.rows[0];
      if (!row || row.kind !== "receive" || row.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
      return { kind: "replay", operationId: row.id, recordedAt: row.recorded_at };
    },
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
         VALUES ($1, 'return', $2, $3, COALESCE($4::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, input.payloadFingerprint, input.actorStaffId, returnOperationClock?.now() ?? null],
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

    async claimStockCorrectionOperation(input) {
      const kind = input.kind ?? "stock_correction";
      const inserted = await client.query<OperationRow>(
        `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, payload_fingerprint, recorded_at`,
        [input.operationId, kind, input.payloadFingerprint, input.actorStaffId],
      );
      const created = inserted.rows[0];
      if (created) return { kind: "created", operationId: created.id, recordedAt: created.recorded_at };
      const existing = await client.query<OperationRow & { kind: string }>(
        `SELECT id, kind, payload_fingerprint, recorded_at FROM inventory_operation WHERE id = $1`,
        [input.operationId],
      );
      const row = existing.rows[0];
      if (!row || row.kind !== kind || row.payload_fingerprint !== input.payloadFingerprint) {
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
               unit_cost_piasters, effective_unit_cost_piasters,
               recorded_at, operation_id, source_receipt_id, receipt_date, source_line_id
             ) VALUES (
               gen_random_uuid(), $1, $2, $2, $3, $3, $4, $5, $6, $7::date, $8
             ) RETURNING id, variant_id, received_quantity, effective_received_quantity,
                         unit_cost_piasters, effective_unit_cost_piasters,
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
          const row = mustRow(inserted.rows[0]);
          await client.query(
            `INSERT INTO inventory_batch_balance (batch_id, branch_id, remaining_quantity) VALUES ($1,$2,$3)`,
            [row.id, input.branchId, line.quantity],
          );
          const batch = toReceivedBatch({ ...row, remaining_quantity: line.quantity,
            branch_balances: [{ branch_id: input.branchId, remaining_quantity: line.quantity }] });
          await client.query(
            `INSERT INTO inventory_movement (
               id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'receive', $5, $6)`,
            [batch.id, batch.variantId, input.branchId, input.operationId, line.quantity, input.recordedAt],
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

    async importOpeningBatches(input) {
      const created: ReceivedBatchRecord[] = [];
      for (const line of input.lines) {
        const inserted = await client.query<BatchRow>(
          `INSERT INTO inventory_batch (
             id, variant_id, received_quantity, effective_received_quantity,
             unit_cost_piasters, effective_unit_cost_piasters,
             recorded_at, operation_id, source_receipt_id, receipt_date, source_line_id
           ) VALUES ($1,$2,$3,$3,$4,$4,$5,$6,$7,$8::date,$9)
           RETURNING id,variant_id,received_quantity,effective_received_quantity,
                     unit_cost_piasters,effective_unit_cost_piasters,recorded_at,source_receipt_id,
                     receipt_date::text AS receipt_date,source_line_id`,
          [line.batchId,line.variantId,line.quantity,line.unitCostPiasters,line.recordedAt,input.operationId,line.receiptId,line.receiptDate,line.lineId],
        );
        const row = mustRow(inserted.rows[0]);
        await client.query(
          `INSERT INTO inventory_batch_balance (batch_id, branch_id, remaining_quantity) VALUES ($1,$2,$3)`,
          [row.id, line.branchId, line.quantity],
        );
        const batch = toReceivedBatch({ ...row, remaining_quantity: line.quantity,
          branch_balances: [{ branch_id: line.branchId, remaining_quantity: line.quantity }] });
        await client.query(
          `INSERT INTO inventory_movement (id,batch_id,variant_id,branch_id,operation_id,kind,quantity,recorded_at)
           VALUES ($1,$2,$3,$4,$5,'receive',$6,$7)`,
          [line.movementId,line.batchId,line.variantId,line.branchId,input.operationId,line.quantity,line.recordedAt],
        );
        created.push(batch);
      }
      return created;
    },

    async applyOpeningSettings(input) {
      if (input.defaultThreshold !== null) {
        await client.query(`UPDATE inventory_settings SET low_stock_threshold=$1,updated_by_staff_id=$2,updated_at=$3 WHERE id='default'`, [input.defaultThreshold,input.actorStaffId,input.at]);
      }
      for (const row of input.variantThresholds) {
        await client.query(`INSERT INTO inventory_variant_setting (variant_id,low_stock_threshold,updated_by_staff_id,updated_at)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (variant_id) DO UPDATE SET low_stock_threshold=EXCLUDED.low_stock_threshold,updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=EXCLUDED.updated_at`,[row.variantId,row.threshold,input.actorStaffId,input.at]);
      }
    },

    async applyReceivingCorrection(input) {
      const batchIds = [...new Set(input.lines.map((line) => line.batchId))].sort();
      const locked = await client.query<BatchRow>(
        `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
                ${batchBalanceColumns("b")}, b.unit_cost_piasters, b.effective_unit_cost_piasters,
                b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
         FROM inventory_batch b
         WHERE b.id = ANY($1::uuid[])
         ORDER BY b.id
         FOR UPDATE OF b`,
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
        const receiptBranchAvailable = row.branch_balances?.find((balance) => balance.branch_id === input.branchId)?.remaining_quantity ?? 0;
        if (quantityDelta < 0 && receiptBranchAvailable < -quantityDelta) {
          throw new InventoryValidationError("لا يمكن تقليل الاستلام لأن الكمية المتاحة في فرع الاستلام غير كافية؛ الأصناف المرتجعة في فرع آخر تبقى هناك.");
        }
        const updated = await client.query<{ effective_received_quantity: number }>(
          `UPDATE inventory_batch
           SET effective_received_quantity = $2,
               effective_unit_cost_piasters = $3
           WHERE id = $1
           RETURNING effective_received_quantity`,
          [line.batchId, line.effectiveQuantity, line.effectiveUnitCostPiasters],
        );
        if (!updated.rows[0]) {
          throw new InventoryValidationError("لا يمكن تقليل كمية الاستلام عن الوحدات المستهلكة حالياً.");
        }
        const remainingQuantity = await changeBatchBalance(client, line.batchId, input.branchId, quantityDelta);
        if (quantityDelta !== 0) {
          await client.query(
            `INSERT INTO inventory_movement (
               id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
            [line.batchId, line.variantId, input.branchId, input.operationId,
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

    protectOnlineOrder(input) {
      return protectOnlineOrder(client, input);
    },
    disposeProtectedOnlineOrder(input) {
      return disposeProtectedOnlineOrder(client, input);
    },
    lockProtectedOrderAllocations(orderId) {
      return loadProtectedOrderAllocationProvenance(client, orderId, true);
    },
    async listDeliveredReturnAllocationEffects(operationIds) {
      if (operationIds.length === 0) return [];
      const result = await client.query<{ operation_id: string; allocation_id: string; quantity_delta: number }>(
        `SELECT operation_id,allocation_id,quantity_delta
         FROM inventory_delivered_return_allocation_effect
         WHERE operation_id=ANY($1::uuid[]) ORDER BY recorded_at,id`, [operationIds]);
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        allocationId: row.allocation_id,
        quantityDelta: row.quantity_delta,
      }));
    },
    adjustDeliveredReturnProtection(input) {
      return adjustDeliveredReturnProtection(client, input);
    },

    async allocateFromOldestAvailable(input) {
      return allocateFromOldestAvailable(client, input);
    },
    async allocateHeldFromOldestAvailable(input) {
      return allocateFromOldestAvailable(client, { ...input, allowPartial: false, ignoreHeld: true });
    },
    async attributeHeldAllocation(input) {
      const batch = await client.query<BatchRow>(
        `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
                ${batchBalanceColumns("b")}, b.unit_cost_piasters, b.effective_unit_cost_piasters,
                b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
         FROM inventory_batch b WHERE b.id = $1 FOR UPDATE OF b`,
        [input.batchId],
      );
      const row = batch.rows[0];
      if (!row || row.variant_id !== input.variantId) {
        throw new InventoryValidationError("دفعة تكلفة التصحيح لا تخص المتغير المحدد.");
      }
      await client.query(
        `INSERT INTO inventory_allocation (
           id, batch_id, variant_id, branch_id, operation_id, quantity, unit_cost_piasters, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [row.id, input.variantId, input.branchId, input.operationId, input.quantity, row.unit_cost_piasters, input.recordedAt],
      );
      return {
        batchId: row.id,
        variantId: input.variantId,
        quantity: input.quantity,
        unitCostPiasters: row.unit_cost_piasters,
        effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
        recordedAt: input.recordedAt,
      };
    },
    async removeAllocation(input) {
      const rows = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM inventory_allocation
         WHERE operation_id = $1 AND batch_id = $2 AND variant_id = $3 AND branch_id = $4
           AND NOT EXISTS (
             SELECT 1 FROM inventory_protected_order_allocation protected
             WHERE protected.allocation_id = inventory_allocation.id
           )
         ORDER BY recorded_at DESC, id DESC
         FOR UPDATE`,
        [input.operationId, input.batchId, input.variantId, input.branchId],
      );
      let remaining = input.quantity;
      for (const row of rows.rows) {
        if (remaining === 0) break;
        const removed = Math.min(remaining, row.quantity);
        if (removed === row.quantity) {
          await client.query(`DELETE FROM inventory_allocation WHERE id = $1`, [row.id]);
        } else {
          await client.query(`UPDATE inventory_allocation SET quantity = quantity - $2 WHERE id = $1`, [row.id, removed]);
        }
        remaining -= removed;
      }
      if (remaining > 0) throw new InventoryValidationError("تخصيص تكلفة البيع لا يطابق الكمية المصالحة.");
    },
    async allocateCorrectionFromOldestAvailable(input) {
      return allocateFromOldestAvailable(client, { ...input, allowPartial: false, movementKind: "correction_deduct" });
    },
    async restoreToOriginalBatch(input) {
      await assertBatchVariant(client, input.batchId, input.variantId);
      await changeBatchBalance(client, input.batchId, input.branchId, input.quantity);
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'return', $5, $6)`,
        [input.batchId, input.variantId, input.branchId, input.operationId, input.quantity, input.recordedAt],
      );
    },
    async adjustCorrectionBatch(input) {
      const delta = input.direction === "restore" ? input.quantity : -input.quantity;
      const row = await assertBatchVariant(client, input.batchId, input.variantId);
      await changeBatchBalance(client, input.batchId, input.branchId, delta);
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [input.batchId, input.variantId, input.branchId, input.operationId,
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
           id, operation_id, variant_id, branch_id, requested_quantity, allocated_quantity,
           unallocated_quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING variant_id, requested_quantity, allocated_quantity, unallocated_quantity`,
        [
          input.operationId,
          input.variantId,
          input.branchId,
          input.requestedQuantity,
          input.allocatedQuantity,
          unallocatedQuantity,
          input.recordedAt,
        ],
      );
      const row = mustRow(inserted.rows[0]);
      return {
        branchId: input.branchId,
        variantId: row.variant_id,
        requestedQuantity: row.requested_quantity,
        allocatedQuantity: row.allocated_quantity,
        unallocatedQuantity: row.unallocated_quantity,
      };
    },
    async resolveDiscrepancy(input) {
      const current = await client.query<{
        requested_quantity: number;
        allocated_quantity: number;
        unallocated_quantity: number;
      }>(
        `SELECT requested_quantity, allocated_quantity, unallocated_quantity
         FROM inventory_discrepancy
         WHERE operation_id = $1 AND variant_id = $2 AND branch_id = $3
         FOR UPDATE`,
        [input.operationId, input.variantId, input.branchId],
      );
      const existing = current.rows[0];
      if (!existing || existing.unallocated_quantity < input.allocatedQuantity) {
        throw new InventoryValidationError("الكمية غير المخصصة لا تطابق واقعة البيع.");
      }
      if (existing.unallocated_quantity === input.allocatedQuantity) {
        await client.query(
          `DELETE FROM inventory_discrepancy WHERE operation_id = $1 AND variant_id = $2 AND branch_id = $3`,
          [input.operationId, input.variantId, input.branchId],
        );
        return null;
      }
      const updated = await client.query<{
        requested_quantity: number;
        allocated_quantity: number;
        unallocated_quantity: number;
      }>(
        `UPDATE inventory_discrepancy
         SET allocated_quantity = allocated_quantity + $3,
             unallocated_quantity = unallocated_quantity - $3
         WHERE operation_id = $1 AND variant_id = $2 AND branch_id = $4 AND unallocated_quantity >= $3
         RETURNING requested_quantity, allocated_quantity, unallocated_quantity`,
        [input.operationId, input.variantId, input.allocatedQuantity, input.branchId],
      );
      const row = updated.rows[0];
      if (!row) throw new InventoryValidationError("الكمية غير المخصصة لا تطابق واقعة البيع.");
      return {
        branchId: input.branchId,
        variantId: input.variantId,
        requestedQuantity: row.requested_quantity,
        allocatedQuantity: row.allocated_quantity,
        unallocatedQuantity: row.unallocated_quantity,
      };
    },
    listAllocations: (operationId) => listAllocations(client, operationId),
    listAllocationsForOperations: (operationIds) => listAllocationsForOperations(client, operationIds),
    listDiscrepancies: (operationId) => listDiscrepancies(client, operationId),
    listDiscrepanciesForOperations: (operationIds) => listDiscrepanciesForOperations(client, operationIds),
    async unresolvedDiscrepancyQuantity() {
      const result = await client.query<{ quantity: number | string }>(
        `SELECT COALESCE(SUM(unallocated_quantity),0)::bigint AS quantity FROM inventory_discrepancy`,
      );
      return asSafeInteger(result.rows[0]?.quantity ?? 0);
    },
    quantitiesFor: (branchId, variantIds) => quantitiesFor(client, branchId, variantIds),
    quantitiesByBranchFor: (variantIds) => quantitiesByBranchFor(client, variantIds),
    referencedVariantIds: (variantIds) => referencedVariantIds(client, variantIds),
    async listAvailableBatchesFifo(branchId, variantId) {
      const result = await client.query<BatchRow>(
        `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
                ${batchBalanceColumns("b")},
                b.unit_cost_piasters, b.effective_unit_cost_piasters,
                b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
         FROM inventory_batch b
         JOIN inventory_batch_balance balance ON balance.batch_id=b.id AND balance.branch_id=$1
         WHERE b.variant_id = $2 AND balance.remaining_quantity > 0
         ORDER BY ${FIFO_BATCH_ORDER_SQL}`,
        [branchId, variantId],
      );
      return result.rows.map(toReceivedBatch);
    },
    getBatchStates: (batchIds) => getBatchStates(client, batchIds),
    lockStockClock: (mode) => lockStockClock(client, mode),
    bumpStockVersion: () => bumpStockVersion(client),
    currentStockVersion: () => currentStockVersion(client),
    assertStockMutationAllowed: () => assertStockMutationAllowed(client),
    async recordTillSnapshot(input) {
      const pending = [...new Set(input.pendingOperationIds)].sort();
      const included = [...new Set(input.includedOperationIds)].sort();
      const synchronizationComplete = pending.length === included.length
        && pending.every((operationId, index) => operationId === included[index]);
      await client.query(
        `INSERT INTO inventory_known_till (
           device_id, staff_id, latest_snapshot_id, latest_snapshot_at, stock_version,
           pending_operation_ids, included_operation_ids, synchronization_complete, restore_generation
         ) VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9)
         ON CONFLICT (device_id) DO UPDATE SET
           staff_id = EXCLUDED.staff_id,
           latest_snapshot_id = EXCLUDED.latest_snapshot_id,
           latest_snapshot_at = EXCLUDED.latest_snapshot_at,
           stock_version = EXCLUDED.stock_version,
           pending_operation_ids = EXCLUDED.pending_operation_ids,
           included_operation_ids = EXCLUDED.included_operation_ids,
           synchronization_complete = EXCLUDED.synchronization_complete,
           restore_generation = EXCLUDED.restore_generation`,
        [input.deviceId, input.staffId, input.snapshotId, input.issuedAt, input.stockVersion, pending, included, synchronizationComplete, input.restoreGeneration],
      );
      const active = await client.query<{
        id: string;
        boundary_stock_version: string | number;
        boundary_at: Date;
        expires_at: Date;
      }>(
        `SELECT id, boundary_stock_version, boundary_at, expires_at
         FROM inventory_count_coordination
         WHERE status = 'active' AND expires_at > now()
         LIMIT 1`,
      );
      const coordination = active.rows[0];
      if (!coordination) return null;
      await client.query(
        `INSERT INTO inventory_count_coordination_device (
           coordination_id, device_id, known_snapshot_id, known_snapshot_at, known_stock_version
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (coordination_id, device_id) DO UPDATE SET
           acknowledged_snapshot_id = CASE WHEN $6 THEN inventory_count_coordination_device.acknowledged_snapshot_id ELSE NULL END,
           acknowledged_at = CASE WHEN $6 THEN inventory_count_coordination_device.acknowledged_at ELSE NULL END,
           acknowledged_stock_version = CASE WHEN $6 THEN inventory_count_coordination_device.acknowledged_stock_version ELSE NULL END`,
        [
          coordination.id,
          input.deviceId,
          input.snapshotId,
          input.issuedAt,
          input.stockVersion,
          synchronizationComplete && input.stockVersion === Number(coordination.boundary_stock_version),
        ],
      );
      return {
        coordinationId: coordination.id,
        boundaryStockVersion: Number(coordination.boundary_stock_version),
        boundaryAt: coordination.boundary_at.toISOString(),
        expiresAt: coordination.expires_at.toISOString(),
      };
    },
  };
}

async function expireActiveCoordination(queryable: Queryable): Promise<void> {
  await queryable.query(
    `UPDATE inventory_count_coordination
     SET status = 'expired', finished_at = expires_at, finished_by_staff_id = started_by_staff_id
     WHERE status = 'active' AND expires_at <= now()`,
  );
}

async function assertStockMutationAllowed(queryable: Queryable): Promise<void> {
  await expireActiveCoordination(queryable);
  const active = await queryable.query<{ id: string }>(
    `SELECT id FROM inventory_count_coordination
     WHERE status = 'active' AND expires_at > now()
     LIMIT 1`,
  );
  if (active.rows[0]) throw new StockMutationPausedError();
}

async function protectOnlineOrder(
  client: PoolClient,
  input: Parameters<InventoryTransaction["protectOnlineOrder"]>[0],
): Promise<ProtectOnlineOrderResult> {
  const lines = new Map<string, { lineId: string; quantity: number }>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new InventoryValidationError("كمية الصنف غير صالحة.");
    }
    if (lines.has(line.variantId)) {
      throw new InventoryValidationError("يجب تجميع المتغير في سطر طلب مؤكد واحد.");
    }
    const quantity = line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 1_000_000) {
      throw new InventoryValidationError("كمية الصنف غير صالحة.");
    }
    lines.set(line.variantId, { lineId: line.lineId, quantity });
  }
  if (lines.size === 0) {
    throw new InventoryValidationError("يجب تحديد صنف واحد على الأقل للحجز.");
  }

  const inserted = await client.query<OperationRow>(
    `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
     VALUES ($1, 'order_confirmation', $2, $3, now())
     ON CONFLICT (id) DO NOTHING
     RETURNING id, payload_fingerprint, recorded_at`,
    [input.operationId, input.payloadFingerprint, input.actorStaffId],
  );
  const created = inserted.rows[0];
  if (!created) {
    const existing = await client.query<OperationRow & { kind: string }>(
      `SELECT id, kind, payload_fingerprint, recorded_at
       FROM inventory_operation
       WHERE id = $1`,
      [input.operationId],
    );
    const operation = existing.rows[0];
    if (
      !operation
      || operation.kind !== "order_confirmation"
      || operation.payload_fingerprint !== input.payloadFingerprint
    ) {
      throw new OperationConflictError();
    }
    return loadProtectedOrderResult(client, input.orderId, input.branchId, operation, "replay");
  }

  await assertStockMutationAllowed(client);
  const protectedOrder = await client.query<ProtectedOrderRow>(
    `INSERT INTO inventory_protected_order (order_id, branch_id, operation_id, protected_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING order_id, operation_id, protected_at`,
    [input.orderId, input.branchId, input.operationId, created.recorded_at],
  );
  const header = protectedOrder.rows[0];
  if (!header) {
    throw new OperationConflictError("تم تأكيد هذا الطلب بعملية أخرى.");
  }

  for (const [variantId, line] of [...lines.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await allocateFromOldestAvailable(client, {
      operationId: input.operationId,
      branchId: input.branchId,
      variantId,
      quantity: line.quantity,
      recordedAt: created.recorded_at,
      allowPartial: false,
      movementKind: "order_confirmation",
    });
  }
  for (const [variantId, line] of [...lines.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await client.query(
      `INSERT INTO inventory_protected_order_allocation
         (protected_order_id, operation_id, allocation_id, source_line_id)
       SELECT $1, $2, id, $3
       FROM inventory_allocation
       WHERE operation_id = $2 AND variant_id = $4 AND branch_id = $5
       ORDER BY id`,
      [input.orderId, input.operationId, line.lineId, variantId, input.branchId],
    );
  }
  return loadProtectedOrderResult(client, input.orderId, input.branchId, created, "created");
}

async function loadProtectedOrderResult(
  queryable: Queryable,
  orderId: string,
  branchId: string,
  operation: OperationRow,
  kind: "created" | "replay",
): Promise<ProtectOnlineOrderResult> {
  const protectedOrder = await queryable.query<ProtectedOrderRow>(
    `SELECT order_id, branch_id, operation_id, protected_at
     FROM inventory_protected_order
     WHERE operation_id = $1`,
    [operation.id],
  );
  const header = protectedOrder.rows[0];
  if (!header || header.order_id !== orderId || header.branch_id !== branchId) {
    throw new OperationConflictError();
  }
  const protectedAllocations = await queryable.query<ProtectedAllocationRow>(
    `SELECT a.id AS allocation_id, a.branch_id, a.variant_id, a.quantity, p.protected_at
     FROM inventory_protected_order p
     JOIN inventory_protected_order_allocation pa ON pa.protected_order_id = p.order_id
     JOIN inventory_allocation a ON a.id = pa.allocation_id
     JOIN inventory_batch b ON b.id = a.batch_id
     WHERE p.order_id = $1
     ORDER BY a.variant_id, b.recorded_at, b.id, a.id`,
    [orderId],
  );
  if (protectedAllocations.rows.length === 0) {
    throw new OperationConflictError();
  }
  return {
    kind,
    operationId: operation.id,
    orderId: header.order_id,
    recordedAt: operation.recorded_at,
    allocations: protectedAllocations.rows.map((row) => ({
      branchId: row.branch_id,
      allocationId: row.allocation_id,
      variantId: row.variant_id,
      quantity: row.quantity,
      protectedAt: row.protected_at,
    })),
  };
}

function activeProtectedQuantitySql(batchIdSql: string): string {
  return `SELECT COALESCE(SUM(a.quantity - COALESCE(disposed.quantity, 0)
            - COALESCE(customer_returned.quantity, 0)), 0)::int
          FROM inventory_protected_order_allocation pa
          JOIN inventory_allocation a ON a.id = pa.allocation_id
          LEFT JOIN LATERAL (
            SELECT SUM(d.quantity)::int AS quantity
            FROM inventory_order_disposition_allocation d
            WHERE d.allocation_id = a.id
          ) disposed ON true
          LEFT JOIN LATERAL (
            SELECT SUM(effect.quantity_delta)::int AS quantity
            FROM inventory_delivered_return_allocation_effect effect
            WHERE effect.allocation_id = a.id
          ) customer_returned ON true
          WHERE a.batch_id = ${batchIdSql}`;
}

async function adjustDeliveredReturnProtection(
  client: PoolClient,
  input: Parameters<InventoryTransaction["adjustDeliveredReturnProtection"]>[0],
): Promise<void> {
  if (input.effects.length === 0) return;
  const byAllocation = new Map<string, number>();
  for (const effect of input.effects) {
    if (!Number.isSafeInteger(effect.quantityDelta) || effect.quantityDelta === 0) {
      throw new InventoryValidationError("تأثير وحدات مرتجع الطلب غير صالح.");
    }
    byAllocation.set(effect.allocationId, (byAllocation.get(effect.allocationId) ?? 0) + effect.quantityDelta);
  }
  const operation = await client.query<{ kind: string }>(
    `SELECT kind FROM inventory_operation WHERE id = $1`,
    [input.operationId],
  );
  if (!operation.rows[0] || !["return", "correction"].includes(operation.rows[0].kind)) {
    throw new OperationConflictError();
  }
  const rows = await client.query<{
    allocation_id: string;
    quantity: number;
    disposed_quantity: number;
    customer_returned_quantity: number;
  }>(
    `SELECT allocation.id AS allocation_id,allocation.quantity,
            COALESCE((SELECT SUM(item.quantity)::int
              FROM inventory_order_disposition_allocation item
              WHERE item.allocation_id=allocation.id),0)::int AS disposed_quantity,
            COALESCE((SELECT SUM(effect.quantity_delta)::int
              FROM inventory_delivered_return_allocation_effect effect
              WHERE effect.allocation_id=allocation.id),0)::int AS customer_returned_quantity
     FROM inventory_protected_order_allocation protected
     JOIN inventory_allocation allocation ON allocation.id=protected.allocation_id
     WHERE protected.protected_order_id=$1
       AND allocation.id=ANY($2::uuid[])
     ORDER BY allocation.id
     FOR UPDATE OF allocation`,
    [input.orderId, [...byAllocation.keys()]],
  );
  if (rows.rows.length !== byAllocation.size) {
    throw new InventoryValidationError("تخصيص مرتجع الطلب الأصلي غير موجود.");
  }
  for (const row of rows.rows) {
    const quantityDelta = byAllocation.get(row.allocation_id) ?? 0;
    if (quantityDelta === 0) continue;
    const next = row.disposed_quantity + row.customer_returned_quantity + quantityDelta;
    if (next < row.disposed_quantity || next > row.quantity) {
      throw new InventoryValidationError("كمية مرتجع الطلب تتجاوز تخصيصه الأصلي.");
    }
    const inserted = await client.query<{ quantity_delta: number }>(
      `INSERT INTO inventory_delivered_return_allocation_effect (
         id,operation_id,order_id,allocation_id,quantity_delta,recorded_at
       ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)
       ON CONFLICT (operation_id,allocation_id) DO NOTHING
       RETURNING quantity_delta`,
      [input.operationId, input.orderId, row.allocation_id, quantityDelta, input.recordedAt],
    );
    if (!inserted.rows[0]) {
      const existing = await client.query<{ order_id: string; quantity_delta: number }>(
        `SELECT order_id,quantity_delta
         FROM inventory_delivered_return_allocation_effect
         WHERE operation_id=$1 AND allocation_id=$2`,
        [input.operationId, row.allocation_id],
      );
      if (existing.rows[0]?.order_id !== input.orderId
        || existing.rows[0]?.quantity_delta !== quantityDelta) throw new OperationConflictError();
    }
  }
}

async function disposeProtectedOnlineOrder(
  client: PoolClient,
  input: Parameters<InventoryTransaction["disposeProtectedOnlineOrder"]>[0],
): Promise<OnlineOrderDispositionResult> {
  const inserted = await client.query<OperationRow>(
    `INSERT INTO inventory_operation (id, kind, payload_fingerprint, actor_staff_id, recorded_at)
     VALUES ($1, 'order_disposition', $2, $3, now())
     ON CONFLICT (id) DO NOTHING
     RETURNING id, payload_fingerprint, recorded_at`,
    [input.operationId, input.payloadFingerprint, input.actorStaffId],
  );
  const created = inserted.rows[0];
  if (!created) {
    const existing = await client.query<OperationRow & { kind: string }>(
      `SELECT id, kind, payload_fingerprint, recorded_at
       FROM inventory_operation WHERE id = $1`,
      [input.operationId],
    );
    const operation = existing.rows[0];
    if (!operation || operation.kind !== "order_disposition"
      || operation.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
    return loadOrderDispositionResult(client, input.orderId, input.branchId, operation, "replay");
  }

  await assertStockMutationAllowed(client);
  const protectedHeader = await client.query<{ order_id: string; branch_id: string }>(
    `SELECT order_id, branch_id FROM inventory_protected_order WHERE order_id = $1 FOR UPDATE`,
    [input.orderId],
  );
  if (!protectedHeader.rows[0]) throw new InventoryValidationError("لا توجد تخصيصات محمية لهذا الطلب.");
  if (input.dispositionType === "pre_shipment_cancellation"
    && protectedHeader.rows[0].branch_id !== input.branchId) {
    throw new InventoryValidationError("فرع إلغاء الطلب لا يطابق فرع تجهيزه.");
  }

  const allocations = await client.query<ActiveProtectedAllocationRow>(
    `SELECT a.id AS allocation_id, a.batch_id, pa.source_line_id, a.variant_id, a.quantity,
            COALESCE((
              SELECT SUM(disposition.quantity)::int
              FROM inventory_order_disposition_allocation disposition
              WHERE disposition.allocation_id = a.id
            ), 0)::int AS disposed_quantity,
            batch.recorded_at AS batch_recorded_at
     FROM inventory_protected_order_allocation pa
     JOIN inventory_allocation a ON a.id = pa.allocation_id
     JOIN inventory_batch batch ON batch.id = a.batch_id
     WHERE pa.protected_order_id = $1
     ORDER BY a.variant_id, batch.recorded_at, a.batch_id, a.id
     FOR UPDATE OF a, batch`,
    [input.orderId],
  );
  const active = allocations.rows.filter((row) => row.quantity > row.disposed_quantity);
  if (active.length === 0) throw new InventoryValidationError("تم التصرف في كل تخصيصات هذا الطلب بالفعل.");

  const requested = new Map<string, { sourceLineId: string; variantId: string; sellable: number; nonsellable: number }>();
  if (input.dispositionType === "pre_shipment_cancellation") {
    for (const row of active) {
      const key = `${row.source_line_id}:${row.variant_id}`;
      const current = requested.get(key) ?? {
        sourceLineId: row.source_line_id,
        variantId: row.variant_id,
        sellable: 0,
        nonsellable: 0,
      };
      current.sellable += row.quantity - row.disposed_quantity;
      requested.set(key, current);
    }
  } else {
    for (const line of input.lines) {
      if (!Number.isSafeInteger(line.sellableQuantity) || line.sellableQuantity < 0
        || !Number.isSafeInteger(line.nonsellableQuantity) || line.nonsellableQuantity < 0
        || line.sellableQuantity + line.nonsellableQuantity <= 0) {
        throw new InventoryValidationError("كميات فحص المرتجع غير صالحة.");
      }
      const key = `${line.sourceLineId}:${line.variantId}`;
      if (requested.has(key)) throw new InventoryValidationError("تكرر سطر فحص المرتجع.");
      requested.set(key, {
        sourceLineId: line.sourceLineId,
        variantId: line.variantId,
        sellable: line.sellableQuantity,
        nonsellable: line.nonsellableQuantity,
      });
    }
    if (requested.size === 0) throw new InventoryValidationError("يجب تسجيل صنف مستلم واحد على الأقل.");
  }

  for (const item of requested.values()) {
    const remaining = active
      .filter((row) => row.source_line_id === item.sourceLineId && row.variant_id === item.variantId)
      .reduce((sum, row) => sum + row.quantity - row.disposed_quantity, 0);
    if (remaining < item.sellable + item.nonsellable) {
      throw new InventoryValidationError("كمية الفحص تتجاوز الكمية المحمية غير المصنفة.");
    }
  }

  await client.query(
    `INSERT INTO inventory_order_disposition (operation_id, order_id, branch_id, disposition_type, recorded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.operationId, input.orderId, input.branchId, input.dispositionType, created.recorded_at],
  );

  const availableByAllocation = new Map(active.map((row) => [
    row.allocation_id,
    row.quantity - row.disposed_quantity,
  ]));
  for (const item of [...requested.values()].sort((left, right) =>
    left.variantId.localeCompare(right.variantId) || left.sourceLineId.localeCompare(right.sourceLineId))) {
    for (const disposition of ["sellable_restored", "nonsellable_removed"] as const) {
      let needed = disposition === "sellable_restored" ? item.sellable : item.nonsellable;
      for (const allocation of active) {
        if (needed === 0) break;
        if (allocation.source_line_id !== item.sourceLineId || allocation.variant_id !== item.variantId) continue;
        const available = availableByAllocation.get(allocation.allocation_id) ?? 0;
        if (available === 0) continue;
        const take = Math.min(available, needed);
        await client.query(
          `INSERT INTO inventory_order_disposition_allocation (
             id, operation_id, allocation_id, source_line_id, variant_id,
             disposition, quantity, recorded_at
           ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [input.operationId, allocation.allocation_id, allocation.source_line_id,
            allocation.variant_id, disposition, take, created.recorded_at],
        );
        availableByAllocation.set(allocation.allocation_id, available - take);
        if (disposition === "sellable_restored") {
          await changeBatchBalance(client, allocation.batch_id, input.branchId, take);
          await client.query(
            `INSERT INTO inventory_movement (
               id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
            [allocation.batch_id, allocation.variant_id, input.branchId, input.operationId,
              input.dispositionType === "pre_shipment_cancellation"
                ? "order_cancellation_restore" : "failed_delivery_restore",
              take, created.recorded_at],
          );
        }
        needed -= take;
      }
      if (needed !== 0) throw new InventoryValidationError("كمية الفحص لا تطابق التخصيصات الأصلية.");
    }
  }
  return loadOrderDispositionResult(client, input.orderId, input.branchId, created, "created");
}

async function loadOrderDispositionResult(
  queryable: Queryable,
  orderId: string,
  branchId: string,
  operation: OperationRow,
  kind: "created" | "replay",
): Promise<OnlineOrderDispositionResult> {
  const header = await queryable.query<{ order_id: string; branch_id: string; recorded_at: Date }>(
    `SELECT order_id, branch_id, recorded_at FROM inventory_order_disposition WHERE operation_id = $1`,
    [operation.id],
  );
  const row = header.rows[0];
  if (!row || row.order_id !== orderId || row.branch_id !== branchId) throw new OperationConflictError();
  const allocations = await queryable.query<DispositionAllocationRow>(
    `SELECT allocation_id, source_line_id, variant_id, disposition, quantity
     FROM inventory_order_disposition_allocation
     WHERE operation_id = $1
     ORDER BY variant_id, source_line_id, disposition, allocation_id`,
    [operation.id],
  );
  return {
    kind,
    operationId: operation.id,
    orderId,
    recordedAt: row.recorded_at,
    allocations: allocations.rows.map((item) => ({
      allocationId: item.allocation_id,
      sourceLineId: item.source_line_id,
      variantId: item.variant_id,
      disposition: item.disposition,
      quantity: item.quantity,
    })),
  };
}

async function loadProtectedOrderAllocationProvenance(
  queryable: Queryable,
  orderId: string,
  lock: boolean,
) {
  const result = await queryable.query<{
    branch_id: string;
    allocation_id: string;
    source_line_id: string;
    batch_id: string;
    variant_id: string;
    quantity: number;
    unit_cost_piasters: number | string;
    effective_unit_cost_piasters: number | string;
    allocated_at: Date;
    sellable_restored_quantity: number;
    nonsellable_removed_quantity: number;
    customer_returned_quantity: number;
  }>(
    `SELECT allocation.id AS allocation_id,allocation.branch_id,protected.source_line_id,allocation.batch_id,
            allocation.variant_id,allocation.quantity,allocation.unit_cost_piasters,
            batch.effective_unit_cost_piasters,allocation.recorded_at AS allocated_at,
            COALESCE((SELECT SUM(item.quantity)::int
              FROM inventory_order_disposition_allocation item
              WHERE item.allocation_id=allocation.id AND item.disposition='sellable_restored'),0)::int
              AS sellable_restored_quantity,
            COALESCE((SELECT SUM(item.quantity)::int
              FROM inventory_order_disposition_allocation item
              WHERE item.allocation_id=allocation.id AND item.disposition='nonsellable_removed'),0)::int
              AS nonsellable_removed_quantity,
            COALESCE((SELECT SUM(effect.quantity_delta)::int
              FROM inventory_delivered_return_allocation_effect effect
              WHERE effect.allocation_id=allocation.id),0)::int AS customer_returned_quantity
     FROM inventory_protected_order_allocation protected
     JOIN inventory_allocation allocation ON allocation.id=protected.allocation_id
     JOIN inventory_batch batch ON batch.id=allocation.batch_id
     WHERE protected.protected_order_id=$1
     ORDER BY allocation.variant_id,batch.recorded_at,batch.id,allocation.id
     ${lock ? "FOR UPDATE OF allocation,batch" : ""}`,
    [orderId],
  );
  return result.rows.map((row) => ({
    branchId: row.branch_id,
    protectedOrderId: orderId,
    allocationId: row.allocation_id,
    sourceLineId: row.source_line_id,
    batchId: row.batch_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitCostPiasters: asSafeInteger(row.unit_cost_piasters),
    effectiveUnitCostPiasters: asSafeInteger(row.effective_unit_cost_piasters),
    allocatedAt: row.allocated_at,
    sellableRestoredQuantity: row.sellable_restored_quantity,
    nonsellableRemovedQuantity: row.nonsellable_removed_quantity,
    customerReturnedQuantity: row.customer_returned_quantity,
    undisposedQuantity: row.quantity - row.sellable_restored_quantity
      - row.nonsellable_removed_quantity - row.customer_returned_quantity,
  }));
}

async function loadProtectedOrderAllocationProvenanceForOrders(queryable: Queryable, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  const result = await queryable.query<{
    protected_order_id: string; branch_id: string; allocation_id: string; source_line_id: string; batch_id: string;
    variant_id: string; quantity: number; unit_cost_piasters: number | string;
    effective_unit_cost_piasters: number | string; allocated_at: Date;
    sellable_restored_quantity: number; nonsellable_removed_quantity: number; customer_returned_quantity: number;
  }>(
    `SELECT protected.protected_order_id,allocation.branch_id,allocation.id AS allocation_id,protected.source_line_id,
            allocation.batch_id,allocation.variant_id,allocation.quantity,allocation.unit_cost_piasters,
            batch.effective_unit_cost_piasters,allocation.recorded_at AS allocated_at,
            COALESCE(disposed.sellable,0)::int AS sellable_restored_quantity,
            COALESCE(disposed.nonsellable,0)::int AS nonsellable_removed_quantity,
            COALESCE(customer_returned.quantity,0)::int AS customer_returned_quantity
     FROM inventory_protected_order_allocation protected
     JOIN inventory_allocation allocation ON allocation.id=protected.allocation_id
     JOIN inventory_batch batch ON batch.id=allocation.batch_id
     LEFT JOIN LATERAL (
       SELECT SUM(item.quantity) FILTER (WHERE item.disposition='sellable_restored') AS sellable,
              SUM(item.quantity) FILTER (WHERE item.disposition='nonsellable_removed') AS nonsellable
       FROM inventory_order_disposition_allocation item WHERE item.allocation_id=allocation.id
     ) disposed ON true
     LEFT JOIN LATERAL (
       SELECT SUM(effect.quantity_delta) AS quantity
       FROM inventory_delivered_return_allocation_effect effect WHERE effect.allocation_id=allocation.id
     ) customer_returned ON true
     WHERE protected.protected_order_id=ANY($1::uuid[])
     ORDER BY protected.protected_order_id,allocation.variant_id,batch.recorded_at,batch.id,allocation.id`,
    [orderIds],
  );
  return result.rows.map((row) => ({
    branchId: row.branch_id,
    protectedOrderId: row.protected_order_id,
    allocationId: row.allocation_id,
    sourceLineId: row.source_line_id,
    batchId: row.batch_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitCostPiasters: asSafeInteger(row.unit_cost_piasters),
    effectiveUnitCostPiasters: asSafeInteger(row.effective_unit_cost_piasters),
    allocatedAt: row.allocated_at,
    sellableRestoredQuantity: row.sellable_restored_quantity,
    nonsellableRemovedQuantity: row.nonsellable_removed_quantity,
    customerReturnedQuantity: row.customer_returned_quantity,
    undisposedQuantity: row.quantity - row.sellable_restored_quantity - row.nonsellable_removed_quantity - row.customer_returned_quantity,
  }));
}

async function allocateFromOldestAvailable(
  client: PoolClient,
  input: {
    operationId: string;
    branchId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
    allowPartial: boolean;
    movementKind?: "sale" | "correction_deduct" | "order_confirmation";
    ignoreHeld?: boolean;
  },
): Promise<AllocateResult> {
  const locked = await client.query<BatchRow>(
    `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
            balance.remaining_quantity, ${branchBalancesSql("b")} AS branch_balances,
            b.unit_cost_piasters, b.effective_unit_cost_piasters,
            b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
     FROM inventory_batch b
     JOIN inventory_batch_balance balance ON balance.batch_id=b.id AND balance.branch_id=$2
     WHERE b.variant_id = $1 AND balance.remaining_quantity > 0
     ORDER BY ${FIFO_BATCH_ORDER_SQL}
     FOR UPDATE OF b, balance`,
    [input.variantId, input.branchId],
  );
  await client.query(
    `SELECT id FROM inventory_discrepancy WHERE variant_id = $1 AND branch_id=$2 FOR UPDATE`,
    [input.variantId, input.branchId],
  );
  const held = await client.query<{ held: number }>(
    `SELECT COALESCE(SUM(unallocated_quantity), 0)::int AS held
     FROM inventory_discrepancy
     WHERE variant_id = $1 AND branch_id=$2`,
    [input.variantId, input.branchId],
  );
  const batchRemaining = locked.rows.reduce((sum, row) => sum + row.remaining_quantity, 0);
  const unresolved = held.rows[0]?.held ?? 0;
  if (unresolved > 0 && !input.ignoreHeld) {
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
        `UPDATE inventory_batch_balance
         SET remaining_quantity = remaining_quantity - $2
         WHERE batch_id = $1 AND branch_id=$3 AND remaining_quantity >= $2
         RETURNING remaining_quantity`,
        [row.id, take, input.branchId],
      );
      if (!updated.rows[0]) {
        throw new InventoryValidationError("الكمية المتاحة غير كافية.");
      }
      await client.query(
        `INSERT INTO inventory_movement (
           id, batch_id, variant_id, branch_id, operation_id, kind, quantity, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [row.id, input.variantId, input.branchId, input.operationId, input.movementKind ?? "sale", take, input.recordedAt],
      );
      await client.query(
        `INSERT INTO inventory_allocation (
           id, batch_id, variant_id, branch_id, operation_id, quantity, unit_cost_piasters, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [row.id, input.variantId, input.branchId, input.operationId, take, row.unit_cost_piasters, input.recordedAt],
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

async function listAllocationsForOperations(queryable: Queryable, operationIds: string[]) {
  if (operationIds.length === 0) return [];
  const result = await queryable.query<{
    operation_id: string; batch_id: string; variant_id: string; quantity: number;
    unit_cost_piasters: number | string; effective_unit_cost_piasters: number | string; recorded_at: Date;
  }>(
    `SELECT a.operation_id,a.batch_id,a.variant_id,a.quantity,a.unit_cost_piasters,
            b.effective_unit_cost_piasters,a.recorded_at
     FROM inventory_allocation a JOIN inventory_batch b ON b.id=a.batch_id
     WHERE a.operation_id=ANY($1::uuid[])
     ORDER BY a.operation_id,a.recorded_at,a.batch_id`,
    [operationIds],
  );
  return result.rows.map((row) => ({ operationId: row.operation_id, batchId: row.batch_id,
    variantId: row.variant_id, quantity: row.quantity, unitCostPiasters: asSafeInteger(row.unit_cost_piasters),
    effectiveUnitCostPiasters: asSafeInteger(row.effective_unit_cost_piasters), recordedAt: row.recorded_at }));
}

async function listDiscrepancies(queryable: Queryable, operationId: string): Promise<DiscrepancyRecord[]> {
  const result = await queryable.query<{
    branch_id: string;
    variant_id: string;
    requested_quantity: number;
    allocated_quantity: number;
    unallocated_quantity: number;
  }>(
    `SELECT branch_id, variant_id, requested_quantity, allocated_quantity, unallocated_quantity
     FROM inventory_discrepancy
     WHERE operation_id = $1
     ORDER BY variant_id`,
    [operationId],
  );
  return result.rows.map((row) => ({
    branchId: row.branch_id,
    variantId: row.variant_id,
    requestedQuantity: row.requested_quantity,
    allocatedQuantity: row.allocated_quantity,
    unallocatedQuantity: row.unallocated_quantity,
  }));
}

async function listDiscrepanciesForOperations(queryable: Queryable, operationIds: string[]) {
  if (operationIds.length === 0) return [];
  const result = await queryable.query<{
    operation_id: string; branch_id: string; variant_id: string; requested_quantity: number;
    allocated_quantity: number; unallocated_quantity: number;
  }>(
    `SELECT operation_id,branch_id,variant_id,requested_quantity,allocated_quantity,unallocated_quantity
     FROM inventory_discrepancy WHERE operation_id=ANY($1::uuid[])
     ORDER BY operation_id,variant_id`,
    [operationIds],
  );
  return result.rows.map((row) => ({ operationId: row.operation_id, branchId: row.branch_id, variantId: row.variant_id,
    requestedQuantity: row.requested_quantity, allocatedQuantity: row.allocated_quantity,
    unallocatedQuantity: row.unallocated_quantity }));
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

async function quantitiesFor(queryable: Queryable, branchId: string, variantIds: string[]): Promise<Map<string, number>> {
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
       SELECT batch.variant_id, SUM(balance.remaining_quantity)::int AS remaining
       FROM inventory_batch batch
       JOIN inventory_batch_balance balance ON balance.batch_id=batch.id
       WHERE batch.variant_id = ANY($1::uuid[]) AND balance.branch_id=$2
       GROUP BY batch.variant_id
     ) b ON b.variant_id = v.variant_id
     LEFT JOIN (
       SELECT variant_id, SUM(unallocated_quantity)::int AS held
       FROM inventory_discrepancy
       WHERE variant_id = ANY($1::uuid[]) AND branch_id=$2
       GROUP BY variant_id
     ) d ON d.variant_id = v.variant_id`,
    [variantIds, branchId],
  );
  for (const row of result.rows) {
    quantities.set(row.variant_id, row.available_quantity);
  }
  return quantities;
}

async function quantitiesByBranchFor(queryable: Queryable, variantIds: string[]): Promise<Map<string, Map<string, number>>> {
  const byBranch = new Map<string, Map<string, number>>();
  if (variantIds.length === 0) return byBranch;
  const result = await queryable.query<{ branch_id: string; variant_id: string; available_quantity: number }>(
    `SELECT branch.id AS branch_id, variants.variant_id,
            CASE
              WHEN held.variant_id IS NOT NULL THEN 0
              ELSE COALESCE(stock.remaining, 0)
            END::int AS available_quantity
     FROM branch
     CROSS JOIN UNNEST($1::uuid[]) AS variants(variant_id)
     LEFT JOIN (
       SELECT balance.branch_id, batch.variant_id, SUM(balance.remaining_quantity) AS remaining
       FROM inventory_batch batch
       JOIN inventory_batch_balance balance ON balance.batch_id=batch.id
       WHERE batch.variant_id = ANY($1::uuid[])
       GROUP BY balance.branch_id, batch.variant_id
     ) stock ON stock.branch_id = branch.id AND stock.variant_id = variants.variant_id
     LEFT JOIN (
       SELECT DISTINCT branch_id, variant_id
       FROM inventory_discrepancy
       WHERE variant_id = ANY($1::uuid[]) AND unallocated_quantity > 0
     ) held ON held.branch_id = branch.id AND held.variant_id = variants.variant_id
     ORDER BY branch.id, variants.variant_id`, [variantIds],
  );
  for (const row of result.rows) {
    const quantities = byBranch.get(row.branch_id) ?? new Map<string, number>();
    quantities.set(row.variant_id, row.available_quantity);
    byBranch.set(row.branch_id, quantities);
  }
  return byBranch;
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
    branchBalances: row.branch_balances?.map((balance) => ({
      branchId: balance.branch_id,
      availableQuantity: balance.remaining_quantity,
    })) ?? [],
    unitCostPiasters: row.unit_cost_piasters,
    effectiveUnitCostPiasters: row.effective_unit_cost_piasters,
    recordedAt: row.recorded_at,
    receiptId: row.source_receipt_id,
    receiptDate: row.receipt_date,
  };
}

function branchBalancesSql(batchAlias: string): string {
  return `COALESCE((SELECT json_agg(json_build_object('branch_id', balance.branch_id,
    'remaining_quantity', balance.remaining_quantity) ORDER BY balance.branch_id)
    FROM inventory_batch_balance balance WHERE balance.batch_id=${batchAlias}.id), '[]'::json)`;
}

function batchBalanceColumns(batchAlias: string): string {
  return `(SELECT COALESCE(SUM(balance.remaining_quantity),0)::int
    FROM inventory_batch_balance balance WHERE balance.batch_id=${batchAlias}.id) AS remaining_quantity,
    ${branchBalancesSql(batchAlias)} AS branch_balances`;
}

async function assertBatchVariant(client: PoolClient, batchId: string, variantId: string): Promise<{
  unit_cost_piasters: number | string;
  effective_unit_cost_piasters: number | string;
}> {
  const result = await client.query<{
    unit_cost_piasters: number | string;
    effective_unit_cost_piasters: number | string;
  }>(`SELECT unit_cost_piasters,effective_unit_cost_piasters
       FROM inventory_batch WHERE id=$1 AND variant_id=$2 FOR UPDATE`, [batchId, variantId]);
  const row = result.rows[0];
  if (!row) throw new InventoryValidationError("دفعة التكلفة لا تخص المتغير المحدد.");
  return row;
}

async function changeBatchBalance(client: PoolClient, batchId: string, branchId: string, delta: number): Promise<number> {
  const state = await client.query<{ effective_received_quantity: number; remaining_quantity: number; protected_quantity: number }>(
    `SELECT b.effective_received_quantity,
            (SELECT COALESCE(SUM(balance.remaining_quantity),0)::int
             FROM inventory_batch_balance balance WHERE balance.batch_id=b.id) AS remaining_quantity,
            (${activeProtectedQuantitySql("b.id")}) AS protected_quantity
     FROM inventory_batch b WHERE b.id=$1 FOR UPDATE OF b`, [batchId],
  );
  const row = state.rows[0];
  if (!row || row.remaining_quantity + delta < 0
    || row.remaining_quantity + delta > row.effective_received_quantity - row.protected_quantity) {
    throw new InventoryValidationError("تعذر تعديل كمية دفعة التكلفة الأصلية.");
  }
  if (delta > 0) {
    await client.query(
      `INSERT INTO inventory_batch_balance (batch_id,branch_id,remaining_quantity)
       VALUES ($1,$2,$3)
       ON CONFLICT (batch_id,branch_id) DO UPDATE
       SET remaining_quantity=inventory_batch_balance.remaining_quantity+EXCLUDED.remaining_quantity`,
      [batchId, branchId, delta],
    );
  } else if (delta < 0) {
    const decreased = await client.query(
      `UPDATE inventory_batch_balance SET remaining_quantity=remaining_quantity+$3
       WHERE batch_id=$1 AND branch_id=$2 AND remaining_quantity+$3>=0 RETURNING batch_id`,
      [batchId, branchId, delta],
    );
    if (!decreased.rows[0]) throw new InventoryValidationError("الكمية المتاحة في الفرع غير كافية.");
  }
  return row.remaining_quantity + delta;
}

async function getBatchStates(queryable: Queryable, batchIds: string[]): Promise<BatchRecord[]> {
  if (batchIds.length === 0) return [];
  const result = await queryable.query<BatchRow>(
    `SELECT b.id, b.variant_id, b.received_quantity, b.effective_received_quantity,
            ${batchBalanceColumns("b")}, b.unit_cost_piasters, b.effective_unit_cost_piasters,
            b.recorded_at, b.source_receipt_id, b.receipt_date::text AS receipt_date, b.source_line_id
     FROM inventory_batch b
     WHERE b.id = ANY($1::uuid[])
     ORDER BY b.id`,
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
