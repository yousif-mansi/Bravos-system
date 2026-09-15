import type {
  CorrectionChangeDto, CorrectionMerchandiseFactDto, ReturnCorrectionDetailDto,
  ReturnCorrectionLineDto, SaleCorrectionDetailDto, SaleCorrectionLineDto, VariantIdentityDto,
} from "@bravos/contracts";
import type { InventoryTransaction } from "@bravos/inventory";
import { InventoryValidationError, OperationConflictError } from "@bravos/inventory";
import type { Pool, PoolClient } from "pg";
import { CorrectionsValidationError } from "../domain/errors.ts";
import type {
  ChangeResult, CorrectionsRepository, MerchandiseAdjustmentWrite,
  ReturnCorrectionWrite, SaleCorrectionWrite,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type Target = "sale" | "return";

type SaleRow = {
  id: string;
  operation_id: string;
  final_total_piasters: number | string;
  cash_received_piasters: number | string;
  physically_completed: boolean;
};
type ReturnRow = { id: string; source_sale_id: string; status: "draft" | "posted"; authorized_refund_piasters: number | string; refund_paid_piasters: number | string; exchange_credit_applied_piasters: number | string };
type LineRow = {
  id: string; source_sale_line_id?: string; variant_id: string; quantity: number;
  paid_piasters?: number | string;
  sellable_quantity?: number; product_id: string; product_code: string; product_name_ar: string;
  size_id: string; size_name_ar: string; color_id: string; color_name_ar: string;
};
type CorrectionRow = {
  id: string; operation_id: string; target_type: Target; sale_id: string | null; return_id: string | null;
  change_type: "correction" | "cancellation"; revision: number; reason: string;
  effective_total_piasters: number | string | null; cash_direction: "paid_out" | "recovered" | null;
  cash_amount_piasters: number | string; changed_by_staff_id: string; changed_by_display_name: string; changed_at: Date;
  payload_fingerprint: string;
};
type FactRow = {
  correction_id: string; line_id: string; variant_id: string; batch_id: string;
  direction: "restore" | "deduct"; quantity: number; unit_cost_piasters: number | string;
  effective_unit_cost_piasters: number | string;
};
type BatchBalance = { batch_id: string; variant_id: string; unit_cost_piasters: number | string; balance: number | string; recorded_at: Date };

export function createPostgresCorrectionsRepository(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
): CorrectionsRepository {
  return {
    getSale: (saleId, revision) => loadSale(pool, saleId, revision),
    getReturn: (returnId, revision) => loadReturn(pool, returnId, revision),
    changeSale: (input) => transaction(pool, async (client) => changeSale(client, inventoryFor(client), input)),
    changeReturn: (input) => transaction(pool, async (client) => changeReturn(client, inventoryFor(client), input)),
  };
}

export function createPostgresReturnCorrectionStateReader(queryable: Queryable) {
  return {
    async getEffectiveReturn(returnId: string) {
      const detail = await loadReturn(queryable, returnId);
      if (!detail) return null;
      return {
        revision: detail.revision,
        status: detail.status,
        authorizedRefundPiasters: detail.effective?.authorizedRefundPiasters ?? null,
        paidPiasters: detail.actual.netRefundPaidPiasters,
        lines: detail.effective?.lines.map((line) => ({
          returnLineId: line.returnLineId,
          quantity: line.quantity,
          sellableQuantity: line.sellableQuantity,
        })) ?? null,
      };
    },
  };
}

async function changeSale(client: PoolClient, inventory: InventoryTransaction, input: SaleCorrectionWrite): Promise<ChangeResult<SaleCorrectionDetailDto>> {
  await inventory.lockStockClock("update");
  const locked = await client.query<SaleRow>(`SELECT id, operation_id, final_total_piasters, cash_received_piasters, physically_completed FROM sales_sale WHERE id = $1 FOR UPDATE`, [input.saleId]);
  if (!locked.rows[0]?.physically_completed) return { kind: "not-found" };
  const existingOperation = await correctionByOperation(client, input.operationId);
  if (existingOperation) return replaySale(client, input, existingOperation);
  const current = await loadSale(client, input.saleId);
  if (!current) return { kind: "not-found" };
  if (current.revision !== input.expectedRevision) return { kind: "stale" };
  if (!current.effective) throw new CorrectionsValidationError("لا يمكن إضافة إجراء جديد إلى بيع أُلغي بالفعل.");
  const nextRevision = current.revision + 1;
  const originalIds = new Set(current.original.lines.map((line) => line.saleLineId));
  const merchandise = validateMerchandise(input.merchandise, originalIds);
  let effectiveLines = input.effective?.lines ?? [];
  if (input.type === "correction") {
    const effective = input.effective!;
    assertExactLines(effective.lines.map((line) => line.lineId), originalIds, "يجب إدخال كل أسطر البيع مرة واحدة.");
    if (!effective.lines.some((line) => line.quantity > 0)) throw new CorrectionsValidationError("استخدم الإلغاء إذا لم يتبق أي صنف فعال في البيع.");
    const currentById = new Map((current.effective?.lines ?? []).map((line) => [line.saleLineId, line]));
    const adjustmentById = signedAdjustments(merchandise);
    for (const line of effective.lines) {
      const previous = currentById.get(line.lineId);
      if (!previous) throw new CorrectionsValidationError("لا يمكن تصحيح بيع ملغى إلا بإدخال واقعة جديدة منفصلة.");
      if ((adjustmentById.get(line.lineId) ?? 0) !== previous.quantity - line.quantity) {
        throw new CorrectionsValidationError("يجب أن تطابق حركة البضاعة الفعلية فرق كمية البيع المسجلة.");
      }
      const returned = await effectiveReturnedForLine(client, line.lineId, null);
      if (line.quantity < returned) throw new CorrectionsValidationError("لا يمكن خفض كمية البيع عن الكمية المرتجعة فعلياً. صحح الإرجاع أولاً.");
    }
    effectiveLines = effective.lines.map((line) => {
      const previous = currentById.get(line.lineId);
      return previous && previous.quantity === line.quantity && previous.paidPiasters === line.paidPiasters
        ? { ...line, paidRanges: previous.paidRanges }
        : line;
    });
  } else {
    const linkedReturn = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM returns_return r
         LEFT JOIN LATERAL (
           SELECT c.change_type FROM recording_correction c
           WHERE c.return_id = r.id ORDER BY c.revision DESC LIMIT 1
         ) latest ON true
         WHERE r.source_sale_id = $1
           AND (r.status = 'draft' OR latest.change_type IS DISTINCT FROM 'cancellation')
       ) AS present`, [input.saleId]);
    if (linkedReturn.rows[0]?.present) {
      throw new CorrectionsValidationError("لا يمكن إلغاء بيع مرتبط بمسودة أو سجل إرجاع. عالج سجل الإرجاع أولاً.");
    }
  }
  const claimed = await inventory.claimCorrectionOperation({ operationId: input.operationId, payloadFingerprint: input.payloadFingerprint, actorStaffId: input.actorStaffId });
  if (claimed.kind === "replay") return replaySale(client, input);
  const facts = await applySaleMovements(client, inventory, input.saleId, input.operationId, claimed.recordedAt, merchandise);
  await insertCorrection(client, input, nextRevision, input.effective?.finalTotalPiasters ?? null);
  if (input.effective) {
    for (const line of effectiveLines) await client.query(
      `INSERT INTO recording_sale_line_value (correction_id, sale_line_id, quantity, paid_piasters) VALUES ($1, $2, $3, $4)`,
      [input.correctionId, line.lineId, line.quantity, line.paidPiasters],
    );
    for (const line of effectiveLines) {
      for (const [unitIndex, range] of line.paidRanges.entries()) await client.query(
        `INSERT INTO recording_sale_unit_value (
           id, correction_id, sale_line_id, unit_index, quantity, paid_unit_piasters
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [input.correctionId, line.lineId, unitIndex, range.quantity, range.paidUnitPiasters],
      );
    }
  }
  await insertFacts(client, input.correctionId, "sale", facts);
  if (facts.length > 0) await inventory.bumpStockVersion();
  return { kind: "created", value: must(await loadSale(client, input.saleId, nextRevision)) };
}

