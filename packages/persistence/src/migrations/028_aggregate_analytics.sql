CREATE TABLE public_analytics_event (
  operation_id UUID PRIMARY KEY,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  event_type TEXT NOT NULL CHECK (event_type IN ('visit', 'product_view', 'cart_addition')),
  product_id UUID,
  variant_id UUID,
  quantity INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT public_analytics_event_shape CHECK (
    (event_type = 'visit'
      AND product_id IS NULL AND variant_id IS NULL AND quantity IS NULL)
    OR (event_type = 'product_view'
      AND product_id IS NOT NULL AND variant_id IS NULL AND quantity IS NULL)
    OR (event_type = 'cart_addition'
      AND product_id IS NOT NULL AND variant_id IS NOT NULL
      AND quantity BETWEEN 1 AND 1000000)
  )
);

CREATE INDEX public_analytics_event_aggregate
  ON public_analytics_event (event_type, recorded_at);

CREATE INDEX online_order_delivered_analytics
  ON online_order_fulfillment_event (occurred_at, order_id)
  WHERE event_type = 'delivered';
