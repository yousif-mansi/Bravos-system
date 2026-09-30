import type { ReturnRefundBreakdownDto, ReturnSourceKeyDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { ReturnReportingFact, ReturnReportingFactsReader, ReturnReportingHeader } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresReturnReportingFactsReader(queryable: Queryable): ReturnReportingFactsReader {
  return {
    async listPostedHeadersPage(input) {
      const result = await queryable.query<{
        id: string; posted_at: Date; source_sale_id: string | null;
        source_online_order_id: string | null; handling_branch_id: string;
      }>(
        `SELECT r.id,r.posted_at,r.source_sale_id,r.source_online_order_id,r.handling_branch_id
         FROM returns_return r
         WHERE r.status='posted' AND r.posted_at >= $1 AND r.posted_at < $2
           AND ($3::timestamptz IS NULL OR (r.posted_at,r.id) < ($3,$4::uuid))
         ORDER BY r.posted_at DESC,r.id DESC LIMIT $5`,
        [input.from, input.to, input.after?.postedAt ?? null, input.after?.id ?? null, input.limit],
      );
      return result.rows.map((row): ReturnReportingHeader => {
        const source: ReturnSourceKeyDto = row.source_sale_id
          ? { kind: "physical_sale", id: row.source_sale_id }
          : { kind: "delivered_online_order", id: required(row.source_online_order_id) };
        return { returnId: row.id, postedAt: row.posted_at, source,
          channel: source.kind === "physical_sale" ? "physical" : "online",
          handlingBranchId: row.handling_branch_id };
      });
    },
    async listPostedFactsPage(input) {
      const headers = await queryable.query<{
        id: string; reference: string; posted_at: Date; source_sale_id: string | null; source_online_order_id: string | null;
        handling_branch_id: string; authorized_refund_piasters: number | string;
        authorized_merchandise_refund_piasters: number | string;
        authorized_checkout_charge_refund_piasters: number | string; refund_paid_piasters: number | string;
        replacement_sale_id: string | null; credit_applied_piasters: number | string | null;
        cash_collected_piasters: number | string | null; cash_refund_paid_piasters: number | string | null;
        exchange_completed_at: Date | null;
      }>(
        `SELECT r.id,r.reference,r.posted_at,r.source_sale_id,r.source_online_order_id,r.handling_branch_id,
                r.authorized_refund_piasters,r.authorized_merchandise_refund_piasters,
                r.authorized_checkout_charge_refund_piasters,r.refund_paid_piasters,
                exchange.replacement_sale_id,exchange.credit_applied_piasters,
                exchange.cash_collected_piasters,exchange.cash_refund_paid_piasters,
                exchange.completed_at AS exchange_completed_at
         FROM returns_return r
         LEFT JOIN returns_exchange exchange ON exchange.return_id=r.id
         WHERE r.status='posted' AND r.posted_at >= $1 AND r.posted_at < $2
           AND ($3::timestamptz IS NULL OR (r.posted_at,r.id) < ($3,$4::uuid))
         ORDER BY r.posted_at DESC,r.id DESC LIMIT $5`,
        [input.from, input.to, input.after?.postedAt ?? null, input.after?.id ?? null, input.limit],
      );
      const ids = headers.rows.map((row) => row.id);
      if (ids.length === 0) return [];
      const [lines, restorations, refundEvents] = await Promise.all([
        queryable.query<{
          id: string; return_id: string; source_line_id: string; source_variant_id: string;
          quantity: number; sellable_quantity: number;
        }>(
          `SELECT id,return_id,COALESCE(source_sale_line_id,source_online_order_line_id) AS source_line_id,
                  source_variant_id,quantity,sellable_quantity
           FROM returns_return_line WHERE return_id=ANY($1::uuid[])
           ORDER BY return_id,line_index`,
          [ids],
        ),
        queryable.query<{
          return_id: string; batch_id: string; variant_id: string; quantity: number; unit_cost_piasters: number | string;
        }>(
          `SELECT return_id,batch_id,variant_id,quantity,unit_cost_piasters
           FROM returns_batch_restoration WHERE return_id=ANY($1::uuid[])
           ORDER BY return_id,id`,
          [ids],
        ),
        queryable.query<{ return_id: string; amount_piasters: number | string; recorded_at: Date }>(
          `SELECT return_id,amount_piasters,recorded_at
           FROM returns_refund_event WHERE return_id=ANY($1::uuid[])
           ORDER BY return_id,recorded_at,id`,
          [ids],
        ),
      ]);
      const linesByReturn = group(lines.rows, (row) => row.return_id);
      const restorationsByReturn = group(restorations.rows, (row) => row.return_id);
      const eventsByReturn = group(refundEvents.rows, (row) => row.return_id);
      return headers.rows.map((row): ReturnReportingFact => {
        const source: ReturnSourceKeyDto = row.source_sale_id
          ? { kind: "physical_sale", id: row.source_sale_id }
          : { kind: "delivered_online_order", id: required(row.source_online_order_id) };
        const authorizedRefund: ReturnRefundBreakdownDto = {
          merchandisePiasters: integer(row.authorized_merchandise_refund_piasters),
          checkoutChargePiasters: integer(row.authorized_checkout_charge_refund_piasters),
          totalPiasters: integer(row.authorized_refund_piasters),
        };
        const events = (eventsByReturn.get(row.id) ?? []).map((event) => ({
          amountPiasters: integer(event.amount_piasters), recordedAt: event.recorded_at,
        }));
        if (row.cash_refund_paid_piasters !== null && integer(row.cash_refund_paid_piasters) > 0 && row.exchange_completed_at) {
          events.push({ amountPiasters: integer(row.cash_refund_paid_piasters), recordedAt: row.exchange_completed_at });
        }
        return {
          returnId: row.id,
          reference: row.reference,
          postedAt: row.posted_at,
          source,
          channel: source.kind === "physical_sale" ? "physical" : "online",
          handlingBranchId: row.handling_branch_id,
          authorizedRefund,
          refundPaidPiasters: integer(row.refund_paid_piasters),
          refundCashEvents: events,
          exchange: row.replacement_sale_id ? {
            replacementSaleId: row.replacement_sale_id,
            creditAppliedPiasters: integer(row.credit_applied_piasters ?? 0),
            cashCollectedPiasters: integer(row.cash_collected_piasters ?? 0),
            cashRefundPaidPiasters: integer(row.cash_refund_paid_piasters ?? 0),
            completedAt: required(row.exchange_completed_at),
          } : null,
          lines: (linesByReturn.get(row.id) ?? []).map((line) => ({
            returnLineId: line.id,
            sourceLineId: line.source_line_id,
            variantId: line.source_variant_id,
            quantity: line.quantity,
            sellableQuantity: line.sellable_quantity,
          })),
          restorations: (restorationsByReturn.get(row.id) ?? []).map((restoration) => ({
            batchId: restoration.batch_id,
            variantId: restoration.variant_id,
            quantity: restoration.quantity,
            unitCostPiasters: integer(restoration.unit_cost_piasters),
          })),
        };
      });
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

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing return reporting source.");
  return value;
}

function integer(value: number | string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable return reporting value.");
  return parsed;
}