async function changeReturn(client: PoolClient, inventory: InventoryTransaction, input: ReturnCorrectionWrite): Promise<ChangeResult<ReturnCorrectionDetailDto>> {
  const locator = await client.query<{ source_sale_id: string }>(`SELECT source_sale_id FROM returns_return WHERE id = $1`, [input.returnId]);
  const sourceSaleId = locator.rows[0]?.source_sale_id;
  if (!sourceSaleId) return { kind: "not-found" };
  await inventory.lockStockClock("update");
  await client.query(`SELECT id FROM sales_sale WHERE id = $1 FOR UPDATE`, [sourceSaleId]);
  const locked = await client.query<ReturnRow>(`SELECT id, source_sale_id, status, authorized_refund_piasters, refund_paid_piasters, exchange_credit_applied_piasters FROM returns_return WHERE id = $1 FOR UPDATE`, [input.returnId]);
  if (locked.rows[0]?.status !== "posted") return { kind: "not-found" };
  const existingOperation = await correctionByOperation(client, input.operationId);
  if (existingOperation) return replayReturn(client, input, existingOperation);
  const current = await loadReturn(client, input.returnId);
  if (!current) return { kind: "not-found" };
  if (current.revision !== input.expectedRevision) return { kind: "stale" };
  if (!current.effective) throw new CorrectionsValidationError("لا يمكن إضافة إجراء جديد إلى إرجاع أُلغي بالفعل.");
  const nextRevision = current.revision + 1;
  const originalIds = new Set(current.original.lines.map((line) => line.returnLineId));
  const merchandise = validateMerchandise(input.merchandise, originalIds);
  const currentById = new Map((current.effective?.lines ?? []).map((line) => [line.returnLineId, line]));
  if (input.type === "correction") {
    const effective = input.effective!;
    assertExactLines(effective.lines.map((line) => line.lineId), originalIds, "يجب إدخال كل أسطر الإرجاع مرة واحدة.");
    if (!effective.lines.some((line) => line.quantity > 0)) throw new CorrectionsValidationError("استخدم الإلغاء إذا لم يتبق أي صنف فعال في الإرجاع.");
    const adjustmentById = signedAdjustments(merchandise);
    for (const line of effective.lines) {
      const previous = currentById.get(line.lineId);
      const original = current.original.lines.find((item) => item.returnLineId === line.lineId)!;
      if (!previous) throw new CorrectionsValidationError("لا يمكن تصحيح إرجاع ملغى إلا بإدخال واقعة جديدة منفصلة.");
      if ((adjustmentById.get(line.lineId) ?? 0) !== line.sellableQuantity - previous.sellableQuantity) {
        throw new CorrectionsValidationError("يجب أن تطابق حركة البضاعة الفعلية فرق الكمية القابلة للبيع.");
      }
      const saleQuantity = await effectiveSaleQuantity(client, original.sourceSaleLineId);
      const otherReturns = await effectiveReturnedForLine(client, original.sourceSaleLineId, input.returnId);
      if (line.quantity + otherReturns > saleQuantity) throw new CorrectionsValidationError("الكمية المرتجعة تتجاوز كمية البيع الفعالة بعد احتساب المرتجعات السابقة.");
    }
  }
  const movementPlans = new Map<string, PlannedBatch[]>();
  for (const entry of merchandise) {
    const previous = currentById.get(entry.lineId);
    if (!previous) throw new CorrectionsValidationError("سطر الإرجاع الفعال غير موجود.");
    const targetSellable = previous.sellableQuantity + entry.quantityDelta;
    const maximumQuantity = input.type === "correction"
      ? input.effective!.lines.find((line) => line.lineId === entry.lineId)!.quantity
      : previous.quantity;
    if (targetSellable < 0 || targetSellable > maximumQuantity) {
      throw new CorrectionsValidationError("حركة المخزون الفعلية لا تطابق وحدات الإرجاع المحتفظ بها.");
    }
    movementPlans.set(entry.lineId, await exactReturnMovementBatches(
      client,
      input.returnId,
      entry.lineId,
      previous.sellableQuantity,
      targetSellable,
    ));
  }
  if (input.cash?.direction === "recovered" && input.cash.amountPiasters > current.actual.netRefundPaidPiasters) {
    throw new CorrectionsValidationError("لا يمكن تسجيل استرداد نقدي أكبر من المبلغ المدفوع فعلياً للعميل.");
  }
  const claimed = await inventory.claimCorrectionOperation({ operationId: input.operationId, payloadFingerprint: input.payloadFingerprint, actorStaffId: input.actorStaffId });
  if (claimed.kind === "replay") return replayReturn(client, input);
  const facts = await applyReturnMovements(inventory, input.operationId, claimed.recordedAt, merchandise, movementPlans);
  await insertCorrection(client, input, nextRevision, input.effective?.authorizedRefundPiasters ?? null);
  if (input.effective) {
    for (const line of input.effective.lines) await client.query(
      `INSERT INTO recording_return_line_value (correction_id, return_line_id, quantity, sellable_quantity) VALUES ($1, $2, $3, $4)`,
      [input.correctionId, line.lineId, line.quantity, line.sellableQuantity],
    );
  }
  await insertFacts(client, input.correctionId, "return", facts);
  if (facts.length > 0) await inventory.bumpStockVersion();
  return { kind: "created", value: must(await loadReturn(client, input.returnId, nextRevision)) };
}

