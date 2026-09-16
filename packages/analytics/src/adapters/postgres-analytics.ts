import type { Pool, PoolClient } from "pg";
import type {
  AnalyticsEventWrite,
  AnalyticsStore,
  StoredAnalyticsEvent,
} from "../application/ports.ts";

type Queryable = Pick<Pool | PoolClient, "query">;

type EventRow = {
  operation_id: string;
  payload_fingerprint: string;
  event_type: StoredAnalyticsEvent["eventType"];
  product_id: string | null;
  variant_id: string | null;
  quantity: number | null;
  recorded_at: Date;
};

export function createPostgresAnalyticsStore(queryable: Queryable): AnalyticsStore {
  return {
    async getEvent(operationId) {
      const result = await queryable.query<EventRow>(
        "SELECT * FROM public_analytics_event WHERE operation_id=$1",
        [operationId],
      );
      return result.rows[0] ? stored(result.rows[0]) : null;
    },

    async recordEvent(input) {
      const values = eventValues(input);
      const inserted = await queryable.query<EventRow>(
        `INSERT INTO public_analytics_event
           (operation_id,payload_fingerprint,event_type,product_id,variant_id,quantity,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (operation_id) DO NOTHING
         RETURNING *`,
        values,
      );
      if (inserted.rows[0]) return { created: true, event: stored(inserted.rows[0]) };
      const existing = await queryable.query<EventRow>(
        "SELECT * FROM public_analytics_event WHERE operation_id=$1",
        [input.operationId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("تعذر استعادة حدث التحليلات المتزامن.");
      return { created: false, event: stored(row) };
    },

    async countEvents(period) {
      const result = await queryable.query<{
        visits: string;
        product_views: string;
        cart_additions: string;
      }>(
        `SELECT
           (SELECT count(*) FROM public_analytics_event
             WHERE event_type='visit' AND recorded_at >= $1 AND recorded_at < $2) AS visits,
           (SELECT count(*) FROM public_analytics_event
             WHERE event_type='product_view' AND recorded_at >= $1 AND recorded_at < $2) AS product_views,
           (SELECT count(*) FROM public_analytics_event
             WHERE event_type='cart_addition' AND recorded_at >= $1 AND recorded_at < $2) AS cart_additions`,
        [period.from, period.toExclusive],
      );
      const row = result.rows[0];
      if (!row) throw new Error("تعذر قراءة ملخص التحليلات.");
      return {
        visits: count(row.visits),
        productViews: count(row.product_views),
        successfulCartAdditions: count(row.cart_additions),
      };
    },
  };
}

function eventValues(input: AnalyticsEventWrite) {
  return [
    input.operationId,
    input.payloadFingerprint,
    input.eventType,
    "productId" in input ? input.productId : null,
    "variantId" in input ? input.variantId : null,
    "quantity" in input ? input.quantity : null,
    input.recordedAt,
  ];
}

function stored(row: EventRow): StoredAnalyticsEvent {
  return {
    operationId: row.operation_id,
    payloadFingerprint: row.payload_fingerprint,
    eventType: row.event_type,
    recordedAt: row.recorded_at.toISOString(),
  };
}

function count(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("قيمة عداد التحليلات غير صالحة.");
  return parsed;
}
