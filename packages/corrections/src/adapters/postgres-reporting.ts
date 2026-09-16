import type { Pool, PoolClient } from "pg";
import type {
  ReturnCorrectionReportingFact,
  ReturnCorrectionReportingReader,
  SaleCorrectionReportingFact,
  SaleCorrectionReportingReader,
} from "../application/reporting-ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type CorrectionRow = {
  id: string;
  sale_id: string;
  change_type: "correction" | "cancellation";
  revision: number;
  reason: string;
  effective_total_piasters: number | string | null;
  changed_by_staff_id: string;
  changed_at: Date;
};

export function createPostgresSaleCorrectionReportingReader(queryable: Queryable): SaleCorrectionReportingReader {
  return {
    async listEffectiveFacts(saleIds) {
      if (saleIds.length === 0) return [];
      const [historyResult, latestResult] = await Promise.all([
        queryable.query<CorrectionRow>(
          `SELECT id,sale_id,change_type,revision,reason,effective_total_piasters,changed_by_staff_id,changed_at
           FROM recording_correction
           WHERE sale_id = ANY($1::uuid[])
           ORDER BY sale_id,revision`,
          [saleIds],
        ),
        queryable.query<CorrectionRow>(
          `SELECT DISTINCT ON (sale_id)
                  id,sale_id,change_type,revision,reason,effective_total_piasters,changed_by_staff_id,changed_at
           FROM recording_correction
           WHERE sale_id = ANY($1::uuid[])
           ORDER BY sale_id,revision DESC`,
          [saleIds],
        ),
      ]);
      const latestIds = latestResult.rows.filter((row) => row.change_type === "correction").map((row) => row.id);
      const changeIds = historyResult.rows.map((row) => row.id);
      const [lineResult, merchandiseResult] = await Promise.all([
        latestIds.length === 0
          ? Promise.resolve({ rows: [] as Array<{ correction_id: string; sale_line_id: string; quantity: number; paid_piasters: number | string }> })
          : queryable.query<{ correction_id: string; sale_line_id: string; quantity: number; paid_piasters: number | string }>(
            `SELECT correction_id,sale_line_id,quantity,paid_piasters
             FROM recording_sale_line_value
             WHERE correction_id = ANY($1::uuid[])
             ORDER BY correction_id,sale_line_id`,
            [latestIds],
          ),
        changeIds.length === 0
          ? Promise.resolve({ rows: [] as Array<{ correction_id: string; line_id: string; variant_id: string; direction: "restore" | "deduct"; batch_id: string; quantity: number }> })
          : queryable.query<{ correction_id: string; line_id: string; variant_id: string; direction: "restore" | "deduct"; batch_id: string; quantity: number }>(
            `SELECT correction_id,sale_line_id AS line_id,variant_id,direction,batch_id,quantity
             FROM recording_merchandise_fact
             WHERE correction_id = ANY($1::uuid[]) AND target_line_type = 'sale'
             ORDER BY correction_id,id`,
            [changeIds],
          ),
      ]);
      const historyBySale = group(historyResult.rows, (row) => row.sale_id);
      const linesByCorrection = group(lineResult.rows, (row) => row.correction_id);
      const merchandiseByCorrection = group(merchandiseResult.rows, (row) => row.correction_id);
      return latestResult.rows.map((latest): SaleCorrectionReportingFact => {
        const history = historyBySale.get(latest.sale_id) ?? [];
        return {
          saleId: latest.sale_id,
          revision: latest.revision,
          status: latest.change_type === "cancellation" ? "cancelled" : "active",
          effectiveTotalPiasters: latest.effective_total_piasters === null ? null : integer(latest.effective_total_piasters),
          effectiveLines: latest.change_type === "cancellation"
            ? null
            : (linesByCorrection.get(latest.id) ?? []).map((line) => ({
              saleLineId: line.sale_line_id,
              quantity: line.quantity,
              paidPiasters: integer(line.paid_piasters),
            })),
          changes: history.map((change) => ({
            id: change.id,
            type: change.change_type,
            revision: change.revision,
            reason: change.reason,
            changedByStaffId: change.changed_by_staff_id,
            changedAt: change.changed_at,
          })),
          merchandise: history.flatMap((change) => (merchandiseByCorrection.get(change.id) ?? []).map((fact) => ({
            correctionId: fact.correction_id,
            lineId: fact.line_id,
            variantId: fact.variant_id,
            direction: fact.direction,
            batchId: fact.batch_id,
            quantity: fact.quantity,
          }))),
        };
      });
    },
  };
}

