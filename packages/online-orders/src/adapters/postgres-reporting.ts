import type { CompletedOnlineOrderDto, OnlineOrderAgreementQuoteDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { OnlineOrderReportingReader } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresOnlineOrderReportingReader(queryable: Queryable): OnlineOrderReportingReader {
  return {
    async countDeliveredFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count
         FROM online_order order_row
         JOIN online_order_fulfillment_event event
           ON event.order_id=order_row.id AND event.event_type='delivered'
         WHERE order_row.status='delivered' AND event.occurred_at >= $1 AND event.occurred_at < $2`,
        [input.from, input.to],
      );
      return integer(result.rows[0]?.count ?? 0);
    },
    async countAcceptedSubmissions(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(DISTINCT operation_id)::bigint AS count
         FROM online_order WHERE submitted_at >= $1 AND submitted_at < $2`,
        [input.from, input.to],
      );
      return integer(result.rows[0]?.count ?? 0);
    },
    async listDeliveredFactsPage(input) {
      const result = await queryable.query<{
        id: string; reference: string; delivered_at: Date; confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT order_row.id,order_row.reference,event.occurred_at AS delivered_at,
                confirmation.confirmed_quote_json
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id=order_row.id
         JOIN online_order_fulfillment_event event
           ON event.order_id=order_row.id AND event.event_type='delivered'
         WHERE order_row.status='delivered' AND event.occurred_at >= $1 AND event.occurred_at < $2
           AND ($3::timestamptz IS NULL OR (event.occurred_at,order_row.id) < ($3,$4::uuid))
         ORDER BY event.occurred_at DESC,order_row.id DESC
         LIMIT $5`,
        [input.from, input.to, input.after?.deliveredAt ?? null, input.after?.id ?? null, input.limit],
      );
      return result.rows.map(toCompleted);
    },
    async currentStatusCounts() {
      const result = await queryable.query<{
        pending_count: number | string; confirmed_count: number | string;
        shipped_count: number | string; delivery_failed_count: number | string;
      }>(
        `SELECT COUNT(*) FILTER (WHERE status='pending')::bigint AS pending_count,
                COUNT(*) FILTER (WHERE status='confirmed')::bigint AS confirmed_count,
                COUNT(*) FILTER (WHERE status='shipped')::bigint AS shipped_count,
                COUNT(*) FILTER (WHERE status='delivery_failed')::bigint AS delivery_failed_count
         FROM online_order`,
      );
      const row = result.rows[0];
      return {
        pendingCount: integer(row?.pending_count ?? 0),
        confirmedCount: integer(row?.confirmed_count ?? 0),
        shippedCount: integer(row?.shipped_count ?? 0),
        deliveryFailedCount: integer(row?.delivery_failed_count ?? 0),
      };
    },
    async currentProtectedOrderIdsPage(input) {
      const result = await queryable.query<{ id: string }>(
        `SELECT id FROM online_order
         WHERE status IN ('confirmed','shipped','delivery_failed') AND ($1::uuid IS NULL OR id > $1)
         ORDER BY id LIMIT $2`,
        [input.afterId ?? null, input.limit],
      );
      return result.rows.map((row) => row.id);
    },
  };
}

function toCompleted(row: { id: string; reference: string; delivered_at: Date; confirmed_quote_json: OnlineOrderAgreementQuoteDto }): CompletedOnlineOrderDto {
  return {
    orderId: row.id,
    reference: row.reference,
    deliveredAt: row.delivered_at.toISOString(),
    finalTotalPiasters: integer(row.confirmed_quote_json.finalTotalPiasters),
    confirmedQuote: row.confirmed_quote_json,
  };
}

function integer(value: number | string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable online-order reporting value.");
  return parsed;
}
