import type {
  CountCoordinationDeviceDto,
  StockCorrectionBatchEffectDto,
  StockReconciliationCaseDto,
  StockReconciliationDto,
} from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type {
  CountCoordinationRecord,
  InventoryTransaction,
  StockCoordinationStore,
  StockCorrectionRecord,
  StockReconciliationDownstreamFactsPort,
  StockReconciliationSalesPort,
} from "../application/ports.ts";
import {
  CoordinationStaleError,
  InventoryValidationError,
  OperationConflictError,
} from "../domain/errors.ts";

type CoordinationRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  status: CountCoordinationRecord["status"];
  boundary_stock_version: number | string;
  boundary_at: Date;
  expires_at: Date;
  started_by_staff_id: string;
  finished_by_staff_id: string | null;
  finished_at: Date | null;
  finished_operation_id: string | null;
  finished_payload_fingerprint: string | null;
};

type DeviceRow = {
  device_id: string;
  known_snapshot_id: string;
  known_snapshot_at: Date;
  known_stock_version: number | string | null;
  acknowledged_snapshot_id: string | null;
  acknowledged_at: Date | null;
  acknowledged_stock_version: number | string | null;
};

type CorrectionRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  coordination_id: string;
  variant_id: string;
  previous_available_quantity: number;
  corrected_available_quantity: number;
  quantity_delta: number;
  reason: string;
  positive_source_batch_id: string | null;
  changed_by_staff_id: string;
  changed_at: Date;
  boundary_stock_version: number | string;
  boundary_at: Date;
};

type BatchEffectRow = {
  batch_id: string;
  direction: "restore" | "deduct";
  quantity: number;
  unit_cost_piasters: number | string;
  effective_unit_cost_piasters: number | string;
};

type ReconciliationRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  correction_id: string;
  sale_id: string;
  variant_id: string;
  resolution: "included_in_count" | "allocate_missing_source";
  quantity: number;
  previous_available_quantity: number;
  resulting_available_quantity: number;
  resolved_by_staff_id: string;
  resolved_at: Date;
};

