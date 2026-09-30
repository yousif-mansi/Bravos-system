import type { OnlineOrderAgreementQuoteDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { OnlineOrderReportingReader } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresOnlineOrderReportingReader(queryable: Queryable): OnlineOrderReportingReader {
  return {
    async countConfirmedFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count
         FROM online_order_confirmation confirmation
         WHERE confirmation.confirmed_at >= $1 AND confirmation.confirmed_at < $2
           AND ($3::uuid IS NULL OR confirmation.fulfillment_branch_id=$3)`,
        [input.from, input.to, input.branchId ?? null],
      );
      return integer(result.rows[0]?.count ?? 0);
    },
    async countDeliveredFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count
         FROM online_order_fulfillment_event event
         WHERE event.event_type='delivered' AND event.occurred_at >= $1 AND event.occurred_at < $2`,
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
    async listConfirmedFactsPage(input) {
      const result = await queryable.query<{
        id: string; reference: string; occurred_at: Date; fulfillment_branch_id: string | null;
        confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT order_row.id,order_row.reference,confirmation.confirmed_at AS occurred_at,
                confirmation.fulfillment_branch_id,confirmation.confirmed_quote_json
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id=order_row.id
         WHERE confirmation.confirmed_at >= $1 AND confirmation.confirmed_at < $2
           AND ($3::uuid IS NULL OR confirmation.fulfillment_branch_id=$3)
           AND ($4::timestamptz IS NULL OR (confirmation.confirmed_at,order_row.id) < ($4,$5::uuid))
         ORDER BY confirmation.confirmed_at DESC,order_row.id DESC
         LIMIT $6`,
        [input.from, input.to, input.branchId ?? null, input.after?.occurredAt ?? null, input.after?.id ?? null, input.limit],
      );
      return result.rows.map((row) => ({ orderId: row.id, reference: row.reference,
        occurredAt: row.occurred_at, fulfillmentBranchId: row.fulfillment_branch_id,
        confirmedQuote: row.confirmed_quote_json }));
    },
    async listRevenueReversalsPage(input) {
      const result = await queryable.query<{
        event_id: string; operation_id: string; event_type: "cancelled_before_shipment" | "delivery_failed";
        order_id: string; occurred_at: Date; fulfillment_branch_id: string | null;
        confirmed_quote_json: OnlineOrderAgreementQuoteDto;
      }>(
        `SELECT event.id AS event_id,event.operation_id,event.event_type,event.order_id,event.occurred_at,
                confirmation.fulfillment_branch_id,confirmation.confirmed_quote_json
         FROM online_order_fulfillment_event event
         JOIN online_order_confirmation confirmation ON confirmation.order_id=event.order_id
         WHERE event.event_type IN ('cancelled_before_shipment','delivery_failed')
           AND event.occurred_at >= $1 AND event.occurred_at < $2
           AND ($3::uuid IS NULL OR confirmation.fulfillment_branch_id=$3)
           AND ($4::timestamptz IS NULL OR (event.occurred_at,event.id) < ($4,$5::uuid))
         ORDER BY event.occurred_at DESC,event.id DESC
         LIMIT $6`,
        [input.from, input.to, input.branchId ?? null, input.after?.occurredAt ?? null, input.after?.id ?? null, input.limit],
      );
      return result.rows.map((row) => ({ eventId: row.event_id, operationId: row.operation_id,
        eventType: row.event_type, orderId: row.order_id,
        occurredAt: row.occurred_at, fulfillmentBranchId: row.fulfillment_branch_id,
        confirmedQuote: row.confirmed_quote_json }));
    },
    async listRestorationFactsPage(input) {
      const result = await queryable.query<{
        event_id: string; operation_id: string; order_id: string; occurred_at: Date;
        fulfillment_branch_id: string | null;
      }>(
        `SELECT event.id AS event_id,event.operation_id,event.order_id,event.occurred_at,
                confirmation.fulfillment_branch_id
         FROM online_order_fulfillment_event event
         JOIN online_order_confirmation confirmation ON confirmation.order_id=event.order_id
         WHERE event.event_type='failed_return_inspection_posted'
           AND event.occurred_at >= $1 AND event.occurred_at < $2
           AND ($3::uuid IS NULL OR confirmation.fulfillment_branch_id=$3)
           AND ($4::timestamptz IS NULL OR (event.occurred_at,event.id) < ($4,$5::uuid))
         ORDER BY event.occurred_at DESC,event.id DESC
         LIMIT $6`,
        [input.from, input.to, input.branchId ?? null, input.after?.occurredAt ?? null, input.after?.id ?? null, input.limit],
      );
      return result.rows.map((row) => ({ eventId: row.event_id, operationId: row.operation_id,
        orderId: row.order_id, occurredAt: row.occurred_at,
        fulfillmentBranchId: row.fulfillment_branch_id }));
    },
    async getFulfillmentBranchesByOrderIds(orderIds) {
      if (orderIds.length === 0) return new Map();
      const result = await queryable.query<{ order_id: string; fulfillment_branch_id: string }>(
        `SELECT order_id,fulfillment_branch_id FROM online_order_confirmation
         WHERE order_id=ANY($1::uuid[]) AND fulfillment_branch_id IS NOT NULL`,
        [orderIds],
      );
      return new Map(result.rows.map((row) => [row.order_id, row.fulfillment_branch_id]));
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
         WHERE (status IN ('confirmed','shipped','delivery_failed')
           OR (status='cancelled_before_shipment' AND pre_shipment_stock_disposition='awaiting_inspection'))
           AND ($1::uuid IS NULL OR id > $1)
         ORDER BY id LIMIT $2`,
        [input.afterId ?? null, input.limit],
      );
      return result.rows.map((row) => row.id);
    },
  };
}

function integer(value: number | string) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable online-order reporting value.");
  return parsed;
}
