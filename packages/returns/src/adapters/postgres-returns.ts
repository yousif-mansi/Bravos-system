import type { Pool, PoolClient } from "pg";
import type { InventoryTransaction } from "@bravos/inventory";
import type { DeliveredOnlineOrderSourceReader } from "@bravos/online-orders";
import { OperationConflictError } from "@bravos/inventory";
import type {
  RefundEventRecord,
  ReturnLineWrite,
  ReturnExchangeRecord,
  ReturnExchangeQuoteRecord,
  ReturnListRecord,
  ReturnRecord,
  ReturnRestorationWrite,
  ReturnReplacementSaleWriter,
  ReturnCorrectionStateReader,
  ReturnsStore,
  ReturnsUnitOfWork,
  ReturnSourceLine,
  ReturnSourceRecord,
  ReturnSourceUnit,
  SourceSearch,
  ReturnReplacementAcceptedQuote,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresStockReconciliationReturnFacts(queryable: Queryable) {
  return {
    async hasPostedForSourceLines(saleId: string, saleLineIds: string[]) {
      if (saleLineIds.length === 0) return false;
      const result = await queryable.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM returns_return r
           JOIN returns_return_line rl ON rl.return_id = r.id
           WHERE r.source_sale_id = $1 AND rl.source_sale_line_id = ANY($2::uuid[]) AND r.status = 'posted'
         ) AS present`,
        [saleId, saleLineIds],
      );
      return result.rows[0]?.present ?? false;
    },
    async listIdsForSale(saleId: string) {
      const result = await queryable.query<{ id: string }>(
        `SELECT id FROM returns_return WHERE source_sale_id = $1`,
        [saleId],
      );
      return result.rows.map((row) => row.id);
    },
  };
}

type SourceRow = {
  id: string;
  reference: string;
  operation_id: string;
  branch_id: string;
  sold_by_staff_id: string;
  sold_by_display_name: string;
  occurred_at: Date;
  received_at_key: string;
  return_deadline_at: Date;
  final_total_piasters: number | string;
  customer_name: string | null;
  customer_phone: string | null;
  correction_id: string | null;
};

type SourceLineRow = {
  id: string;
  variant_id: string;
  quantity: number;
  paid_piasters: number | string;
  line_index: number;
};

type SourceUnitRow = {
  id: string;
  line_id: string;
  variant_id: string;
  unit_index: number;
  quantity: number;
  paid_piasters: number | string;
  source_type: "original" | "correction";
};

type AllocationRow = {
  batch_id: string;
  variant_id: string;
  requested_variant_id: string;
  quantity: number;
  unit_cost_piasters: number | string;
  effective_unit_cost_piasters: number | string;
  recorded_at: Date;
};

type ReturnRow = {
  reason: string | null;
  id: string;
  reference: string;
  operation_id: string;
  source_sale_id: string | null;
  source_online_order_id: string | null;
  handling_branch_id: string;
  status: "draft" | "posted";
  revision: number;
  payload_fingerprint: string;
  draft_payload_fingerprint: string;
  suggested_refund_piasters: number | string;
  authorized_refund_piasters: number | string;
  suggested_merchandise_refund_piasters: number | string;
  suggested_checkout_charge_refund_piasters: number | string;
  authorized_merchandise_refund_piasters: number | string;
  authorized_checkout_charge_refund_piasters: number | string;
  created_by_staff_id: string;
  created_at: Date;
  updated_by_staff_id: string;
  updated_at: Date;
  posted_by_staff_id: string | null;
  posted_at: Date | null;
  refund_status: "none" | "owed" | "paid";
  refund_paid_piasters: number | string;
  exchange_credit_applied_piasters: number | string;
  refund_recorded_by_staff_id: string | null;
  refund_recorded_at: Date | null;
};

type ReturnListRow = {
  reason: string | null;
  id: string;
  reference: string;
  customer_name: string | null;
  status: "draft" | "posted";
  revision: number;
  source_sale_id: string | null;
  source_online_order_id: string | null;
  channel: "physical" | "online";
  source_reference: string;
  original_branch_id: string | null;
  original_branch_code: "abshway" | "fayoum" | null;
  original_branch_name_ar: string | null;
  handling_branch_id: string;
  handling_branch_code: ReturnListRecord["handlingBranch"]["code"];
  handling_branch_name_ar: string;
  authorized_refund_piasters: number | string;
  authorized_merchandise_refund_piasters: number | string;
  authorized_checkout_charge_refund_piasters: number | string;
  refund_status: "none" | "owed" | "paid";
  created_at: Date;
  posted_at: Date | null;
};

type ReturnLineRow = {
  id: string;
  return_id: string;
  source_sale_line_id: string | null;
  source_online_order_line_id: string | null;
  variant_id: string;
  quantity: number;
  sellable_quantity: number;
  suggested_refund_piasters: number | string;
  line_index: number;
};

type RestorationRow = {
  id: string;
  return_id: string;
  batch_id: string;
  variant_id: string;
  quantity: number;
  unit_cost_piasters: number | string;
  effective_unit_cost_piasters: number | string;
};

type EventRow = {
  operation_id: string;
  return_id: string;
  status: "paid";
  amount_piasters: number | string;
  payload_fingerprint: string;
  actor_staff_id: string;
  recorded_at: Date;
};

type ExchangeRow = {
  id: string;
  operation_id: string;
  return_id: string;
  replacement_sale_id: string;
  payload_fingerprint: string;
  credit_available_piasters: number | string;
  credit_applied_piasters: number | string;
  cash_collected_piasters: number | string;
  cash_refund_status: "none" | "owed" | "paid";
  cash_refund_piasters: number | string;
  cash_refund_paid_piasters: number | string;
  completed_by_staff_id: string;
  completed_at: Date;
};

type ExchangeQuoteRow = {
  id: string;
  return_id: string;
  return_revision: number;
  correction_revision: number;
  credit_available_piasters: number | string;
  settlement_identity: ReturnExchangeQuoteRecord["settlement"];
  payload_fingerprint: string;
  accepted_quote: ReturnReplacementAcceptedQuote;
  quoted_by_staff_id: string;
  quoted_at: Date;
};

type PhysicalSourceCandidate = {
  id: string;
  receivedAtKey: string;
  receiptReference?: string;
  receiptNumberingConflict?: true;
};

type PhysicalSourceProjection = {
  id: string;
  receiptReference?: string;
  receiptNumberingConflict?: true;
};

type PhysicalSourceCandidates = {
  list(search: SourceSearch): Promise<PhysicalSourceCandidate[]>;
  projections(ids: string[]): Promise<PhysicalSourceProjection[]>;
};

function applyReceiptMetadata(
  source: ReturnSourceRecord,
  metadata: { receiptReference?: string; receiptNumberingConflict?: true } | undefined,
): ReturnSourceRecord {
  if (!metadata?.receiptReference && !metadata?.receiptNumberingConflict) return source;
  return {
    ...source,
    ...(metadata.receiptReference ? { receiptReference: metadata.receiptReference } : {}),
    ...(metadata.receiptNumberingConflict ? { receiptNumberingConflict: true as const } : {}),
  };
}

export function createPostgresReturnsStore(queryable: Queryable,
  sourceCandidates: PhysicalSourceCandidates,
): ReturnsStore {
  return {
    async listPhysicalSources(search) {
      if (search.channel === "online") return [];
      const rows: ReturnSourceRecord[] = [];
      const target = search.limit ?? 100;
      let after = search.after;
      // Hydration already owns the accepted correction projection. Scan bounded
      // raw Sales pages until the requested number of eligible purchases exists;
      // cancellation/amount filtering must never discard matches behind a limit.
      while (rows.length < target) {
        const candidates = await sourceCandidates.list({ ...search, limit: 100, ...(after ? { after } : {}) });
        for (const item of candidates) {
          const source = await loadPhysicalSource(queryable, item.id, false);
          if (source && (search.amountPiasters === undefined
            || source.originalPayment.totalPiasters === search.amountPiasters)) {
            rows.push(applyReceiptMetadata(source, item));
          }
          if (rows.length === target) break;
        }
        const last = candidates.at(-1);
        if (rows.length === target || candidates.length < 100 || !last) break;
        after = { receivedAt: last.receivedAtKey, id: last.id, channel: "physical" };
      }
      return rows;
    },
    async getPhysicalSource(saleId, lock = false) {
      const source = await loadPhysicalSource(queryable, saleId, lock);
      if (!source) return null;
      const projected = await sourceCandidates.projections([saleId]);
      return applyReceiptMetadata(source, projected.find((item) => item.id === saleId));
    },
    async getSourceKey(returnId) {
      const result = await queryable.query<{ source_sale_id: string | null; source_online_order_id: string | null }>(
        `SELECT source_sale_id,source_online_order_id FROM returns_return WHERE id = $1`, [returnId]);
      const row = result.rows[0];
      if (row?.source_sale_id) return { kind: "physical_sale", id: row.source_sale_id };
      if (row?.source_online_order_id) return { kind: "delivered_online_order", id: row.source_online_order_id };
      return null;
    },
    async getSourceUsage(source, lineIds) {
      if (lineIds.length === 0) return { returnedByLine: new Map(), returnedRangesByOnlineUnit: new Map(), checkoutChargeAlreadyAuthorized: false };
      const keyColumn = source.kind === "physical_sale" ? "source_sale_id" : "source_online_order_id";
      const lineColumn = source.kind === "physical_sale" ? "source_sale_line_id" : "source_online_order_line_id";
      const returned = await queryable.query<{ source_line_id: string; quantity: number | string }>(
        `SELECT rl.${lineColumn} AS source_line_id,
                COALESCE(SUM(CASE WHEN latest.change_type='cancellation' THEN 0
                  ELSE COALESCE(value.quantity,rl.quantity) END),0)::int AS quantity
         FROM returns_return_line rl
         JOIN returns_return r ON r.id=rl.return_id
         LEFT JOIN LATERAL (
           SELECT correction.id,correction.change_type
           FROM recording_correction correction
           WHERE correction.return_id=r.id ORDER BY correction.revision DESC LIMIT 1
         ) latest ON true
         LEFT JOIN recording_return_line_value value
           ON value.correction_id=latest.id AND value.return_line_id=rl.id
         WHERE r.${keyColumn}=$1 AND r.status='posted' AND rl.${lineColumn}=ANY($2::uuid[])
         GROUP BY rl.${lineColumn}`,
        [source.id, lineIds],
      );
      const checkout = await queryable.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM returns_return r
           LEFT JOIN LATERAL (
             SELECT correction.change_type,correction.effective_refund_checkout_charge_piasters
             FROM recording_correction correction
             WHERE correction.return_id=r.id ORDER BY correction.revision DESC LIMIT 1
           ) latest ON true
           WHERE r.${keyColumn}=$1 AND r.status='posted'
             AND COALESCE(latest.change_type,'correction') <> 'cancellation'
             AND COALESCE(latest.effective_refund_checkout_charge_piasters,
               r.authorized_checkout_charge_refund_piasters) > 0
         ) AS present`,
        [source.id],
      );
      const onlineRanges = source.kind === "delivered_online_order"
        ? await queryable.query<{
            source_line_id: string; unit_index: number; start_offset: number; quantity: number;
          }>(
            `WITH active AS (
               SELECT r.id AS return_id,latest.id AS correction_id
               FROM returns_return r
               LEFT JOIN LATERAL (SELECT correction.id,correction.change_type
                 FROM recording_correction correction WHERE correction.return_id=r.id
                 ORDER BY correction.revision DESC LIMIT 1) latest ON true
               WHERE r.source_online_order_id=$1 AND r.status='posted'
                 AND COALESCE(latest.change_type,'correction')<>'cancellation'
             ), spans AS (
               SELECT unit.source_online_order_line_id AS source_line_id,
                      unit.source_online_order_unit_index AS unit_index,
                      unit.start_offset,unit.quantity
               FROM active JOIN returns_return_unit unit ON unit.return_id=active.return_id
               WHERE active.correction_id IS NULL
               UNION ALL
               SELECT value.source_online_order_line_id,value.source_online_order_unit_index,
                      value.start_offset,value.quantity
               FROM active JOIN recording_online_return_unit_value value
                 ON value.correction_id=active.correction_id
             )
             SELECT source_line_id,unit_index,start_offset,quantity FROM spans
             WHERE source_line_id=ANY($2::uuid[])
             ORDER BY source_line_id,unit_index,start_offset`, [source.id, lineIds])
        : { rows: [] as Array<{ source_line_id: string; unit_index: number; start_offset: number; quantity: number }> };
      const returnedRangesByOnlineUnit = new Map<string, Array<{ startOffset: number; quantity: number }>>();
      for (const range of onlineRanges.rows) {
        const key = `${range.source_line_id}:${range.unit_index}`;
        const values = returnedRangesByOnlineUnit.get(key) ?? [];
        values.push({ startOffset: range.start_offset, quantity: range.quantity });
        returnedRangesByOnlineUnit.set(key, values);
      }
      return {
        returnedByLine: new Map(returned.rows.map((row) => [row.source_line_id, asSafeInteger(row.quantity)])),
        returnedRangesByOnlineUnit,
        checkoutChargeAlreadyAuthorized: checkout.rows[0]?.present ?? false,
      };
    },
    async lockIdentities(returnId, operationId) {
      for (const key of [...new Set([returnId, operationId])].sort()) {
        await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [key]);
      }
    },
    async insertDraft(input) {
      const inserted = await queryable.query<{ id: string }>(
        `INSERT INTO returns_return (
           id,operation_id,source_sale_id,source_online_order_id,handling_branch_id,status,
           payload_fingerprint,draft_payload_fingerprint,suggested_refund_piasters,authorized_refund_piasters,
           suggested_merchandise_refund_piasters,suggested_checkout_charge_refund_piasters,
           authorized_merchandise_refund_piasters,authorized_checkout_charge_refund_piasters,
           created_by_staff_id,revision,updated_by_staff_id,reason
         ) VALUES ($1,$2,$3,$4,$5,'draft',$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [input.id,input.operationId,input.source.kind === "physical_sale" ? input.source.id : null,
          input.source.kind === "delivered_online_order" ? input.source.id : null,input.handlingBranchId,input.payloadFingerprint,
          input.suggestedRefundPiasters,input.authorizedRefundPiasters,
          input.suggestedRefund.merchandisePiasters,input.suggestedRefund.checkoutChargePiasters,
          input.authorizedRefund.merchandisePiasters,input.authorizedRefund.checkoutChargePiasters,
          input.createdByStaffId,input.revision,input.updatedByStaffId,input.reason],
      );
      if (!inserted.rows[0]) {
        const existing = await loadReturn(queryable, input.id, false);
        if (!existing) throw new OperationConflictError();
        return { kind: "existing", record: existing };
      }
      for (const line of input.lines) {
        await queryable.query(
          `INSERT INTO returns_return_line (
             id,return_id,source_sale_line_id,source_online_order_line_id,source_variant_id,quantity,sellable_quantity,
             suggested_refund_piasters, line_index
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [line.id,input.id,input.source.kind === "physical_sale" ? line.sourceLineId : null,
            input.source.kind === "delivered_online_order" ? line.sourceLineId : null,
            line.variantId,line.quantity,line.sellableQuantity,line.suggestedRefundPiasters,line.lineIndex],
        );
      }
      const record = await loadReturn(queryable, input.id, false);
      if (!record) throw new Error("Created return draft could not be loaded.");
      return { kind: "created", record };
    },
    async updateDraft(input) {
      const updated = await queryable.query<{ id: string }>(
        `UPDATE returns_return
         SET handling_branch_id = $3, draft_payload_fingerprint = $4,
             suggested_refund_piasters = $5, authorized_refund_piasters = $6,
             suggested_merchandise_refund_piasters=$7,suggested_checkout_charge_refund_piasters=$8,
             authorized_merchandise_refund_piasters=$9,authorized_checkout_charge_refund_piasters=$10,
             revision = revision + 1, updated_by_staff_id = $11, updated_at = $12, reason = $13
         WHERE id = $1 AND status = 'draft' AND revision = $2
         RETURNING id`,
        [input.returnId, input.expectedRevision, input.handlingBranchId, input.draftPayloadFingerprint,
          input.suggestedRefundPiasters,input.authorizedRefundPiasters,
          input.suggestedRefund.merchandisePiasters,input.suggestedRefund.checkoutChargePiasters,
          input.authorizedRefund.merchandisePiasters,input.authorizedRefund.checkoutChargePiasters,
          input.updatedByStaffId,input.updatedAt,input.reason],
      );
      if (!updated.rows[0]) throw new OperationConflictError("تغيرت المسودة أو تم ترحيلها. أعد تحميلها قبل التعديل.");
      const sourceRow = await queryable.query<{ source_sale_id: string | null; source_online_order_id: string | null }>(
        `SELECT source_sale_id,source_online_order_id FROM returns_return WHERE id=$1`,
        [input.returnId],
      );
      const onlineSource = Boolean(sourceRow.rows[0]?.source_online_order_id);
      await queryable.query(`DELETE FROM returns_return_line WHERE return_id = $1`, [input.returnId]);
      for (const line of input.lines) {
        await queryable.query(
          `INSERT INTO returns_return_line (
             id,return_id,source_sale_line_id,source_online_order_line_id,source_variant_id,quantity,sellable_quantity,
             suggested_refund_piasters, line_index
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [line.id,input.returnId,onlineSource ? null : line.sourceLineId,
            onlineSource ? line.sourceLineId : null,
            line.variantId,line.quantity,line.sellableQuantity,line.suggestedRefundPiasters,line.lineIndex],
        );
      }
      const record = await loadReturn(queryable, input.returnId, false);
      if (!record) throw new Error("Updated return draft could not be loaded.");
      return record;
    },
    getById: (id, lock = false) => loadReturn(queryable, id, lock),
    getByOperationId: (operationId) => loadReturnByOperation(queryable, operationId),
    async listPage(input) {
      const result = await queryable.query<ReturnListRow>(
        `SELECT r.id,r.reference,r.reason,r.status,r.revision,r.source_sale_id,r.source_online_order_id,
                CASE WHEN r.source_online_order_id IS NULL THEN 'physical' ELSE 'online' END AS channel,
                COALESCE(online_source.reference,source_sale.reference) AS source_reference,
                COALESCE(online_source.customer_name,source_sale.customer_name) AS customer_name,
                original_branch.id AS original_branch_id, original_branch.code AS original_branch_code,
                original_branch.name_ar AS original_branch_name_ar,
                handling_branch.id AS handling_branch_id, handling_branch.code AS handling_branch_code,
                handling_branch.name_ar AS handling_branch_name_ar,
                r.authorized_refund_piasters,r.authorized_merchandise_refund_piasters,
                r.authorized_checkout_charge_refund_piasters,r.refund_status,r.created_at,r.posted_at
         FROM returns_return r
         LEFT JOIN sales_sale source_sale ON source_sale.id = r.source_sale_id
         LEFT JOIN online_order online_source ON online_source.id=r.source_online_order_id
         LEFT JOIN online_order_confirmation online_confirmation ON online_confirmation.order_id = online_source.id
         LEFT JOIN branch original_branch ON original_branch.id = COALESCE(source_sale.branch_id, online_confirmation.fulfillment_branch_id)
         JOIN branch handling_branch ON handling_branch.id = r.handling_branch_id
         WHERE ($2::uuid IS NULL OR (r.created_at, r.id) < (
           SELECT cursor_return.created_at, cursor_return.id FROM returns_return cursor_return WHERE cursor_return.id = $2
         ))
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT $1`,
        [input.limit + 1, input.cursor],
      );
      const hasMore = result.rows.length > input.limit;
      const visible = result.rows.slice(0, input.limit);
      return {
        items: await (async () => {
          const lines = await queryable.query<{ return_id: string; source_variant_id: string; quantity: number }>(
            `SELECT return_id,source_variant_id,quantity FROM returns_return_line
             WHERE return_id=ANY($1::uuid[]) ORDER BY return_id,line_index`, [visible.map((row) => row.id)],
          );
          return visible.map((row) => ({ ...toReturnListRecord(row), lines: lines.rows
            .filter((line) => line.return_id === row.id).map((line) => ({ variantId: line.source_variant_id, quantity: line.quantity })) }));
        })(),
        nextCursor: hasMore ? visible.at(-1)?.id ?? null : null,
      };
    },
    getRefundEventByOperation: (operationId) => loadEventByOperation(queryable, operationId),
    getExchangeByReturnId: (returnId, lock = false) => loadExchange(
      queryable,
      "return_id",
      returnId,
      lock,
    ),
    getExchangeById: (id) => loadExchange(queryable, "id", id, false),
    getExchangeByOperationId: (operationId) => loadExchange(queryable, "operation_id", operationId, false),
    async getExchangeQuoteById(id) {
      const result = await queryable.query<ExchangeQuoteRow>(
        "SELECT * FROM returns_exchange_quote WHERE id = $1",
        [id],
      );
      return result.rows[0] ? toExchangeQuote(result.rows[0]) : null;
    },
    async insertExchangeQuote(input) {
      const inserted = await queryable.query<ExchangeQuoteRow>(
        `INSERT INTO returns_exchange_quote (
           id, return_id, return_revision, correction_revision, credit_available_piasters,
           settlement_identity, payload_fingerprint, accepted_quote, quoted_by_staff_id, quoted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING RETURNING *`,
        [input.id, input.returnId, input.returnRevision, input.correctionRevision,
          input.creditAvailablePiasters, JSON.stringify(input.settlement), input.payloadFingerprint, JSON.stringify(input.acceptedQuote),
          input.quotedByStaffId, input.quotedAt],
      );
      if (inserted.rows[0]) return { kind: "created", record: toExchangeQuote(inserted.rows[0]) };
      const existing = await queryable.query<ExchangeQuoteRow>(
        "SELECT * FROM returns_exchange_quote WHERE id = $1",
        [input.id],
      );
      if (!existing.rows[0]) throw new OperationConflictError();
      return { kind: "existing", record: toExchangeQuote(existing.rows[0]) };
    },
    async insertExchange(input) {
      const inserted = await queryable.query<ExchangeRow>(
        `INSERT INTO returns_exchange (
           id, operation_id, return_id, replacement_sale_id, payload_fingerprint,
           credit_available_piasters, credit_applied_piasters, cash_collected_piasters, cash_refund_status,
           cash_refund_piasters, cash_refund_paid_piasters, completed_by_staff_id, completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [input.id, input.operationId, input.returnId, input.replacementSaleId, input.payloadFingerprint, input.creditAvailablePiasters,
          input.creditAppliedPiasters, input.cashCollectedPiasters, input.cashRefundStatus,
          input.cashRefundPiasters, input.cashRefundPaidPiasters, input.completedByStaffId, input.completedAt],
      );
      const refundActor = input.cashRefundStatus === "none" ? null : input.completedByStaffId;
      const refundAt = input.cashRefundStatus === "none" ? null : input.completedAt;
      const updated = await queryable.query(
        `UPDATE returns_return
         SET exchange_credit_applied_piasters = $2, refund_status = $3,
             refund_paid_piasters = $4, refund_recorded_by_staff_id = $5,
             refund_recorded_at = $6, updated_by_staff_id = $7, updated_at = $8
         WHERE id = $1 AND status = 'posted'`,
        [input.returnId, input.creditAppliedPiasters, input.cashRefundStatus,
          input.cashRefundPaidPiasters, refundActor, refundAt, input.completedByStaffId, input.completedAt],
      );
      if (updated.rowCount !== 1) throw new OperationConflictError("تم تسجيل استبدال لهذا الإرجاع بالفعل.");
      return toExchange(inserted.rows[0]!);
    },
    async post(input) {
      for (const unit of input.units) {
        await queryable.query(
          `INSERT INTO returns_return_unit (
             id, return_id, return_line_id, source_sale_unit_id, source_recording_sale_unit_id,
             source_online_order_line_id,source_online_order_unit_index,
             start_offset, quantity, paid_unit_piasters
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [unit.id, input.returnId, unit.returnLineId, unit.sourceSaleUnitId,
            unit.sourceRecordingSaleUnitId,unit.sourceOnlineOrderLineId,unit.sourceOnlineOrderUnitIndex,
            unit.startOffset,unit.quantity,unit.paidUnitPiasters],
        );
      }
      for (const item of input.restorations) {
        await queryable.query(
          `INSERT INTO returns_batch_restoration (
             id, return_id, batch_id, variant_id, quantity, unit_cost_piasters, recorded_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [item.id, input.returnId, item.batchId, item.variantId, item.quantity, item.unitCostPiasters, input.postedAt],
        );
      }
      const updated = await queryable.query<{ id: string }>(
        `UPDATE returns_return
         SET status = 'posted', posted_by_staff_id = $2, posted_at = $3,
             refund_status = 'owed', refund_recorded_by_staff_id = $2, refund_recorded_at = $3,
             updated_by_staff_id = $2, updated_at = $3
         WHERE id = $1 AND status = 'draft' RETURNING id`,
        [input.returnId, input.postedByStaffId, input.postedAt],
      );
      if (!updated.rows[0]) throw new OperationConflictError();
      const record = await loadReturn(queryable, input.returnId, false);
      if (!record) throw new Error("Posted return could not be loaded.");
      return record;
    },
    async markPaid(input) {
      const record = await loadReturn(queryable, input.returnId, false);
      if (!record) throw new OperationConflictError();
      const byOperation = await loadEventByOperation(queryable, input.operationId);
      if (byOperation) {
        if (byOperation.returnId !== input.returnId || byOperation.payloadFingerprint !== input.payloadFingerprint) {
          throw new OperationConflictError();
        }
        const replay = await loadReturn(queryable, input.returnId, false);
        if (!replay) throw new OperationConflictError();
        return { kind: "existing", record: replay, event: byOperation };
      }
      await queryable.query(
        `INSERT INTO returns_refund_event (
           id, operation_id, return_id, status, amount_piasters, payload_fingerprint, actor_staff_id, recorded_at
         ) VALUES (gen_random_uuid(), $1, $2, 'paid', $3, $4, $5, $6)`,
        [input.operationId, input.returnId, input.amountPiasters, input.payloadFingerprint, input.actorStaffId, input.recordedAt],
      );
      const updatedRow = await queryable.query<{ id: string }>(
        `UPDATE returns_return
         SET refund_status = 'paid', refund_paid_piasters = refund_paid_piasters + $2,
             refund_recorded_by_staff_id = $3, refund_recorded_at = $4,
             updated_by_staff_id = $3, updated_at = $4
         WHERE id = $1 AND status = 'posted' RETURNING id`,
        [input.returnId, input.amountPiasters, input.actorStaffId, input.recordedAt],
      );
      if (!updatedRow.rows[0]) throw new OperationConflictError();
      const updated = await loadReturn(queryable, input.returnId, false);
      const event = await loadEventByOperation(queryable, input.operationId);
      if (!updated || !event) throw new Error("Paid refund could not be loaded.");
      return { kind: "created", record: updated, event };
    },
  };
}

export function createPostgresReturnsUnitOfWork(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
  onlineSourcesFor: (client: PoolClient) => DeliveredOnlineOrderSourceReader,
  correctionsFor: (client: PoolClient) => ReturnCorrectionStateReader,
  replacementSalesFor: (client: PoolClient, inventory: InventoryTransaction) => ReturnReplacementSaleWriter,
  sourceCandidatesFor: (client: PoolClient) => PhysicalSourceCandidates,
): ReturnsUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await client.query("BEGIN");
            await client.query("SELECT restore_enter_business_write()");
            const inventory = inventoryFor(client);
            const value = await work({
              returns: createPostgresReturnsStore(client, sourceCandidatesFor(client)),
              inventory,
              onlineSources: onlineSourcesFor(client),
              corrections: correctionsFor(client),
              replacementSales: replacementSalesFor(client, inventory),
            });
            await client.query("COMMIT");
            return value;
          } catch (error) {
            await client.query("ROLLBACK");
            const code = typeof error === "object" && error !== null && "code" in error
              ? String(error.code)
              : "";
            if (attempt < 2 && (code === "40001" || code === "40P01")) continue;
            throw error;
          }
        }
        throw new Error("Returns transaction retry limit exceeded.");
      } finally {
        client.release();
      }
    },
  };
}