async function replaySale(client: PoolClient, input: SaleCorrectionWrite, known?: CorrectionRow): Promise<ChangeResult<SaleCorrectionDetailDto>> {
  const row = known ?? await correctionByOperation(client, input.operationId);
  if (!row || row.target_type !== "sale" || row.sale_id !== input.saleId || row.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
  return { kind: "replay", value: must(await loadSale(client, input.saleId, row.revision)) };
}
async function replayReturn(client: PoolClient, input: ReturnCorrectionWrite, known?: CorrectionRow): Promise<ChangeResult<ReturnCorrectionDetailDto>> {
  const row = known ?? await correctionByOperation(client, input.operationId);
  if (!row || row.target_type !== "return" || row.return_id !== input.returnId || row.payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
  return { kind: "replay", value: must(await loadReturn(client, input.returnId, row.revision)) };
}

type AppliedFact = { lineId: string; variantId: string; batchId: string; direction: "restore" | "deduct"; quantity: number; unitCostPiasters: number };
type PlannedBatch = { batchId: string; variantId: string; quantity: number; unitCostPiasters: number };

async function applySaleMovements(client: PoolClient, inventory: InventoryTransaction, saleId: string, operationId: string, at: Date, entries: MerchandiseAdjustmentWrite[]): Promise<AppliedFact[]> {
  const lines = await saleLineMap(client, saleId);
  const facts: AppliedFact[] = [];
  for (const entry of entries) {
    const line = lines.get(entry.lineId)!;
    if (entry.quantityDelta > 0) {
      let remaining = entry.quantityDelta;
      const balances = await outstandingSaleBatches(client, saleId, line.variant_id);
      for (const batch of balances) {
        const take = Math.min(remaining, number(batch.balance));
        if (take <= 0) continue;
        const adjusted = await inventory.adjustCorrectionBatch({ operationId, batchId: batch.batch_id, variantId: line.variant_id, direction: "restore", quantity: take, recordedAt: at });
        facts.push({ lineId: entry.lineId, variantId: line.variant_id, batchId: batch.batch_id, direction: "restore", quantity: take, unitCostPiasters: adjusted.unitCostPiasters });
        remaining -= take;
      }
      if (remaining > 0) throw new CorrectionsValidationError("لا توجد كمية مخصصة كافية يمكن إعادتها لهذه الحركة.");
    } else {
      const result = await inventory.allocateCorrectionFromOldestAvailable({ operationId, variantId: line.variant_id, quantity: -entry.quantityDelta, recordedAt: at });
      for (const allocation of result.allocations) facts.push({ lineId: entry.lineId, variantId: line.variant_id, batchId: allocation.batchId, direction: "deduct", quantity: allocation.quantity, unitCostPiasters: allocation.unitCostPiasters });
    }
  }
  return facts;
}

async function applyReturnMovements(inventory: InventoryTransaction, operationId: string, at: Date, entries: MerchandiseAdjustmentWrite[], plans: Map<string, PlannedBatch[]>): Promise<AppliedFact[]> {
  const facts: AppliedFact[] = [];
  for (const entry of entries) {
    const direction = entry.quantityDelta > 0 ? "restore" : "deduct";
    const batches = plans.get(entry.lineId) ?? [];
    for (const batch of batches) {
      const adjusted = await inventory.adjustCorrectionBatch({
        operationId,
        batchId: batch.batchId,
        variantId: batch.variantId,
        direction,
        quantity: batch.quantity,
        recordedAt: at,
      });
      facts.push({ lineId: entry.lineId, variantId: batch.variantId, batchId: batch.batchId, direction, quantity: batch.quantity, unitCostPiasters: adjusted.unitCostPiasters });
    }
  }
  return facts;
}

async function exactReturnMovementBatches(
  queryable: Queryable,
  returnId: string,
  returnLineId: string,
  fromSellable: number,
  toSellable: number,
): Promise<PlannedBatch[]> {
  const units = await queryable.query<{
    quantity: number;
    variant_id: string;
    variant_ordinal: number | string;
    source_revision: number;
  }>(
    `SELECT ru.quantity, sl.variant_id,
            (CASE WHEN su.id IS NOT NULL THEN (
              SELECT COALESCE(SUM(prior_unit.quantity), 0)
              FROM sales_sale_unit prior_unit
              JOIN sales_sale_line before_line ON before_line.id = prior_unit.line_id
              WHERE prior_unit.sale_id = source.id
                AND before_line.variant_id = sl.variant_id
                AND (before_line.line_index < sl.line_index
                  OR (before_line.line_index = sl.line_index AND prior_unit.unit_index < su.unit_index))
            ) ELSE (
              SELECT COALESCE(SUM(prior_unit.quantity), 0)
              FROM recording_sale_unit_value prior_unit
              JOIN sales_sale_line before_line ON before_line.id = prior_unit.sale_line_id
              WHERE prior_unit.correction_id = corrected_unit.correction_id
                AND before_line.variant_id = sl.variant_id
                AND (before_line.line_index < sl.line_index
                  OR (before_line.line_index = sl.line_index AND prior_unit.unit_index < corrected_unit.unit_index))
            ) END + ru.start_offset)::bigint AS variant_ordinal,
            COALESCE(source_correction.revision, 0)::int AS source_revision
     FROM returns_return_unit ru
     JOIN returns_return r ON r.id = ru.return_id
     JOIN sales_sale source ON source.id = r.source_sale_id
     JOIN returns_return_line rl ON rl.id = ru.return_line_id
     JOIN sales_sale_line sl ON sl.id = rl.source_sale_line_id
     LEFT JOIN sales_sale_unit su ON su.id = ru.source_sale_unit_id
     LEFT JOIN recording_sale_unit_value corrected_unit ON corrected_unit.id = ru.source_recording_sale_unit_id
     LEFT JOIN recording_correction source_correction ON source_correction.id = corrected_unit.correction_id
     WHERE ru.return_id = $1 AND ru.return_line_id = $2
     ORDER BY variant_ordinal, ru.start_offset, ru.id`,
    [returnId, returnLineId],
  );
  const low = Math.min(fromSellable, toSellable);
  const high = Math.max(fromSellable, toSellable);
  const allocationCache = new Map<number, Array<PlannedBatch & { start: number; end: number }>>();
  const totals = new Map<string, PlannedBatch>();
  let returnOrdinal = 0;
  let mapped = 0;
  for (const unit of units.rows) {
    const overlapStart = Math.max(low, returnOrdinal);
    const overlapEnd = Math.min(high, returnOrdinal + unit.quantity);
    returnOrdinal += unit.quantity;
    if (overlapStart >= overlapEnd) continue;
    let allocations = allocationCache.get(unit.source_revision);
    if (!allocations) {
      allocations = await effectiveSaleAllocationRanges(queryable, returnId, unit.source_revision);
      allocationCache.set(unit.source_revision, allocations);
    }
    const saleStart = number(unit.variant_ordinal) + overlapStart - (returnOrdinal - unit.quantity);
    const saleEnd = saleStart + overlapEnd - overlapStart;
    for (const allocation of allocations) {
      if (allocation.variantId !== unit.variant_id) continue;
      const start = Math.max(saleStart, allocation.start);
      const end = Math.min(saleEnd, allocation.end);
      if (start >= end) continue;
      const quantity = end - start;
      const existing = totals.get(allocation.batchId);
      totals.set(allocation.batchId, {
        batchId: allocation.batchId,
        variantId: allocation.variantId,
        quantity: (existing?.quantity ?? 0) + quantity,
        unitCostPiasters: allocation.unitCostPiasters,
      });
      mapped += quantity;
    }
  }
  if (mapped !== high - low) {
    throw new CorrectionsValidationError("لا يمكن ربط حركة مخزون الإرجاع بدفعات البيع الأصلية المحتفظ بها.");
  }
  return [...totals.values()];
}

async function effectiveSaleAllocationRanges(queryable: Queryable, returnId: string, sourceRevision: number) {
  const result = await queryable.query<{
    batch_id: string;
    variant_id: string;
    quantity: number | string;
    unit_cost_piasters: number | string;
  }>(
    `WITH target AS (
       SELECT source.operation_id, source.id AS sale_id
       FROM returns_return r JOIN sales_sale source ON source.id = r.source_sale_id
       WHERE r.id = $1
     ), effects AS (
       SELECT a.batch_id, a.variant_id, a.unit_cost_piasters, a.quantity::bigint AS amount
       FROM inventory_allocation a JOIN target ON target.operation_id = a.operation_id
       UNION ALL
       SELECT f.batch_id, f.variant_id, f.unit_cost_piasters,
              CASE WHEN f.direction = 'deduct' THEN f.quantity ELSE -f.quantity END
       FROM recording_merchandise_fact f
       JOIN recording_correction c ON c.id = f.correction_id
       JOIN target ON target.sale_id = c.sale_id
       WHERE c.revision <= $2
     )
     SELECT effects.batch_id, effects.variant_id, SUM(effects.amount)::int AS quantity,
            effects.unit_cost_piasters
     FROM effects JOIN inventory_batch b ON b.id = effects.batch_id
     GROUP BY effects.batch_id, effects.variant_id, effects.unit_cost_piasters, b.recorded_at
     HAVING SUM(effects.amount) > 0
     ORDER BY effects.variant_id, b.recorded_at, effects.batch_id`,
    [returnId, sourceRevision],
  );
  const offsets = new Map<string, number>();
  return result.rows.map((row) => {
    const start = offsets.get(row.variant_id) ?? 0;
    const quantity = number(row.quantity);
    offsets.set(row.variant_id, start + quantity);
    return {
      batchId: row.batch_id,
      variantId: row.variant_id,
      quantity,
      unitCostPiasters: number(row.unit_cost_piasters),
      start,
      end: start + quantity,
    };
  });
}

async function outstandingSaleBatches(client: Queryable, saleId: string, variantId: string): Promise<BatchBalance[]> {
  const result = await client.query<BatchBalance>(
    `WITH source AS (
       SELECT s.operation_id FROM sales_sale s WHERE s.id = $1
     ), effects AS (
       SELECT a.batch_id, a.variant_id, a.unit_cost_piasters, a.quantity::bigint AS amount
       FROM inventory_allocation a JOIN source s ON s.operation_id = a.operation_id
       WHERE a.variant_id = $2
       UNION ALL
       SELECT f.batch_id, f.variant_id, f.unit_cost_piasters,
              CASE WHEN f.direction = 'deduct' THEN f.quantity ELSE -f.quantity END
       FROM recording_merchandise_fact f JOIN recording_correction c ON c.id = f.correction_id
       WHERE c.sale_id = $1 AND f.variant_id = $2
       UNION ALL
       SELECT br.batch_id, br.variant_id, br.unit_cost_piasters, -br.quantity::bigint
       FROM returns_batch_restoration br JOIN returns_return r ON r.id = br.return_id
       WHERE r.source_sale_id = $1 AND br.variant_id = $2
       UNION ALL
       SELECT f.batch_id, f.variant_id, f.unit_cost_piasters,
              CASE WHEN f.direction = 'restore' THEN -f.quantity ELSE f.quantity END
       FROM recording_merchandise_fact f
       JOIN recording_correction c ON c.id = f.correction_id
       JOIN returns_return r ON r.id = c.return_id
       WHERE r.source_sale_id = $1 AND f.variant_id = $2
     )
     SELECT e.batch_id, e.variant_id, e.unit_cost_piasters, SUM(e.amount)::int AS balance, b.recorded_at
     FROM effects e JOIN inventory_batch b ON b.id = e.batch_id
     GROUP BY e.batch_id, e.variant_id, e.unit_cost_piasters, b.recorded_at
     HAVING SUM(e.amount) > 0
     ORDER BY b.recorded_at DESC, e.batch_id DESC`,
    [saleId, variantId],
  );
  return result.rows;
}

async function insertCorrection(client: Queryable, input: SaleCorrectionWrite | ReturnCorrectionWrite, revision: number, total: number | null) {
  const target = "saleId" in input ? "sale" : "return";
  const saleId = "saleId" in input ? input.saleId : null;
  const returnId = "returnId" in input ? input.returnId : null;
  await client.query(
    `INSERT INTO recording_correction (
       id, operation_id, target_type, sale_id, return_id, change_type, revision, reason,
       payload_fingerprint, effective_total_piasters, cash_direction, cash_amount_piasters,
       changed_by_staff_id, changed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [input.correctionId, input.operationId, target, saleId,
      returnId, input.type, revision, input.reason,
      input.payloadFingerprint, total, input.cash?.direction ?? null, input.cash?.amountPiasters ?? 0,
      input.actorStaffId, input.at],
  );
}

async function insertFacts(client: Queryable, correctionId: string, target: Target, facts: AppliedFact[]) {
  for (const fact of facts) await client.query(
    `INSERT INTO recording_merchandise_fact (
       id, correction_id, target_line_type, sale_line_id, return_line_id, variant_id,
       batch_id, direction, quantity, unit_cost_piasters
     ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [correctionId, target, target === "sale" ? fact.lineId : null, target === "return" ? fact.lineId : null,
      fact.variantId, fact.batchId, fact.direction, fact.quantity, fact.unitCostPiasters],
  );
}

async function loadSale(queryable: Queryable, saleId: string, upToRevision = 2_147_483_647): Promise<SaleCorrectionDetailDto | null> {
  const saleResult = await queryable.query<SaleRow>(`SELECT id, operation_id, final_total_piasters, cash_received_piasters, physically_completed FROM sales_sale WHERE id = $1`, [saleId]);
  const sale = saleResult.rows[0];
  if (!sale?.physically_completed) return null;
  const original = await saleLines(queryable, saleId);
  const corrections = await correctionHistory(queryable, "sale", saleId, upToRevision);
  const latest = corrections.at(-1) ?? null;
  let effective: SaleCorrectionDetailDto["effective"] = { finalTotalPiasters: number(sale.final_total_piasters), lines: original };
  if (latest?.change_type === "cancellation") effective = null;
  else if (latest) {
    const values = await queryable.query<{ sale_line_id: string; quantity: number; paid_piasters: number | string }>(`SELECT sale_line_id, quantity, paid_piasters FROM recording_sale_line_value WHERE correction_id = $1`, [latest.id]);
    const quantity = new Map(values.rows.map((row) => [row.sale_line_id, row.quantity]));
    const paid = new Map(values.rows.map((row) => [row.sale_line_id, number(row.paid_piasters)]));
    const paidRanges = await correctedSalePaidRanges(queryable, latest.id);
    effective = {
      finalTotalPiasters: number(latest.effective_total_piasters),
      lines: original.map((line) => ({
        ...line,
        quantity: quantity.get(line.saleLineId) ?? line.quantity,
        paidPiasters: paid.get(line.saleLineId) ?? line.paidPiasters,
        paidRanges: paidRanges.get(line.saleLineId) ?? line.paidRanges,
      })),
    };
  }
  const changes = await changeDtos(queryable, corrections);
  const correctionPaid = corrections.filter((row) => row.cash_direction === "paid_out").reduce((sum, row) => sum + number(row.cash_amount_piasters), 0);
  const correctionRecovered = corrections.filter((row) => row.cash_direction === "recovered").reduce((sum, row) => sum + number(row.cash_amount_piasters), 0);
  const linked = await queryable.query<{ id: string; status: "draft" | "posted"; actual_refund_paid_piasters: number | string; change_type: "correction" | "cancellation" | null }>(
    `SELECT r.id, r.status,
            r.refund_paid_piasters
              + COALESCE(cash.paid_out, 0)
              - COALESCE(cash.recovered, 0) AS actual_refund_paid_piasters,
            latest.change_type
     FROM returns_return r LEFT JOIN LATERAL (
       SELECT c.change_type FROM recording_correction c WHERE c.return_id = r.id ORDER BY c.revision DESC LIMIT 1
     ) latest ON true LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(c.cash_amount_piasters) FILTER (WHERE c.cash_direction = 'paid_out'), 0) AS paid_out,
              COALESCE(SUM(c.cash_amount_piasters) FILTER (WHERE c.cash_direction = 'recovered'), 0) AS recovered
       FROM recording_correction c WHERE c.return_id = r.id
     ) cash ON true WHERE r.source_sale_id = $1 ORDER BY r.created_at, r.id`, [saleId]);
  const refundCash = await cashForSaleReturns(queryable, saleId);
  const merchandise = changes.flatMap((change) => change.merchandise);
  return {
    targetType: "sale", id: sale.id, reference: sale.id, revision: latest?.revision ?? 0,
    status: effective ? "active" : "cancelled", original: { finalTotalPiasters: number(sale.final_total_piasters), lines: original }, effective,
    relationships: { returns: linked.rows.map((row) => ({ id: row.id, status: row.status, effectiveStatus: row.change_type === "cancellation" ? "cancelled" : "active", refundPaidPiasters: number(row.actual_refund_paid_piasters) })) },
    actual: {
      originalCashReceivedPiasters: number(sale.cash_received_piasters), correctionCashPaidOutPiasters: correctionPaid + refundCash.paidOut,
      correctionCashRecoveredPiasters: correctionRecovered + refundCash.recovered,
      netCashReceivedPiasters: number(sale.cash_received_piasters) - correctionPaid - refundCash.paidOut + correctionRecovered + refundCash.recovered,
      merchandiseRestoredQuantity: merchandise.filter((fact) => fact.direction === "restore").reduce((sum, fact) => sum + fact.quantity, 0),
      merchandiseDeductedQuantity: merchandise.filter((fact) => fact.direction === "deduct").reduce((sum, fact) => sum + fact.quantity, 0),
    }, changes,
  };
}

async function loadReturn(queryable: Queryable, returnId: string, upToRevision = 2_147_483_647): Promise<ReturnCorrectionDetailDto | null> {
  const result = await queryable.query<ReturnRow>(`SELECT id, source_sale_id, status, authorized_refund_piasters, refund_paid_piasters, exchange_credit_applied_piasters FROM returns_return WHERE id = $1`, [returnId]);
  const row = result.rows[0];
  if (!row || row.status !== "posted") return null;
  const original = await returnLines(queryable, returnId);
  const corrections = await correctionHistory(queryable, "return", returnId, upToRevision);
  const latest = corrections.at(-1) ?? null;
  let effective: ReturnCorrectionDetailDto["effective"] = { authorizedRefundPiasters: number(row.authorized_refund_piasters), paidPiasters: number(row.refund_paid_piasters), lines: original };
  if (latest?.change_type === "cancellation") effective = null;
  else if (latest) {
    const values = await queryable.query<{ return_line_id: string; quantity: number; sellable_quantity: number }>(`SELECT return_line_id, quantity, sellable_quantity FROM recording_return_line_value WHERE correction_id = $1`, [latest.id]);
    const byId = new Map(values.rows.map((value) => [value.return_line_id, value]));
    effective = { authorizedRefundPiasters: number(latest.effective_total_piasters), paidPiasters: actualReturnCash(row, corrections), lines: original.map((line) => { const value = byId.get(line.returnLineId); return value ? { ...line, quantity: value.quantity, sellableQuantity: value.sellable_quantity } : line; }) };
  }
  const changes = await changeDtos(queryable, corrections);
  const paidOut = corrections.filter((change) => change.cash_direction === "paid_out").reduce((sum, change) => sum + number(change.cash_amount_piasters), 0);
  const recovered = corrections.filter((change) => change.cash_direction === "recovered").reduce((sum, change) => sum + number(change.cash_amount_piasters), 0);
  const merchandise = changes.flatMap((change) => change.merchandise);
  return {
    targetType: "return", id: row.id, reference: row.id, sourceSaleId: row.source_sale_id, revision: latest?.revision ?? 0,
    status: effective ? "active" : "cancelled", original: { authorizedRefundPiasters: number(row.authorized_refund_piasters), paidPiasters: number(row.refund_paid_piasters), lines: original }, effective,
    actual: {
      originalRefundPaidPiasters: number(row.refund_paid_piasters),
      exchangeCreditAppliedPiasters: number(row.exchange_credit_applied_piasters), correctionCashPaidOutPiasters: paidOut,
      correctionCashRecoveredPiasters: recovered, netRefundPaidPiasters: number(row.refund_paid_piasters) + paidOut - recovered,
      merchandiseRestoredQuantity: merchandise.filter((fact) => fact.direction === "restore").reduce((sum, fact) => sum + fact.quantity, 0),
      merchandiseDeductedQuantity: merchandise.filter((fact) => fact.direction === "deduct").reduce((sum, fact) => sum + fact.quantity, 0),
    }, changes,
  };
}

async function saleLines(queryable: Queryable, saleId: string): Promise<SaleCorrectionLineDto[]> {
  const [result, units] = await Promise.all([
    queryable.query<LineRow>(`${lineSelect("sl", "sl.paid_piasters,")} FROM sales_sale_line sl ${variantJoins("sl")} WHERE sl.sale_id = $1 ORDER BY sl.line_index`, [saleId]),
    queryable.query<{ line_id: string; quantity: number; paid_piasters: number | string }>(
      `SELECT line_id, quantity, paid_piasters FROM sales_sale_unit WHERE sale_id = $1 ORDER BY line_id, unit_index`, [saleId]),
  ]);
  const paidRanges = new Map<string, Array<{ quantity: number; paidUnitPiasters: number }>>();
  for (const unit of units.rows) {
    const ranges = paidRanges.get(unit.line_id) ?? [];
    ranges.push({ quantity: unit.quantity, paidUnitPiasters: number(unit.paid_piasters) });
    paidRanges.set(unit.line_id, ranges);
  }
  return result.rows.map((row) => ({
    saleLineId: row.id,
    variantId: row.variant_id,
    variant: variant(row),
    quantity: row.quantity,
    paidPiasters: number(row.paid_piasters),
    paidRanges: paidRanges.get(row.id) ?? [],
  }));
}

async function correctedSalePaidRanges(queryable: Queryable, correctionId: string) {
  const result = await queryable.query<{ sale_line_id: string; quantity: number; paid_unit_piasters: number | string }>(
    `SELECT sale_line_id, quantity, paid_unit_piasters
     FROM recording_sale_unit_value WHERE correction_id = $1 ORDER BY sale_line_id, unit_index`, [correctionId]);
  const byLine = new Map<string, Array<{ quantity: number; paidUnitPiasters: number }>>();
  for (const row of result.rows) {
    const ranges = byLine.get(row.sale_line_id) ?? [];
    ranges.push({ quantity: row.quantity, paidUnitPiasters: number(row.paid_unit_piasters) });
    byLine.set(row.sale_line_id, ranges);
  }
  return byLine;
}
async function returnLines(queryable: Queryable, returnId: string): Promise<ReturnCorrectionLineDto[]> {
  const result = await queryable.query<LineRow>(`${lineSelect("rl", "rl.source_sale_line_id, rl.sellable_quantity,")} FROM returns_return_line rl JOIN sales_sale_line sl ON sl.id = rl.source_sale_line_id ${variantJoins("sl")} WHERE rl.return_id = $1 ORDER BY rl.line_index`, [returnId]);
  return result.rows.map((row) => ({ returnLineId: row.id, sourceSaleLineId: row.source_sale_line_id!, variantId: row.variant_id, variant: variant(row), quantity: row.quantity, sellableQuantity: row.sellable_quantity! }));
}
function lineSelect(alias: string, extra = "") { return `SELECT ${alias}.id, ${extra} sl.variant_id, ${alias}.quantity, p.id AS product_id, p.code AS product_code, p.name_ar AS product_name_ar, sz.id AS size_id, sz.name_ar AS size_name_ar, c.id AS color_id, c.name_ar AS color_name_ar`; }
function variantJoins(lineAlias: string) { return `JOIN catalog_product_variant v ON v.id = ${lineAlias}.variant_id JOIN catalog_product p ON p.id = v.product_id JOIN catalog_size sz ON sz.id = v.size_id JOIN catalog_color c ON c.id = v.color_id`; }
function variant(row: LineRow): VariantIdentityDto { return { id: row.variant_id, product: { id: row.product_id, code: row.product_code, nameAr: row.product_name_ar }, size: { id: row.size_id, nameAr: row.size_name_ar }, color: { id: row.color_id, nameAr: row.color_name_ar } }; }

async function correctionHistory(queryable: Queryable, target: Target, id: string, upToRevision: number): Promise<CorrectionRow[]> {
  const result = await queryable.query<CorrectionRow>(
    `SELECT c.*, p.display_name_ar AS changed_by_display_name FROM recording_correction c
     JOIN staff_profile p ON p.staff_id = c.changed_by_staff_id
     WHERE c.${target === "sale" ? "sale_id" : "return_id"} = $1 AND c.revision <= $2
     ORDER BY c.revision`, [id, upToRevision]);
  return result.rows;
}
async function correctionByOperation(queryable: Queryable, operationId: string) {
  const result = await queryable.query<CorrectionRow>(`SELECT c.*, p.display_name_ar AS changed_by_display_name FROM recording_correction c JOIN staff_profile p ON p.staff_id = c.changed_by_staff_id WHERE c.operation_id = $1`, [operationId]);
  return result.rows[0] ?? null;
}
async function changeDtos(queryable: Queryable, rows: CorrectionRow[]): Promise<CorrectionChangeDto[]> {
  if (rows.length === 0) return [];
  const facts = await queryable.query<FactRow>(
    `SELECT f.correction_id, COALESCE(f.sale_line_id, f.return_line_id) AS line_id,
            f.variant_id, f.batch_id, f.direction, f.quantity, f.unit_cost_piasters,
            b.effective_unit_cost_piasters
     FROM recording_merchandise_fact f
     JOIN inventory_batch b ON b.id = f.batch_id
     WHERE f.correction_id = ANY($1::uuid[])
     ORDER BY f.correction_id, f.id`, [rows.map((row) => row.id)]);
  const byCorrection = new Map<string, CorrectionMerchandiseFactDto[]>();
  for (const fact of facts.rows) {
    const list = byCorrection.get(fact.correction_id) ?? [];
    const existing = list.find((item) => item.lineId === fact.line_id && item.direction === fact.direction);
    const batch = {
      batchId: fact.batch_id,
      quantity: fact.quantity,
      unitCostPiasters: number(fact.unit_cost_piasters),
      effectiveUnitCostPiasters: number(fact.effective_unit_cost_piasters),
    };
    if (existing) { existing.quantity += fact.quantity; existing.batches.push(batch); }
    else list.push({ lineId: fact.line_id, variantId: fact.variant_id, direction: fact.direction, quantity: fact.quantity, batches: [batch] });
    byCorrection.set(fact.correction_id, list);
  }
  return rows.map((row) => ({
    id: row.id, operationId: row.operation_id, type: row.change_type, revision: row.revision, reason: row.reason,
    changedByStaffId: row.changed_by_staff_id, changedByDisplayName: row.changed_by_display_name, changedAt: row.changed_at.toISOString(),
    effectiveTotalPiasters: row.effective_total_piasters === null ? null : number(row.effective_total_piasters),
    merchandise: byCorrection.get(row.id) ?? [], cash: row.cash_direction ? { direction: row.cash_direction, amountPiasters: number(row.cash_amount_piasters) } : null,
  }));
}

async function effectiveSaleQuantity(queryable: Queryable, saleLineId: string): Promise<number> {
  const result = await queryable.query<{ quantity: number; change_type: string | null }>(
    `SELECT COALESCE(v.quantity, sl.quantity)::int AS quantity, latest.change_type
     FROM sales_sale_line sl LEFT JOIN LATERAL (
       SELECT c.id, c.change_type FROM recording_correction c WHERE c.sale_id = sl.sale_id ORDER BY c.revision DESC LIMIT 1
     ) latest ON true LEFT JOIN recording_sale_line_value v ON v.correction_id = latest.id AND v.sale_line_id = sl.id
     WHERE sl.id = $1`, [saleLineId]);
  const row = result.rows[0];
  return !row || row.change_type === "cancellation" ? 0 : row.quantity;
}
async function effectiveReturnedForLine(queryable: Queryable, saleLineId: string, excludeReturnId: string | null): Promise<number> {
  const result = await queryable.query<{ quantity: number | string }>(
    `SELECT COALESCE(SUM(CASE WHEN latest.change_type = 'cancellation' THEN 0 ELSE COALESCE(v.quantity, rl.quantity) END), 0)::int AS quantity
     FROM returns_return_line rl JOIN returns_return r ON r.id = rl.return_id
     LEFT JOIN LATERAL (SELECT c.id, c.change_type FROM recording_correction c WHERE c.return_id = r.id ORDER BY c.revision DESC LIMIT 1) latest ON true
     LEFT JOIN recording_return_line_value v ON v.correction_id = latest.id AND v.return_line_id = rl.id
     WHERE r.status = 'posted' AND rl.source_sale_line_id = $1 AND ($2::uuid IS NULL OR r.id <> $2)`, [saleLineId, excludeReturnId]);
  return number(result.rows[0]?.quantity ?? 0);
}

async function saleLineMap(queryable: Queryable, saleId: string) { const result = await queryable.query<{ id: string; variant_id: string }>(`SELECT id, variant_id FROM sales_sale_line WHERE sale_id = $1`, [saleId]); return new Map(result.rows.map((row) => [row.id, row])); }
async function returnLineMap(queryable: Queryable, returnId: string) { const result = await queryable.query<{ id: string; variant_id: string }>(`SELECT rl.id, sl.variant_id FROM returns_return_line rl JOIN sales_sale_line sl ON sl.id = rl.source_sale_line_id WHERE rl.return_id = $1`, [returnId]); return new Map(result.rows.map((row) => [row.id, row])); }
function validateMerchandise(entries: MerchandiseAdjustmentWrite[], ids: Set<string>) { if (entries.some((entry) => !ids.has(entry.lineId))) throw new CorrectionsValidationError("حركة البضاعة تشير إلى سطر غير موجود في التسجيل الأصلي."); return entries; }
function signedAdjustments(entries: MerchandiseAdjustmentWrite[]) { return new Map(entries.map((entry) => [entry.lineId, entry.quantityDelta])); }
function assertExactLines(values: string[], expected: Set<string>, message: string) { if (values.length !== expected.size || new Set(values).size !== values.length || values.some((id) => !expected.has(id))) throw new CorrectionsValidationError(message); }

async function cashForSaleReturns(queryable: Queryable, saleId: string) {
  const result = await queryable.query<{ original_paid: number | string; paid_out: number | string; recovered: number | string }>(
    `SELECT COALESCE(SUM(r.refund_paid_piasters),0) AS original_paid,
            COALESCE(SUM(cash.paid_out),0) AS paid_out,
            COALESCE(SUM(cash.recovered),0) AS recovered
     FROM returns_return r LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(c.cash_amount_piasters) FILTER (WHERE c.cash_direction='paid_out'),0) AS paid_out,
              COALESCE(SUM(c.cash_amount_piasters) FILTER (WHERE c.cash_direction='recovered'),0) AS recovered
       FROM recording_correction c WHERE c.return_id = r.id
     ) cash ON true
     WHERE r.source_sale_id = $1`, [saleId]);
  const row = result.rows[0]; return { paidOut: number(row?.original_paid ?? 0) + number(row?.paid_out ?? 0), recovered: number(row?.recovered ?? 0) };
}
function actualReturnCash(row: ReturnRow, corrections: CorrectionRow[]) { return number(row.refund_paid_piasters) + corrections.reduce((sum, change) => sum + (change.cash_direction === "paid_out" ? number(change.cash_amount_piasters) : change.cash_direction === "recovered" ? -number(change.cash_amount_piasters) : 0), 0); }

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await pool.connect(); try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
function number(value: number | string | null | undefined) { const parsed = Number(value ?? 0); if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable numeric value."); return parsed; }
function must<T>(value: T | null): T { if (!value) throw new Error("Correction result could not be loaded."); return value; }