export function createPostgresReturnCorrectionReportingReader(queryable: Queryable): ReturnCorrectionReportingReader {
  return {
    async listEffectiveFacts(returnIds) {
      if (returnIds.length === 0) return [];
      const [historyResult, latestResult] = await Promise.all([
        queryable.query<ReturnCorrectionRow>(
          `${RETURN_CORRECTION_SELECT} WHERE return_id=ANY($1::uuid[]) ORDER BY return_id,revision`,
          [returnIds],
        ),
        queryable.query<ReturnCorrectionRow>(
          `${RETURN_CORRECTION_SELECT} WHERE id IN (
             SELECT DISTINCT ON (return_id) id FROM recording_correction
             WHERE return_id=ANY($1::uuid[]) ORDER BY return_id,revision DESC
           ) ORDER BY return_id`,
          [returnIds],
        ),
      ]);
      const latestIds = latestResult.rows.filter((row) => row.change_type === "correction").map((row) => row.id);
      const changeIds = historyResult.rows.map((row) => row.id);
      const [lineResult, merchandiseResult] = await Promise.all([
        latestIds.length === 0
          ? Promise.resolve({ rows: [] as ReturnLineValueRow[] })
          : queryable.query<ReturnLineValueRow>(
            `SELECT correction_id,return_line_id,quantity,sellable_quantity
             FROM recording_return_line_value WHERE correction_id=ANY($1::uuid[])
             ORDER BY correction_id,return_line_id`,
            [latestIds],
          ),
        changeIds.length === 0
          ? Promise.resolve({ rows: [] as MerchandiseRow[] })
          : queryable.query<MerchandiseRow>(
            `SELECT correction_id,return_line_id AS line_id,variant_id,direction,batch_id,quantity
             FROM recording_merchandise_fact
             WHERE correction_id=ANY($1::uuid[]) AND target_line_type='return'
             ORDER BY correction_id,id`,
            [changeIds],
          ),
      ]);
      const historyByReturn = group(historyResult.rows, (row) => row.return_id);
      const linesByCorrection = group(lineResult.rows, (row) => row.correction_id);
      const merchandiseByCorrection = group(merchandiseResult.rows, (row) => row.correction_id);
      return latestResult.rows.map((latest): ReturnCorrectionReportingFact => {
        const history = historyByReturn.get(latest.return_id) ?? [];
        return {
          returnId: latest.return_id,
          revision: latest.revision,
          status: latest.change_type === "cancellation" ? "cancelled" : "active",
          effectiveRefund: latest.change_type === "cancellation" ? null : {
            merchandisePiasters: integer(latest.effective_refund_merchandise_piasters ?? 0),
            checkoutChargePiasters: integer(latest.effective_refund_checkout_charge_piasters ?? 0),
            totalPiasters: integer(latest.effective_total_piasters ?? 0),
          },
          effectiveLines: latest.change_type === "cancellation" ? null : (linesByCorrection.get(latest.id) ?? []).map((line) => ({
            returnLineId: line.return_line_id,
            quantity: line.quantity,
            sellableQuantity: line.sellable_quantity,
          })),
          changes: history.map(changeAudit),
          cashEvents: history.flatMap((change) => change.cash_direction ? [{
            direction: change.cash_direction,
            amountPiasters: integer(change.cash_amount_piasters),
            recordedAt: change.changed_at,
          }] : []),
          merchandise: history.flatMap((change) => (merchandiseByCorrection.get(change.id) ?? []).map((fact) => ({
            correctionId: fact.correction_id,
            lineId: fact.line_id,
            variantId: fact.variant_id,
            direction: fact.direction,
            batchId: fact.batch_id,
            quantity: fact.quantity,
          }))),
        };
      });
    },
  };
}

type ReturnCorrectionRow = Omit<CorrectionRow, "sale_id"> & {
  return_id: string;
  effective_refund_merchandise_piasters: number | string | null;
  effective_refund_checkout_charge_piasters: number | string | null;
  cash_direction: "paid_out" | "recovered" | null;
  cash_amount_piasters: number | string;
};
type ReturnLineValueRow = { correction_id: string; return_line_id: string; quantity: number; sellable_quantity: number };
type MerchandiseRow = { correction_id: string; line_id: string; variant_id: string; direction: "restore" | "deduct"; batch_id: string; quantity: number };
const RETURN_CORRECTION_SELECT = `SELECT id,return_id,change_type,revision,reason,effective_total_piasters,
  effective_refund_merchandise_piasters,effective_refund_checkout_charge_piasters,
  cash_direction,cash_amount_piasters,changed_by_staff_id,changed_at FROM recording_correction`;

function changeAudit(change: Pick<CorrectionRow, "id" | "change_type" | "revision" | "reason" | "changed_by_staff_id" | "changed_at">) {
  return { id: change.id, type: change.change_type, revision: change.revision, reason: change.reason,
    changedByStaffId: change.changed_by_staff_id, changedAt: change.changed_at };
}

function group<T, K>(rows: T[], key: (row: T) => K) {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const values = grouped.get(key(row)) ?? [];
    values.push(row);
    grouped.set(key(row), values);
  }
  return grouped;
}

function integer(value: number | string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable correction reporting value.");
  return parsed;
}