async function loadPhysicalSource(queryable: Queryable, saleId: string, lock: boolean): Promise<ReturnSourceRecord | null> {
  const result = await queryable.query<SourceRow>(
    `SELECT s.id, s.reference, s.operation_id, s.branch_id, s.sold_by_staff_id, s.sold_by_display_name,
            s.occurred_at,
            to_char(s.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_key,
            ((s.occurred_at AT TIME ZONE 'Africa/Cairo') + interval '14 days')
              AT TIME ZONE 'Africa/Cairo' AS return_deadline_at,
            COALESCE(latest.effective_total_piasters, s.final_total_piasters) AS final_total_piasters,
            s.customer_name, s.customer_phone, latest.id AS correction_id
     FROM sales_sale s
     LEFT JOIN LATERAL (
       SELECT c.id, c.change_type, c.effective_total_piasters
       FROM recording_correction c WHERE c.sale_id = s.id ORDER BY c.revision DESC LIMIT 1
     ) latest ON true
     WHERE s.id = $1 AND s.physically_completed = true
       AND COALESCE(latest.change_type, 'correction') <> 'cancellation'
     ${lock ? "FOR UPDATE OF s" : ""}`,
    [saleId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [linesResult, unitsResult, returnedResult, allocationsResult] = await Promise.all([
    queryable.query<SourceLineRow>(
      `SELECT sl.id, sl.variant_id, COALESCE(v.quantity, sl.quantity)::int AS quantity,
              COALESCE(v.paid_piasters, sl.paid_piasters) AS paid_piasters, sl.line_index
       FROM sales_sale_line sl
       LEFT JOIN recording_sale_line_value v
         ON v.correction_id = $2::uuid AND v.sale_line_id = sl.id
       WHERE sl.sale_id = $1 ORDER BY sl.line_index`,
      [saleId, row.correction_id],
    ),
    row.correction_id
      ? queryable.query<SourceUnitRow>(
          `SELECT u.id, u.sale_line_id AS line_id, sl.variant_id, u.unit_index,
                  u.quantity, u.paid_unit_piasters AS paid_piasters, 'correction'::text AS source_type
           FROM recording_sale_unit_value u
           JOIN sales_sale_line sl ON sl.id = u.sale_line_id
           WHERE u.correction_id = $1 ORDER BY sl.line_index, u.unit_index`, [row.correction_id])
      : queryable.query<SourceUnitRow>(
          `SELECT u.id, u.line_id, l.variant_id, u.unit_index, u.quantity, u.paid_piasters,
                  'original'::text AS source_type
           FROM sales_sale_unit u JOIN sales_sale_line l ON l.id = u.line_id
           WHERE u.sale_id = $1 ORDER BY l.line_index, u.unit_index`, [saleId]),
    queryable.query<{ source_sale_line_id: string; quantity: number | string }>(
      `SELECT rl.source_sale_line_id,
              COALESCE(SUM(CASE WHEN latest.change_type = 'cancellation' THEN 0
                ELSE COALESCE(v.quantity, rl.quantity) END), 0)::int AS quantity
       FROM returns_return_line rl
       JOIN returns_return r ON r.id = rl.return_id
       LEFT JOIN LATERAL (
         SELECT c.id, c.change_type FROM recording_correction c
         WHERE c.return_id = r.id ORDER BY c.revision DESC LIMIT 1
       ) latest ON true
       LEFT JOIN recording_return_line_value v
         ON v.correction_id = latest.id AND v.return_line_id = rl.id
       WHERE r.source_sale_id = $1 AND r.status = 'posted'
       GROUP BY rl.source_sale_line_id`, [saleId]),
    queryable.query<AllocationRow>(
      `WITH effects AS (
         SELECT a.batch_id, a.variant_id, COALESCE(a.requested_variant_id, a.variant_id) AS requested_variant_id,
                a.unit_cost_piasters, a.quantity::bigint AS amount
         FROM inventory_allocation a WHERE a.operation_id = $1
         UNION ALL
         SELECT f.batch_id, f.variant_id, COALESCE(sl.variant_id, f.variant_id) AS requested_variant_id,
                f.unit_cost_piasters,
                CASE WHEN f.direction = 'deduct' THEN f.quantity ELSE -f.quantity END
         FROM recording_merchandise_fact f
         JOIN recording_correction c ON c.id = f.correction_id
         LEFT JOIN sales_sale_line sl ON sl.id = f.sale_line_id
         WHERE c.sale_id = $2
       )
       SELECT e.batch_id, e.variant_id, e.requested_variant_id, SUM(e.amount)::int AS quantity,
              e.unit_cost_piasters, b.effective_unit_cost_piasters, b.recorded_at
       FROM effects e JOIN inventory_batch b ON b.id = e.batch_id
       GROUP BY e.batch_id, e.variant_id, e.requested_variant_id, e.unit_cost_piasters,
                b.effective_unit_cost_piasters, b.recorded_at
       HAVING SUM(e.amount) > 0
       ORDER BY e.requested_variant_id, b.recorded_at, e.batch_id`, [row.operation_id, saleId]),
  ]);
  const returnedByLine = new Map(returnedResult.rows.map((item) => [item.source_sale_line_id, asSafeInteger(item.quantity)]));
  const unitsByLine = new Map<string, ReturnSourceUnit[]>();
  for (const unit of unitsResult.rows) {
    const list = unitsByLine.get(unit.line_id) ?? [];
    const alreadyBefore = list.reduce((sum, item) => sum + item.quantity, 0);
    const returnedForLine = returnedByLine.get(unit.line_id) ?? 0;
    const alreadyReturnedQuantity = Math.min(unit.quantity, Math.max(0, returnedForLine - alreadyBefore));
    list.push({
      id: unit.id,
      sourceType: unit.source_type,
      lineId: unit.line_id,
      variantId: unit.variant_id,
      unitIndex: unit.unit_index,
      quantity: unit.quantity,
      paidPiasters: asSafeInteger(unit.paid_piasters),
      alreadyReturnedQuantity,
      returnedRanges: alreadyReturnedQuantity > 0 ? [{ startOffset: 0, quantity: alreadyReturnedQuantity }] : [],
    });
    unitsByLine.set(unit.line_id, list);
  }
  const lines: ReturnSourceLine[] = linesResult.rows.map((line) => ({
    id: line.id,
    variantId: line.variant_id,
    lineIndex: line.line_index,
    quantity: line.quantity,
    paidPiasters: asSafeInteger(line.paid_piasters),
    acceptedNames: null,
    units: unitsByLine.get(line.id) ?? [],
  }));
  return {
    source: { kind: "physical_sale", id: row.id },
    reference: row.reference,
    channel: "physical",
    branchId: row.branch_id,
    seller: { staffId: row.sold_by_staff_id, displayName: row.sold_by_display_name },
    receivedAt: row.occurred_at,
    receivedAtKey: row.received_at_key,
    returnDeadlineAt: row.return_deadline_at,
    originalPayment: {
      merchandisePiasters: asSafeInteger(row.final_total_piasters),
      checkoutChargePiasters: 0,
      totalPiasters: asSafeInteger(row.final_total_piasters),
    },
    availableCheckoutChargePiasters: 0,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines,
    allocations: allocationsResult.rows.map((item) => ({
      allocationId: null,
      sourceLineId: null,
      batchId: item.batch_id,
      variantId: item.variant_id,
      ...(item.requested_variant_id === item.variant_id ? {} : { requestedVariantId: item.requested_variant_id }),
      quantity: item.quantity,
      unitCostPiasters: asSafeInteger(item.unit_cost_piasters),
      effectiveUnitCostPiasters: asSafeInteger(item.effective_unit_cost_piasters),
      recordedAt: item.recorded_at,
    })),
  };
}

async function loadReturn(queryable: Queryable, id: string, lock: boolean): Promise<ReturnRecord | null> {
  const result = await queryable.query<ReturnRow>(
    `SELECT * FROM returns_return WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  const row = result.rows[0];
  return row ? toReturn(queryable, row) : null;
}

async function loadReturnByOperation(queryable: Queryable, operationId: string): Promise<ReturnRecord | null> {
  const result = await queryable.query<ReturnRow>(`SELECT * FROM returns_return WHERE operation_id = $1`, [operationId]);
  const row = result.rows[0];
  return row ? toReturn(queryable, row) : null;
}

async function toReturn(queryable: Queryable, row: ReturnRow): Promise<ReturnRecord> {
  const [lines, restorations, events] = await Promise.all([
    queryable.query<ReturnLineRow>(
      `SELECT rl.*,rl.source_variant_id AS variant_id
       FROM returns_return_line rl
       WHERE rl.return_id = $1 ORDER BY rl.line_index`,
      [row.id],
    ),
    queryable.query<RestorationRow>(
      `SELECT r.id, r.return_id, r.batch_id, r.variant_id, r.quantity, r.unit_cost_piasters,
              b.effective_unit_cost_piasters
       FROM returns_batch_restoration r
       JOIN inventory_batch b ON b.id = r.batch_id
       WHERE r.return_id = $1 ORDER BY r.batch_id`,
      [row.id],
    ),
    queryable.query<EventRow>(
      `SELECT operation_id, return_id, status, amount_piasters, payload_fingerprint, actor_staff_id, recorded_at
       FROM returns_refund_event WHERE return_id = $1 ORDER BY recorded_at, operation_id`,
      [row.id],
    ),
  ]);
  return {
    id: row.id,
    reference: row.reference,
    reason: row.reason,
    operationId: row.operation_id,
    source: row.source_sale_id
      ? { kind: "physical_sale", id: row.source_sale_id }
      : { kind: "delivered_online_order", id: row.source_online_order_id! },
    handlingBranchId: row.handling_branch_id,
    status: row.status,
    revision: row.revision,
    payloadFingerprint: row.payload_fingerprint,
    draftPayloadFingerprint: row.draft_payload_fingerprint,
    suggestedRefundPiasters: asSafeInteger(row.suggested_refund_piasters),
    authorizedRefundPiasters: asSafeInteger(row.authorized_refund_piasters),
    suggestedRefund: {
      merchandisePiasters: asSafeInteger(row.suggested_merchandise_refund_piasters),
      checkoutChargePiasters: asSafeInteger(row.suggested_checkout_charge_refund_piasters),
      totalPiasters: asSafeInteger(row.suggested_refund_piasters),
    },
    authorizedRefund: {
      merchandisePiasters: asSafeInteger(row.authorized_merchandise_refund_piasters),
      checkoutChargePiasters: asSafeInteger(row.authorized_checkout_charge_refund_piasters),
      totalPiasters: asSafeInteger(row.authorized_refund_piasters),
    },
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
    updatedByStaffId: row.updated_by_staff_id,
    updatedAt: row.updated_at,
    postedByStaffId: row.posted_by_staff_id,
    postedAt: row.posted_at,
    refundStatus: row.refund_status,
    refundPaidPiasters: asSafeInteger(row.refund_paid_piasters),
    exchangeCreditAppliedPiasters: asSafeInteger(row.exchange_credit_applied_piasters),
    refundRecordedByStaffId: row.refund_recorded_by_staff_id,
    refundRecordedAt: row.refund_recorded_at,
    lines: lines.rows.map(toReturnLine),
    restorations: restorations.rows.map(toRestoration),
    refundEvents: events.rows.map(toEvent),
  };
}

async function loadExchange(
  queryable: Queryable,
  column: "id" | "operation_id" | "return_id",
  value: string,
  lock: boolean,
): Promise<ReturnExchangeRecord | null> {
  const result = await queryable.query<ExchangeRow>(
    `SELECT * FROM returns_exchange WHERE ${column} = $1 ${lock ? "FOR UPDATE" : ""}`,
    [value],
  );
  return result.rows[0] ? toExchange(result.rows[0]) : null;
}

function toExchange(row: ExchangeRow): ReturnExchangeRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    returnId: row.return_id,
    replacementSaleId: row.replacement_sale_id,
    payloadFingerprint: row.payload_fingerprint,
    creditAvailablePiasters: asSafeInteger(row.credit_available_piasters),
    creditAppliedPiasters: asSafeInteger(row.credit_applied_piasters),
    cashCollectedPiasters: asSafeInteger(row.cash_collected_piasters),
    cashRefundStatus: row.cash_refund_status,
    cashRefundPiasters: asSafeInteger(row.cash_refund_piasters),
    cashRefundPaidPiasters: asSafeInteger(row.cash_refund_paid_piasters),
    completedByStaffId: row.completed_by_staff_id,
    completedAt: row.completed_at,
  };
}

function toExchangeQuote(row: ExchangeQuoteRow): ReturnExchangeQuoteRecord {
  return {
    id: row.id,
    returnId: row.return_id,
    returnRevision: row.return_revision,
    correctionRevision: row.correction_revision,
    creditAvailablePiasters: asSafeInteger(row.credit_available_piasters),
    settlement: row.settlement_identity,
    payloadFingerprint: row.payload_fingerprint,
    acceptedQuote: row.accepted_quote,
    quotedByStaffId: row.quoted_by_staff_id,
    quotedAt: row.quoted_at,
  };
}

function toReturnListRecord(row: ReturnListRow): ReturnListRecord {
  const originalBranch = row.original_branch_id && row.original_branch_code && row.original_branch_name_ar
    ? { id: row.original_branch_id, code: row.original_branch_code, nameAr: row.original_branch_name_ar }
    : null;
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customer_name,
    reason: row.reason,
    lines: [],
    status: row.status,
    revision: row.revision,
    source: row.source_sale_id
      ? { kind: "physical_sale", id: row.source_sale_id }
      : { kind: "delivered_online_order", id: row.source_online_order_id! },
    sourceReference: row.source_reference,
    channel: row.channel,
    originalBranch,
    handlingBranch: {
      id: row.handling_branch_id,
      code: row.handling_branch_code,
      nameAr: row.handling_branch_name_ar,
    },
    authorizedRefundPiasters: asSafeInteger(row.authorized_refund_piasters),
    authorizedRefund: {
      merchandisePiasters: asSafeInteger(row.authorized_merchandise_refund_piasters),
      checkoutChargePiasters: asSafeInteger(row.authorized_checkout_charge_refund_piasters),
      totalPiasters: asSafeInteger(row.authorized_refund_piasters),
    },
    refundStatus: row.refund_status,
    createdAt: row.created_at,
    postedAt: row.posted_at,
  };
}

async function loadEventByOperation(queryable: Queryable, operationId: string): Promise<RefundEventRecord & { returnId: string } | null> {
  const result = await queryable.query<EventRow>(
    `SELECT operation_id, return_id, status, amount_piasters, payload_fingerprint, actor_staff_id, recorded_at
     FROM returns_refund_event WHERE operation_id = $1`,
    [operationId],
  );
  const row = result.rows[0];
  return row ? { ...toEvent(row), returnId: row.return_id } : null;
}

function toReturnLine(row: ReturnLineRow): ReturnLineWrite {
  return {
    id: row.id,
    sourceLineId: row.source_sale_line_id ?? row.source_online_order_line_id!,
    variantId: row.variant_id,
    quantity: row.quantity,
    sellableQuantity: row.sellable_quantity,
    suggestedRefundPiasters: asSafeInteger(row.suggested_refund_piasters),
    lineIndex: row.line_index,
  };
}

function toRestoration(row: RestorationRow): ReturnRestorationWrite {
  return {
    id: row.id,
    batchId: row.batch_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitCostPiasters: asSafeInteger(row.unit_cost_piasters),
    effectiveUnitCostPiasters: asSafeInteger(row.effective_unit_cost_piasters),
  };
}

function toEvent(row: EventRow): RefundEventRecord {
  return {
    operationId: row.operation_id,
    status: row.status,
    amountPiasters: asSafeInteger(row.amount_piasters),
    payloadFingerprint: row.payload_fingerprint,
    actorStaffId: row.actor_staff_id,
    recordedAt: row.recorded_at,
  };
}


function asSafeInteger(value: number | string) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number)) throw new Error("Unrepresentable monetary value.");
  return number;
}
