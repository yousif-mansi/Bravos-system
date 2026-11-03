import type { Pool, PoolClient } from "pg";
import type { PurchaseReportingFact, PurchaseReportingReader, ReceiptLineWrite, ReceiptRecord } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresPurchaseReportingReader(queryable: Queryable): PurchaseReportingReader {
  return {
    async countReceiptFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count FROM receiving_receipt
         WHERE receipt_date >= $1::date AND receipt_date <= $2::date`,
        [input.fromDate, input.toDateInclusive],
      );
      return integer(result.rows[0]?.count ?? 0);
    },
    async listReceiptFactsPage(input) {
      const receipts = await queryable.query<{
        id: string; branch_id: string; operation_id: string; supplier_id: string | null; supplier_name_ar: string | null;
        receipt_date: string; received_by_staff_id: string; recorded_at: Date;
      }>(
        `SELECT r.id, r.branch_id, r.operation_id, r.supplier_id, s.name_ar AS supplier_name_ar,
                r.receipt_date::text AS receipt_date, r.received_by_staff_id, r.recorded_at
         FROM receiving_receipt r
         LEFT JOIN supplier s ON s.id = r.supplier_id
         WHERE r.receipt_date >= $1::date AND r.receipt_date <= $2::date
           AND ($3::date IS NULL OR (r.receipt_date, r.id) < ($3::date, $4::uuid))
         ORDER BY r.receipt_date DESC, r.id DESC LIMIT $5`,
        [input.fromDate, input.toDateInclusive, input.after?.receiptDate ?? null, input.after?.id ?? null, input.limit],
      );
      const ids = receipts.rows.map((row) => row.id);
      if (ids.length === 0) return [];
      const [lines, corrections] = await Promise.all([
        queryable.query<{
          id: string; receipt_id: string; variant_id: string; quantity: number;
          unit_cost_piasters: number | string; batch_id: string; line_index: number;
        }>(
          `SELECT id,receipt_id,variant_id,quantity,unit_cost_piasters,batch_id,line_index
           FROM receiving_receipt_line WHERE receipt_id=ANY($1::uuid[])
           ORDER BY receipt_id,line_index`,
          [ids],
        ),
        queryable.query<{
          id: string; receipt_id: string; revision: number; reason: string;
          changed_by_staff_id: string; changed_at: Date;
        }>(
          `SELECT id,receipt_id,revision,reason,changed_by_staff_id,changed_at
           FROM receiving_correction WHERE receipt_id=ANY($1::uuid[])
           ORDER BY receipt_id,revision`,
          [ids],
        ),
      ]);
      const linesByReceipt = group(lines.rows, (row) => row.receipt_id);
      const correctionsByReceipt = group(corrections.rows, (row) => row.receipt_id);
      return receipts.rows.map((row): PurchaseReportingFact => ({
        receipt: {
          id: row.id,
          branchId: row.branch_id,
          operationId: row.operation_id,
          supplierId: row.supplier_id,
          supplierNameAr: row.supplier_name_ar,
          receiptDate: row.receipt_date,
          receivedByStaffId: row.received_by_staff_id,
          recordedAt: row.recorded_at,
          lines: (linesByReceipt.get(row.id) ?? []).map((line): ReceiptLineWrite => ({
            id: line.id,
            variantId: line.variant_id,
            quantity: line.quantity,
            unitCostPiasters: integer(line.unit_cost_piasters),
            batchId: line.batch_id,
          })),
        } satisfies ReceiptRecord,
        corrections: (correctionsByReceipt.get(row.id) ?? []).map((correction) => ({
          id: correction.id,
          revision: correction.revision,
          reason: correction.reason,
          changedByStaffId: correction.changed_by_staff_id,
          changedAt: correction.changed_at,
        })),
      }));
    },
  };
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
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable purchase reporting value.");
  return parsed;
}
