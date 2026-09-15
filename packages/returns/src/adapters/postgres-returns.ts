import type { Pool, PoolClient } from "pg";
import type { InventoryTransaction } from "@bravos/inventory";
import { OperationConflictError } from "@bravos/inventory";
import type {
  RefundEventRecord,
  ReturnLineWrite,
  ReturnListRecord,
  ReturnRecord,
  ReturnRestorationWrite,
  ReturnCorrectionStateReader,
  ReturnsStore,
  ReturnsUnitOfWork,
  ReturnSourceLine,
  ReturnSourceRecord,
  ReturnSourceUnit,
  SourceSearch,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

type SourceRow = {
  id: string;
  operation_id: string;
  branch_id: string;
  sold_by_staff_id: string;
  sold_by_display_name: string;
  occurred_at: Date;
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
  quantity: number;
  unit_cost_piasters: number | string;
  recorded_at: Date;
};

type ReturnRow = {
  id: string;
  operation_id: string;
  source_sale_id: string;
  handling_branch_id: string;
  status: "draft" | "posted";
  revision: number;
  payload_fingerprint: string;
  draft_payload_fingerprint: string;
  suggested_refund_piasters: number | string;
  authorized_refund_piasters: number | string;
  created_by_staff_id: string;
  created_at: Date;
  updated_by_staff_id: string;
  updated_at: Date;
  posted_by_staff_id: string | null;
  posted_at: Date | null;
  refund_status: "none" | "owed" | "paid";
  refund_paid_piasters: number | string;
  refund_recorded_by_staff_id: string | null;
  refund_recorded_at: Date | null;
};

type ReturnListRow = {
  id: string;
  status: "draft" | "posted";
  revision: number;
  source_sale_id: string;
  source_reference: string;
  original_branch_id: string;
  original_branch_code: ReturnListRecord["originalBranch"]["code"];
  original_branch_name_ar: string;
  handling_branch_id: string;
  handling_branch_code: ReturnListRecord["handlingBranch"]["code"];
  handling_branch_name_ar: string;
  authorized_refund_piasters: number | string;
  refund_status: "none" | "owed" | "paid";
  created_at: Date;
  posted_at: Date | null;
};

type ReturnLineRow = {
  id: string;
  return_id: string;
  source_sale_line_id: string;
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

export function createPostgresReturnsStore(queryable: Queryable): ReturnsStore {
  return {
    async listSources(search) {
      const result = await queryable.query<{ id: string }>(sourceSearchSql(search), sourceSearchParams(search));
      const rows: ReturnSourceRecord[] = [];
      for (const item of result.rows) {
        const source = await loadSource(queryable, item.id, false);
        if (source && (search.amountPiasters === undefined || source.finalTotalPiasters === search.amountPiasters)) rows.push(source);
      }
      return rows;
    },
    getSource: (saleId, lock = false) => loadSource(queryable, saleId, lock),
    async getSourceSaleId(returnId) {
      const result = await queryable.query<{ source_sale_id: string }>(
        `SELECT source_sale_id FROM returns_return WHERE id = $1`, [returnId]);
      return result.rows[0]?.source_sale_id ?? null;
    },
    async lockIdentities(returnId, operationId) {
      for (const key of [...new Set([returnId, operationId])].sort()) {
        await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      }
    },
    async insertDraft(input) {
      const inserted = await queryable.query<{ id: string }>(
        `INSERT INTO returns_return (
           id, operation_id, source_sale_id, handling_branch_id, status, payload_fingerprint, draft_payload_fingerprint,
           suggested_refund_piasters, authorized_refund_piasters, created_by_staff_id,
           revision, updated_by_staff_id
         ) VALUES ($1, $2, $3, $4, 'draft', $5, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [input.id, input.operationId, input.sourceSaleId, input.handlingBranchId, input.payloadFingerprint,
          input.suggestedRefundPiasters, input.authorizedRefundPiasters, input.createdByStaffId,
          input.revision, input.updatedByStaffId],
      );
      if (!inserted.rows[0]) {
        const existing = await loadReturn(queryable, input.id, false);
        if (!existing) throw new OperationConflictError();
        return { kind: "existing", record: existing };
      }
      for (const line of input.lines) {
        await queryable.query(
          `INSERT INTO returns_return_line (
             id, return_id, source_sale_line_id, quantity, sellable_quantity,
             suggested_refund_piasters, line_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [line.id, input.id, line.sourceSaleLineId, line.quantity, line.sellableQuantity,
            line.suggestedRefundPiasters, line.lineIndex],
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
             revision = revision + 1, updated_by_staff_id = $7, updated_at = $8
         WHERE id = $1 AND status = 'draft' AND revision = $2
         RETURNING id`,
        [input.returnId, input.expectedRevision, input.handlingBranchId, input.draftPayloadFingerprint,
          input.suggestedRefundPiasters, input.authorizedRefundPiasters,
          input.updatedByStaffId, input.updatedAt],
      );
      if (!updated.rows[0]) throw new OperationConflictError("تغيرت المسودة أو تم ترحيلها. أعد تحميلها قبل التعديل.");
      await queryable.query(`DELETE FROM returns_return_line WHERE return_id = $1`, [input.returnId]);
      for (const line of input.lines) {
        await queryable.query(
          `INSERT INTO returns_return_line (
             id, return_id, source_sale_line_id, quantity, sellable_quantity,
             suggested_refund_piasters, line_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [line.id, input.returnId, line.sourceSaleLineId, line.quantity, line.sellableQuantity,
            line.suggestedRefundPiasters, line.lineIndex],
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
        `SELECT r.id, r.status, r.revision, r.source_sale_id, r.source_sale_id::text AS source_reference,
                original_branch.id AS original_branch_id, original_branch.code AS original_branch_code,
                original_branch.name_ar AS original_branch_name_ar,
                handling_branch.id AS handling_branch_id, handling_branch.code AS handling_branch_code,
                handling_branch.name_ar AS handling_branch_name_ar,
                r.authorized_refund_piasters, r.refund_status, r.created_at, r.posted_at
         FROM returns_return r
         JOIN sales_sale source_sale ON source_sale.id = r.source_sale_id
         JOIN branch original_branch ON original_branch.id = source_sale.branch_id
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
        items: visible.map(toReturnListRecord),
        nextCursor: hasMore ? visible.at(-1)?.id ?? null : null,
      };
    },
    getRefundEventByOperation: (operationId) => loadEventByOperation(queryable, operationId),
    async post(input) {
      for (const unit of input.units) {
        await queryable.query(
          `INSERT INTO returns_return_unit (
             id, return_id, return_line_id, source_sale_unit_id, source_recording_sale_unit_id,
             start_offset, quantity, paid_unit_piasters
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [unit.id, input.returnId, unit.returnLineId, unit.sourceSaleUnitId,
            unit.sourceRecordingSaleUnitId, unit.startOffset, unit.quantity, unit.paidUnitPiasters],
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
  correctionsFor: (client: PoolClient) => ReturnCorrectionStateReader,
): ReturnsUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await work({
          returns: createPostgresReturnsStore(client),
          inventory: inventoryFor(client),
          corrections: correctionsFor(client),
        });
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function loadSource(queryable: Queryable, saleId: string, lock: boolean): Promise<ReturnSourceRecord | null> {
  const result = await queryable.query<SourceRow>(
    `SELECT s.id, s.operation_id, s.branch_id, s.sold_by_staff_id, s.sold_by_display_name,
            s.occurred_at,
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
         SELECT a.batch_id, a.variant_id, a.unit_cost_piasters, a.quantity::bigint AS amount
         FROM inventory_allocation a WHERE a.operation_id = $1
         UNION ALL
         SELECT f.batch_id, f.variant_id, f.unit_cost_piasters,
                CASE WHEN f.direction = 'deduct' THEN f.quantity ELSE -f.quantity END
         FROM recording_merchandise_fact f
         JOIN recording_correction c ON c.id = f.correction_id WHERE c.sale_id = $2
       )
       SELECT e.batch_id, e.variant_id, SUM(e.amount)::int AS quantity,
              e.unit_cost_piasters, b.recorded_at
       FROM effects e JOIN inventory_batch b ON b.id = e.batch_id
       GROUP BY e.batch_id, e.variant_id, e.unit_cost_piasters, b.recorded_at
       HAVING SUM(e.amount) > 0
       ORDER BY e.variant_id, b.recorded_at, e.batch_id`, [row.operation_id, saleId]),
  ]);
  const returnedByLine = new Map(returnedResult.rows.map((item) => [item.source_sale_line_id, asSafeInteger(item.quantity)]));
  const unitsByLine = new Map<string, ReturnSourceUnit[]>();
  for (const unit of unitsResult.rows) {
    const list = unitsByLine.get(unit.line_id) ?? [];
    const alreadyBefore = list.reduce((sum, item) => sum + item.alreadyReturnedQuantity, 0);
    const returnedForLine = returnedByLine.get(unit.line_id) ?? 0;
    list.push({
      id: unit.id,
      sourceType: unit.source_type,
      lineId: unit.line_id,
      variantId: unit.variant_id,
      unitIndex: unit.unit_index,
      quantity: unit.quantity,
      paidPiasters: asSafeInteger(unit.paid_piasters),
      alreadyReturnedQuantity: Math.min(unit.quantity, Math.max(0, returnedForLine - alreadyBefore)),
    });
    unitsByLine.set(unit.line_id, list);
  }
  const lines: ReturnSourceLine[] = linesResult.rows.map((line) => ({
    id: line.id,
    variantId: line.variant_id,
    lineIndex: line.line_index,
    quantity: line.quantity,
    paidPiasters: asSafeInteger(line.paid_piasters),
    units: unitsByLine.get(line.id) ?? [],
  }));
  return {
    saleId: row.id,
    operationId: row.operation_id,
    branchId: row.branch_id,
    soldByStaffId: row.sold_by_staff_id,
    soldByDisplayName: row.sold_by_display_name,
    occurredAt: row.occurred_at,
    returnDeadlineAt: row.return_deadline_at,
    finalTotalPiasters: asSafeInteger(row.final_total_piasters),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    lines,
    allocations: allocationsResult.rows.map((item) => ({
      batchId: item.batch_id,
      variantId: item.variant_id,
      quantity: item.quantity,
      unitCostPiasters: asSafeInteger(item.unit_cost_piasters),
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
      `SELECT rl.*, sl.variant_id
       FROM returns_return_line rl JOIN sales_sale_line sl ON sl.id = rl.source_sale_line_id
       WHERE rl.return_id = $1 ORDER BY rl.line_index`,
      [row.id],
    ),
    queryable.query<RestorationRow>(
      `SELECT id, return_id, batch_id, variant_id, quantity, unit_cost_piasters
       FROM returns_batch_restoration WHERE return_id = $1 ORDER BY batch_id`,
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
    operationId: row.operation_id,
    sourceSaleId: row.source_sale_id,
    handlingBranchId: row.handling_branch_id,
    status: row.status,
    revision: row.revision,
    payloadFingerprint: row.payload_fingerprint,
    draftPayloadFingerprint: row.draft_payload_fingerprint,
    suggestedRefundPiasters: asSafeInteger(row.suggested_refund_piasters),
    authorizedRefundPiasters: asSafeInteger(row.authorized_refund_piasters),
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
    updatedByStaffId: row.updated_by_staff_id,
    updatedAt: row.updated_at,
    postedByStaffId: row.posted_by_staff_id,
    postedAt: row.posted_at,
    refundStatus: row.refund_status,
    refundPaidPiasters: asSafeInteger(row.refund_paid_piasters),
    refundRecordedByStaffId: row.refund_recorded_by_staff_id,
    refundRecordedAt: row.refund_recorded_at,
    lines: lines.rows.map(toReturnLine),
    restorations: restorations.rows.map(toRestoration),
    refundEvents: events.rows.map(toEvent),
  };
}

function toReturnListRecord(row: ReturnListRow): ReturnListRecord {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    sourceSaleId: row.source_sale_id,
    sourceReference: row.source_reference,
    originalBranch: {
      id: row.original_branch_id,
      code: row.original_branch_code,
      nameAr: row.original_branch_name_ar,
    },
    handlingBranch: {
      id: row.handling_branch_id,
      code: row.handling_branch_code,
      nameAr: row.handling_branch_name_ar,
    },
    authorizedRefundPiasters: asSafeInteger(row.authorized_refund_piasters),
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
    sourceSaleLineId: row.source_sale_line_id,
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

function sourceSearchSql(search: SourceSearch) {
  const where = ["s.physically_completed = true"];
  if (search.reference) where.push("(s.id::text ILIKE '%' || $1 || '%' OR s.operation_id::text ILIKE '%' || $1 || '%')");
  if (search.date) where.push(`(s.occurred_at AT TIME ZONE 'Africa/Cairo')::date = $${paramIndex(search, "date")}::date`);
  if (search.branchId) where.push(`s.branch_id = $${paramIndex(search, "branchId")}::uuid`);
  if (search.item) {
    const index = paramIndex(search, "item");
    where.push(`EXISTS (
      SELECT 1 FROM sales_sale_line sl
      JOIN catalog_product_variant v ON v.id = sl.variant_id
      JOIN catalog_product p ON p.id = v.product_id
      JOIN catalog_size sz ON sz.id = v.size_id
      JOIN catalog_color c ON c.id = v.color_id
      WHERE sl.sale_id = s.id AND (p.code ILIKE '%' || $${index} || '%' OR p.name_ar ILIKE '%' || $${index} || '%'
        OR sz.name_ar ILIKE '%' || $${index} || '%' OR c.name_ar ILIKE '%' || $${index} || '%')
    )`);
  }
  return `SELECT s.id FROM sales_sale s WHERE ${where.join(" AND ")} ORDER BY s.occurred_at DESC, s.id DESC LIMIT 100`;
}

function sourceSearchParams(search: SourceSearch) {
  const params: unknown[] = [];
  if (search.reference) params.push(search.reference);
  if (search.date) params.push(search.date);
  if (search.branchId) params.push(search.branchId);
  if (search.item) params.push(search.item);
  return params;
}

function paramIndex(search: SourceSearch, key: keyof SourceSearch) {
  const order: Array<keyof SourceSearch> = ["reference", "date", "branchId", "item", "amountPiasters"];
  return order.filter((item) => order.indexOf(item) <= order.indexOf(key) && search[item] !== undefined).length;
}

function asSafeInteger(value: number | string) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number)) throw new Error("Unrepresentable monetary value.");
  return number;
}