export function createPostgresStockCoordinationStore(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
  salesFor: (queryable: Pool | PoolClient) => StockReconciliationSalesPort,
  downstreamFactsFor: (queryable: Pool | PoolClient) => StockReconciliationDownstreamFactsPort,
): StockCoordinationStore {
  return {
    current: () => transaction(pool, async (client) => {
      await expireCoordination(client);
      const current = await loadCurrentCoordination(client);
      return current ? toCoordinationRecord(client, current) : null;
    }),

    start(input) {
      return transaction(pool, async (client) => {
        const inventory = inventoryFor(client);
        await inventory.lockStockClock("update");
        await expireCoordination(client);
        const replay = await coordinationByOperation(client, input.operationId);
        if (replay) {
          if (replay.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
          return { value: await toCoordinationRecord(client, replay), created: false };
        }
        const active = await loadCurrentCoordination(client);
        if (active?.status === "active" && active.expires_at.getTime() > Date.now()) {
          throw new InventoryValidationError("يوجد تنسيق عد نشط بالفعل. أكمله أو ألغِه أولاً.");
        }
        const boundaryStockVersion = await inventory.currentStockVersion();
        const inserted = await client.query<CoordinationRow>(
          `INSERT INTO inventory_count_coordination (
             id, operation_id, payload_fingerprint, status, boundary_stock_version, boundary_at,
             expires_at, started_by_staff_id
           ) VALUES ($1, $2, $3, 'active', $4, now(), $5, $6)
           RETURNING *`,
          [input.id, input.operationId, input.payloadFingerprint, boundaryStockVersion, input.expiresAt, input.actorStaffId],
        );
        await client.query(
          `INSERT INTO inventory_count_coordination_device (
             coordination_id, device_id, known_snapshot_id, known_snapshot_at, known_stock_version
           )
           SELECT $1, device_id, latest_snapshot_id, latest_snapshot_at, stock_version
           FROM inventory_known_till`,
          [input.id],
        );
        return {
          value: await toCoordinationRecord(client, must(inserted.rows[0])),
          created: true,
        };
      });
    },

    acknowledge(input) {
      return transaction(pool, async (client) => {
        const inventory = inventoryFor(client);
        await inventory.lockStockClock("share");
        await expireCoordination(client);
        const coordination = await coordinationById(client, input.coordinationId, true);
        if (!coordination || coordination.status !== "active" || coordination.expires_at.getTime() <= Date.now()) {
          throw new InventoryValidationError("تنسيق العد غير نشط.");
        }
        const till = await client.query<{
          staff_id: string;
          latest_snapshot_id: string;
          latest_snapshot_at: Date;
          stock_version: number | string | null;
          synchronization_complete: boolean;
        }>(
          `SELECT staff_id, latest_snapshot_id, latest_snapshot_at, stock_version, synchronization_complete
           FROM inventory_known_till WHERE device_id = $1 FOR UPDATE`,
          [input.deviceId],
        );
        const state = till.rows[0];
        if (
          !state
          || state.staff_id !== input.actorStaffId
          || state.latest_snapshot_id !== input.snapshotId
          || !state.synchronization_complete
          || state.stock_version === null
          || Number(state.stock_version) !== Number(coordination.boundary_stock_version)
          || state.latest_snapshot_at < coordination.boundary_at
        ) {
          throw new CoordinationStaleError("يجب مزامنة الطابور وإصدار لقطة حديثة عند حد العد قبل تأكيد التوقف.");
        }
        const acknowledged = await client.query<{
          acknowledged_at: Date;
          acknowledged_stock_version: number | string;
        }>(
          `UPDATE inventory_count_coordination_device
           SET acknowledged_snapshot_id = $3, acknowledged_at = now(), acknowledged_stock_version = $4
           WHERE coordination_id = $1 AND device_id = $2
           RETURNING acknowledged_at, acknowledged_stock_version`,
          [input.coordinationId, input.deviceId, input.snapshotId, state.stock_version],
        );
        const row = acknowledged.rows[0];
        if (!row) throw new CoordinationStaleError("نقطة البيع ليست ضمن أجهزة هذا التنسيق.");
        return {
          coordinationId: input.coordinationId,
          deviceId: input.deviceId,
          snapshotId: input.snapshotId,
          acknowledgedAt: row.acknowledged_at.toISOString(),
          acknowledgedStockVersion: Number(row.acknowledged_stock_version),
        };
      });
    },

    cancel(input) {
      return transaction(pool, async (client) => {
        const inventory = inventoryFor(client);
        await inventory.lockStockClock("update");
        await expireCoordination(client);
        const row = await coordinationById(client, input.coordinationId, true);
        if (!row) throw new InventoryValidationError("تنسيق العد غير موجود.");
        if (row.status === "cancelled") {
          if (
            row.finished_operation_id !== input.operationId
            || row.finished_payload_fingerprint !== input.payloadFingerprint
          ) throw new OperationConflictError();
          return toCoordinationRecord(client, row);
        }
        if (row.status !== "active") throw new InventoryValidationError("لا يمكن إلغاء تنسيق عد منتهٍ.");
        const updated = await client.query<CoordinationRow>(
          `UPDATE inventory_count_coordination
           SET status = 'cancelled', finished_operation_id = $2, finished_payload_fingerprint = $3,
               finished_by_staff_id = $4, finished_at = now()
           WHERE id = $1
           RETURNING *`,
          [input.coordinationId, input.operationId, input.payloadFingerprint, input.actorStaffId],
        );
        return toCoordinationRecord(client, must(updated.rows[0]));
      });
    },

    finalize(input) {
      return transaction(pool, async (client) => {
        const inventory = inventoryFor(client);
        await inventory.lockStockClock("update");
        const replay = await correctionByOperation(client, input.operationId);
        if (replay) {
          if (replay.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
          return { value: await toCorrectionRecord(client, replay), created: false };
        }
        await expireCoordination(client);
        const coordination = await coordinationById(client, input.coordinationId, true);
        if (!coordination || coordination.status !== "active" || coordination.expires_at.getTime() <= Date.now()) {
          throw new InventoryValidationError("انتهت مهلة تنسيق العد. ابدأ تنسيقاً جديداً.");
        }
        const missingAcknowledgements = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM inventory_count_coordination_device
           WHERE coordination_id = $1
             AND (acknowledged_snapshot_id IS NULL OR acknowledged_stock_version <> $2)`,
          [coordination.id, coordination.boundary_stock_version],
        );
        if (Number(missingAcknowledgements.rows[0]?.count ?? 0) > 0) {
          throw new InventoryValidationError("لم تؤكد كل نقاط البيع المعروفة المزامنة والتوقف عند حد العد.");
        }
        const currentVersion = await inventory.currentStockVersion();
        if (currentVersion !== Number(coordination.boundary_stock_version)) throw new CoordinationStaleError();
        const quantities = await inventory.quantitiesFor([input.variantId]);
        const previous = quantities.get(input.variantId) ?? 0;
        if (previous !== input.previousAvailableQuantity) throw new CoordinationStaleError();
        const delta = input.correctedAvailableQuantity - previous;
        if (delta === 0) throw new InventoryValidationError("الكمية المصححة تطابق الكمية السابقة.");
        if (delta > 0 && !input.positiveSourceBatchId) {
          throw new InventoryValidationError("يجب تحديد دفعة التكلفة الفعلية عند زيادة المخزون.");
        }
        if (delta < 0 && input.positiveSourceBatchId) {
          throw new InventoryValidationError("لا تُستخدم دفعة مصدر عند خفض المخزون.");
        }
        const claimed = await inventory.claimStockCorrectionOperation({
          operationId: input.operationId,
          payloadFingerprint: input.payloadFingerprint,
          actorStaffId: input.actorStaffId,
        });
        if (claimed.kind === "replay") {
          const existing = await correctionByOperation(client, input.operationId);
          if (!existing) throw new OperationConflictError();
          return { value: await toCorrectionRecord(client, existing), created: false };
        }
        const effects: StockCorrectionBatchEffectDto[] = [];
        if (delta < 0) {
          const allocation = await inventory.allocateCorrectionFromOldestAvailable({
            operationId: input.operationId,
            variantId: input.variantId,
            quantity: -delta,
            recordedAt: claimed.recordedAt,
          });
          for (const row of allocation.allocations) effects.push({
            batchId: row.batchId,
            direction: "deduct",
            quantity: row.quantity,
            unitCostPiasters: row.unitCostPiasters,
            effectiveUnitCostPiasters: row.effectiveUnitCostPiasters,
          });
        } else {
          const source = await inventory.adjustCorrectionBatch({
            operationId: input.operationId,
            batchId: input.positiveSourceBatchId!,
            variantId: input.variantId,
            direction: "restore",
            quantity: delta,
            recordedAt: claimed.recordedAt,
          });
          effects.push({
            batchId: input.positiveSourceBatchId!,
            direction: "restore",
            quantity: delta,
            ...source,
          });
        }
        const resultingAvailable = (await inventory.quantitiesFor([input.variantId])).get(input.variantId) ?? 0;
        if (resultingAvailable !== input.correctedAvailableQuantity) {
          throw new InventoryValidationError("لا يمكن إثبات الكمية المصححة مع وجود فرق مخزون غير محلول.");
        }
        await client.query(
          `INSERT INTO inventory_stock_correction (
             id, operation_id, coordination_id, variant_id, previous_available_quantity,
             corrected_available_quantity, quantity_delta, reason, positive_source_batch_id,
             changed_by_staff_id, changed_at, boundary_stock_version, boundary_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            input.id, input.operationId, input.coordinationId, input.variantId,
            previous, input.correctedAvailableQuantity, delta, input.reason,
            input.positiveSourceBatchId, input.actorStaffId, claimed.recordedAt,
            coordination.boundary_stock_version, coordination.boundary_at,
          ],
        );
        for (const effect of effects) await client.query(
          `INSERT INTO inventory_stock_correction_batch (
             correction_id, batch_id, direction, quantity, unit_cost_piasters, effective_unit_cost_piasters
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [input.id, effect.batchId, effect.direction, effect.quantity, effect.unitCostPiasters, effect.effectiveUnitCostPiasters],
        );
        await client.query(
          `UPDATE inventory_count_coordination
           SET status = 'completed', finished_operation_id = $2, finished_payload_fingerprint = $3,
               finished_by_staff_id = $4, finished_at = $5
           WHERE id = $1`,
          [input.coordinationId, input.operationId, input.payloadFingerprint, input.actorStaffId, claimed.recordedAt],
        );
        await inventory.bumpStockVersion();
        const created = await correctionByOperation(client, input.operationId);
        if (!created) throw new Error("Stock correction could not be loaded.");
        return { value: await toCorrectionRecord(client, created), created: true };
      });
    },

    async listCorrections() {
      const rows = await pool.query<CorrectionRow & { payload_fingerprint: string }>(
        `SELECT c.*, o.payload_fingerprint
         FROM inventory_stock_correction c
         JOIN inventory_operation o ON o.id = c.operation_id
         ORDER BY c.changed_at DESC, c.id DESC`,
      );
      return Promise.all(rows.rows.map((row) => toCorrectionRecord(pool, row)));
    },

    async listReconciliations() {
      const rows = await pool.query<ReconciliationRow>(
        `SELECT r.*, o.payload_fingerprint
         FROM inventory_stock_reconciliation r
         JOIN inventory_operation o ON o.id = r.operation_id
         ORDER BY r.resolved_at DESC, r.id DESC`,
      );
      return Promise.all(rows.rows.map((row) => toReconciliationRecord(pool, row)));
    },

    async listReconciliationCases() {
      const corrections = await pool.query<CorrectionRow>(
        `SELECT c.*, o.payload_fingerprint
         FROM inventory_stock_correction c
         JOIN inventory_operation o ON o.id = c.operation_id
         WHERE c.quantity_delta < 0
         ORDER BY c.changed_at DESC, c.id DESC`,
      );
      const cases: StockReconciliationCaseDto[] = [];
      const sales = salesFor(pool);
      for (const correction of corrections.rows) {
        const late = await sales.listRecordedAfter(correction.changed_at);
        const restored = await pool.query<{ quantity: string | number }>(
          `SELECT COALESCE(SUM(r.quantity), 0) AS quantity
           FROM inventory_stock_reconciliation r
           WHERE r.correction_id = $1 AND r.resolution = 'included_in_count'`,
          [correction.id],
        );
        const correctionRemaining = -correction.quantity_delta - Number(restored.rows[0]?.quantity ?? 0);
        for (const sale of late) {
          if (!sale.sourceDeviceId || !sale.sourceSnapshotId || !sale.sourceSnapshotIssuedAt) continue;
          const lines = sale.lines.filter((line) => line.variantId === correction.variant_id);
          if (lines.length === 0) continue;
          const counted = await pool.query<{ quantity: string | number }>(
            `SELECT COALESCE(SUM(quantity), 0) AS quantity
             FROM inventory_stock_reconciliation
             WHERE sale_id = $1 AND variant_id = $2
               AND resolution = 'included_in_count'`,
            [sale.id, correction.variant_id],
          );
          const soldQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
          const allocatedQuantity = lines.reduce((sum, line) => sum + line.allocatedQuantity, 0);
          const unallocatedQuantity = lines.reduce((sum, line) => sum + line.unallocatedQuantity, 0);
          const alreadyCountedQuantity = Number(counted.rows[0]?.quantity ?? 0);
          cases.push({
            correctionId: correction.id,
            saleId: sale.id,
            saleOperationId: sale.operationId,
            variantId: correction.variant_id,
            deviceId: sale.sourceDeviceId,
            sourceSnapshotId: sale.sourceSnapshotId,
            sourceSnapshotIssuedAt: sale.sourceSnapshotIssuedAt.toISOString(),
            occurredAt: sale.occurredAt.toISOString(),
            recordedAt: sale.recordedAt.toISOString(),
            boundaryAt: correction.changed_at.toISOString(),
            timing: sale.occurredAt <= correction.changed_at && sale.sourceSnapshotIssuedAt <= correction.changed_at
              ? "before_count"
              : "after_count",
            soldQuantity,
            allocatedQuantity,
            unallocatedQuantity,
            costsIncomplete: sale.costsIncomplete,
            alreadyCountedQuantity,
            maximumCountedQuantity: Math.max(0, Math.min(
              soldQuantity - alreadyCountedQuantity,
              correctionRemaining,
            )),
          });
        }
      }
      return cases;
    },

    reconcile(input) {
      return transaction(pool, async (client) => {
        const inventory = inventoryFor(client);
        const sales = salesFor(client);
        const downstreamFacts = downstreamFactsFor(client);
        await inventory.lockStockClock("update");
        const replay = await reconciliationByOperation(client, input.operationId);
        if (replay) {
          if (replay.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
          return { value: await toReconciliationRecord(client, replay), created: false };
        }
        await inventory.assertStockMutationAllowed();
        const correction = await correctionById(client, input.correctionId, true);
        if (!correction || correction.variant_id !== input.variantId) {
          throw new InventoryValidationError("تصحيح الكمية المحدد غير موجود.");
        }
        const sale = await sales.getById(input.saleId, true);
        if (!sale || !sale.sourceDeviceId || sale.recordedAt <= correction.changed_at) {
          throw new InventoryValidationError("البيع المحدد ليس حركة متأخرة بعد هذا التصحيح.");
        }
        const saleLines = sale.lines.filter((line) => line.variantId === input.variantId);
        if (saleLines.length === 0) throw new InventoryValidationError("المتغير المحدد غير موجود في البيع المتأخر.");
        const claimed = await inventory.claimStockCorrectionOperation({
          operationId: input.operationId,
          payloadFingerprint: input.payloadFingerprint,
          actorStaffId: input.actorStaffId,
          kind: "stock_reconciliation",
        });
        if (claimed.kind === "replay") throw new OperationConflictError();
        const previousAvailableQuantity = (await inventory.quantitiesFor([input.variantId])).get(input.variantId) ?? 0;
        const effects: Array<Omit<StockCorrectionBatchEffectDto, "direction"> & { direction: "restore" | "allocate" }> = [];
        if (input.resolution === "included_in_count") {
          if (
            sale.occurredAt > correction.changed_at
            || !sale.sourceSnapshotIssuedAt
            || sale.sourceSnapshotIssuedAt > correction.changed_at
          ) {
            throw new InventoryValidationError("هذا البيع أو لقطة مصدره حدثا بعد حد العد ولا يمكن اعتباره داخلاً في العدد الفعلي.");
          }
          if (await downstreamFacts.hasDownstreamFacts(input.saleId, saleLines.map((line) => line.id))) {
            throw new InventoryValidationError("لا يمكن تغيير إسناد دفعات هذا البيع بعد تسجيل إرجاع أو تصحيح مرتبط. راجع الحالة يدوياً دون تغيير المخزون.");
          }
          const priorSale = await client.query<{ quantity: string | number }>(
            `SELECT COALESCE(SUM(quantity), 0) AS quantity
             FROM inventory_stock_reconciliation
             WHERE sale_id = $1 AND variant_id = $2
               AND resolution = 'included_in_count'`,
            [input.saleId, input.variantId],
          );
          const saleRemaining = saleLines.reduce((sum, line) => sum + line.quantity, 0)
            - Number(priorSale.rows[0]?.quantity ?? 0);
          if (input.quantity > saleRemaining) {
            throw new InventoryValidationError("كمية المصالحة تتجاوز أثر البيع غير المصالح.");
          }
          const correctionEffects = await client.query<BatchEffectRow>(
            `SELECT b.batch_id, b.direction, b.quantity, b.unit_cost_piasters, b.effective_unit_cost_piasters
             FROM inventory_stock_correction_batch b
             JOIN inventory_batch source ON source.id = b.batch_id
             WHERE b.correction_id = $1 AND b.direction = 'deduct'
             ORDER BY source.recorded_at, source.id
             FOR UPDATE`,
            [input.correctionId],
          );
          const unallocatedToAttribute = Math.min(
            input.quantity,
            saleLines.reduce((sum, line) => sum + line.unallocatedQuantity, 0),
          );
          let allocatedToReassign = input.quantity - unallocatedToAttribute;
          const existingAllocations = (await inventory.listAllocations(sale.operationId))
            .filter((allocation) => allocation.variantId === input.variantId);
          const priorAttributed = await client.query<{ batch_id: string; quantity: string | number }>(
            `SELECT rb.batch_id, SUM(rb.quantity) AS quantity
             FROM inventory_stock_reconciliation_batch rb
             JOIN inventory_stock_reconciliation r ON r.id = rb.reconciliation_id
             WHERE r.sale_id = $1 AND r.variant_id = $2
               AND r.resolution = 'included_in_count' AND rb.direction = 'allocate'
             GROUP BY rb.batch_id`,
            [input.saleId, input.variantId],
          );
          const excludedByBatch = new Map(priorAttributed.rows.map((row) => [row.batch_id, Number(row.quantity)]));
          for (const allocation of existingAllocations) {
            if (allocatedToReassign === 0) break;
            const excluded = excludedByBatch.get(allocation.batchId) ?? 0;
            const usable = Math.max(0, allocation.quantity - excluded);
            excludedByBatch.set(allocation.batchId, Math.max(0, excluded - allocation.quantity));
            const quantity = Math.min(allocatedToReassign, usable);
            if (quantity === 0) continue;
            await inventory.removeAllocation({
              operationId: sale.operationId,
              batchId: allocation.batchId,
              variantId: input.variantId,
              quantity,
            });
            const costs = await inventory.adjustCorrectionBatch({
              operationId: input.operationId,
              batchId: allocation.batchId,
              variantId: input.variantId,
              direction: "restore",
              quantity,
              recordedAt: claimed.recordedAt,
            });
            effects.push({ batchId: allocation.batchId, direction: "restore", quantity, ...costs });
            allocatedToReassign -= quantity;
          }
          if (allocatedToReassign > 0) {
            throw new InventoryValidationError("تعذر إثبات دفعات تكلفة البيع السابقة لإعادة إسنادها.");
          }
          let sourceRemaining = input.quantity;
          for (const effect of correctionEffects.rows) {
            if (sourceRemaining === 0) break;
            const prior = await client.query<{ quantity: string | number }>(
              `SELECT COALESCE(SUM(rb.quantity), 0) AS quantity
               FROM inventory_stock_reconciliation_batch rb
               JOIN inventory_stock_reconciliation r ON r.id = rb.reconciliation_id
               WHERE r.correction_id = $1 AND rb.batch_id = $2
                 AND rb.direction = 'allocate'`,
              [input.correctionId, effect.batch_id],
            );
            const capacity = effect.quantity - Number(prior.rows[0]?.quantity ?? 0);
            const attributed = Math.min(sourceRemaining, capacity);
            if (attributed > 0) {
              const allocation = await inventory.attributeHeldAllocation({
                operationId: sale.operationId,
                batchId: effect.batch_id,
                variantId: input.variantId,
                quantity: attributed,
                recordedAt: claimed.recordedAt,
              });
              effects.push({
                batchId: allocation.batchId,
                direction: "allocate",
                quantity: allocation.quantity,
                unitCostPiasters: allocation.unitCostPiasters,
                effectiveUnitCostPiasters: allocation.effectiveUnitCostPiasters,
              });
              sourceRemaining -= attributed;
            }
          }
          if (sourceRemaining > 0) {
            throw new InventoryValidationError("تصحيح العد لا يحتوي أثراً سالباً كافياً لهذه المصالحة.");
          }
          if (unallocatedToAttribute > 0) {
            await inventory.resolveDiscrepancy({
              operationId: sale.operationId,
              variantId: input.variantId,
              allocatedQuantity: unallocatedToAttribute,
            });
            await sales.applyAllocatedRemainder({
              saleId: input.saleId,
              variantId: input.variantId,
              quantity: unallocatedToAttribute,
            });
          }
        } else {
          const unallocated = saleLines.reduce((sum, line) => sum + line.unallocatedQuantity, 0);
          if (input.quantity > unallocated) {
            throw new InventoryValidationError("كمية المصالحة تتجاوز الكمية غير المخصصة في البيع.");
          }
          const allocated = await inventory.allocateHeldFromOldestAvailable({
            operationId: sale.operationId,
            variantId: input.variantId,
            quantity: input.quantity,
            recordedAt: claimed.recordedAt,
          });
          await inventory.resolveDiscrepancy({
            operationId: sale.operationId,
            variantId: input.variantId,
            allocatedQuantity: input.quantity,
          });
          await sales.applyAllocatedRemainder({
            saleId: input.saleId,
            variantId: input.variantId,
            quantity: input.quantity,
          });
          for (const row of allocated.allocations) effects.push({
            batchId: row.batchId,
            direction: "allocate",
            quantity: row.quantity,
            unitCostPiasters: row.unitCostPiasters,
            effectiveUnitCostPiasters: row.effectiveUnitCostPiasters,
          });
        }
        const resultingAvailableQuantity = (await inventory.quantitiesFor([input.variantId])).get(input.variantId) ?? 0;
        await client.query(
          `INSERT INTO inventory_stock_reconciliation (
             id, operation_id, correction_id, sale_id, variant_id, resolution, quantity,
             previous_available_quantity, resulting_available_quantity, resolved_by_staff_id,
             resolved_at, payload_fingerprint
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            input.id, input.operationId, input.correctionId, input.saleId, input.variantId,
            input.resolution, input.quantity, previousAvailableQuantity, resultingAvailableQuantity,
            input.actorStaffId, claimed.recordedAt, input.payloadFingerprint,
          ],
        );
        for (const effect of effects) await client.query(
          `INSERT INTO inventory_stock_reconciliation_batch (
             reconciliation_id, batch_id, direction, quantity, unit_cost_piasters, effective_unit_cost_piasters
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (reconciliation_id, batch_id, direction) DO UPDATE
           SET quantity = inventory_stock_reconciliation_batch.quantity + EXCLUDED.quantity`,
          [input.id, effect.batchId, effect.direction, effect.quantity, effect.unitCostPiasters, effect.effectiveUnitCostPiasters],
        );
        await inventory.bumpStockVersion();
        const created = await reconciliationByOperation(client, input.operationId);
        if (!created) throw new Error("Stock reconciliation could not be loaded.");
        return { value: await toReconciliationRecord(client, created), created: true };
      });
    },
  };
}

async function expireCoordination(client: PoolClient): Promise<void> {
  await client.query(
    `UPDATE inventory_count_coordination
     SET status = 'expired', finished_at = expires_at, finished_by_staff_id = started_by_staff_id
     WHERE status = 'active' AND expires_at <= now()`,
  );
}

async function loadCurrentCoordination(client: PoolClient): Promise<CoordinationRow | null> {
  const result = await client.query<CoordinationRow>(
    `SELECT * FROM inventory_count_coordination ORDER BY boundary_at DESC, id DESC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

async function coordinationByOperation(client: PoolClient, operationId: string): Promise<CoordinationRow | null> {
  const result = await client.query<CoordinationRow>(
    `SELECT * FROM inventory_count_coordination WHERE operation_id = $1`,
    [operationId],
  );
  return result.rows[0] ?? null;
}

async function coordinationById(client: PoolClient, id: string, lock = false): Promise<CoordinationRow | null> {
  const result = await client.query<CoordinationRow>(
    `SELECT * FROM inventory_count_coordination WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function loadDevices(queryable: Pick<Pool, "query"> | PoolClient, id: string): Promise<CountCoordinationDeviceDto[]> {
  const result = await queryable.query<DeviceRow>(
    `SELECT * FROM inventory_count_coordination_device
     WHERE coordination_id = $1 ORDER BY known_snapshot_at, device_id`,
    [id],
  );
  return result.rows.map((row) => ({
    deviceId: row.device_id,
    knownSnapshotId: row.known_snapshot_id,
    knownSnapshotAt: row.known_snapshot_at.toISOString(),
    knownStockVersion: row.known_stock_version === null ? null : Number(row.known_stock_version),
    acknowledgedSnapshotId: row.acknowledged_snapshot_id,
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
    acknowledgedStockVersion: row.acknowledged_stock_version === null ? null : Number(row.acknowledged_stock_version),
  }));
}

async function toCoordinationRecord(
  queryable: Pick<Pool, "query"> | PoolClient,
  row: CoordinationRow,
): Promise<CountCoordinationRecord> {
  return {
    id: row.id,
    operationId: row.operation_id,
    status: row.status,
    boundaryStockVersion: Number(row.boundary_stock_version),
    boundaryAt: row.boundary_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    startedByStaffId: row.started_by_staff_id,
    finishedByStaffId: row.finished_by_staff_id,
    finishedAt: row.finished_at?.toISOString() ?? null,
    devices: await loadDevices(queryable, row.id),
  };
}

async function correctionByOperation(
  queryable: Pick<Pool, "query"> | PoolClient,
  operationId: string,
): Promise<CorrectionRow | null> {
  const result = await queryable.query<CorrectionRow>(
    `SELECT c.*, o.payload_fingerprint
     FROM inventory_stock_correction c
     JOIN inventory_operation o ON o.id = c.operation_id
     WHERE c.operation_id = $1`,
    [operationId],
  );
  return result.rows[0] ?? null;
}

async function correctionById(
  queryable: Pick<Pool, "query"> | PoolClient,
  id: string,
  lock = false,
): Promise<CorrectionRow | null> {
  const result = await queryable.query<CorrectionRow>(
    `SELECT c.*, o.payload_fingerprint
     FROM inventory_stock_correction c
     JOIN inventory_operation o ON o.id = c.operation_id
     WHERE c.id = $1${lock ? " FOR UPDATE OF c" : ""}`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function reconciliationByOperation(
  queryable: Pick<Pool, "query"> | PoolClient,
  operationId: string,
): Promise<ReconciliationRow | null> {
  const result = await queryable.query<ReconciliationRow>(
    `SELECT * FROM inventory_stock_reconciliation WHERE operation_id = $1`,
    [operationId],
  );
  return result.rows[0] ?? null;
}

async function toReconciliationRecord(
  queryable: Pick<Pool, "query"> | PoolClient,
  row: ReconciliationRow,
): Promise<Omit<StockReconciliationDto, "resolvedBy"> & { resolvedByStaffId: string }> {
  const effects = await queryable.query<BatchEffectRow & { direction: "restore" | "allocate" }>(
    `SELECT batch_id, direction, quantity, unit_cost_piasters, effective_unit_cost_piasters
     FROM inventory_stock_reconciliation_batch
     WHERE reconciliation_id = $1
     ORDER BY batch_id, direction`,
    [row.id],
  );
  return {
    id: row.id,
    operationId: row.operation_id,
    correctionId: row.correction_id,
    saleId: row.sale_id,
    variantId: row.variant_id,
    resolution: row.resolution,
    quantity: row.quantity,
    previousAvailableQuantity: row.previous_available_quantity,
    resultingAvailableQuantity: row.resulting_available_quantity,
    resolvedByStaffId: row.resolved_by_staff_id,
    resolvedAt: row.resolved_at.toISOString(),
    batches: effects.rows.map((effect) => ({
      batchId: effect.batch_id,
      direction: effect.direction,
      quantity: effect.quantity,
      unitCostPiasters: Number(effect.unit_cost_piasters),
      effectiveUnitCostPiasters: Number(effect.effective_unit_cost_piasters),
    })),
  };
}

async function toCorrectionRecord(
  queryable: Pick<Pool, "query"> | PoolClient,
  row: CorrectionRow,
): Promise<StockCorrectionRecord> {
  const effects = await queryable.query<BatchEffectRow>(
    `SELECT batch_id, direction, quantity, unit_cost_piasters, effective_unit_cost_piasters
     FROM inventory_stock_correction_batch WHERE correction_id = $1 ORDER BY batch_id`,
    [row.id],
  );
  return {
    id: row.id,
    operationId: row.operation_id,
    coordinationId: row.coordination_id,
    variantId: row.variant_id,
    previousAvailableQuantity: row.previous_available_quantity,
    correctedAvailableQuantity: row.corrected_available_quantity,
    quantityDelta: row.quantity_delta,
    reason: row.reason,
    positiveSourceBatchId: row.positive_source_batch_id,
    changedByStaffId: row.changed_by_staff_id,
    changedAt: row.changed_at.toISOString(),
    boundaryStockVersion: Number(row.boundary_stock_version),
    coordinationBoundaryAt: row.boundary_at.toISOString(),
    boundaryAt: row.changed_at.toISOString(),
    devices: await loadDevices(queryable, row.coordination_id),
    batches: effects.rows.map((effect) => ({
      batchId: effect.batch_id,
      direction: effect.direction,
      quantity: effect.quantity,
      unitCostPiasters: Number(effect.unit_cost_piasters),
      effectiveUnitCostPiasters: Number(effect.effective_unit_cost_piasters),
    })),
  };
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected PostgreSQL row.");
  return value;
}
