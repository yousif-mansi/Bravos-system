ALTER TABLE online_order DROP CONSTRAINT online_order_status_check;
ALTER TABLE online_order DROP CONSTRAINT online_order_confirmation_shape;
ALTER TABLE online_order DROP CONSTRAINT online_order_cancellation_shape;

ALTER TABLE online_order
  ADD CONSTRAINT online_order_status_check CHECK (status IN (
    'pending', 'confirmed', 'shipped', 'delivered', 'delivery_failed',
    'cancelled_unreachable', 'cancelled_before_shipment', 'cancelled_after_failed_delivery'
  )),
  ADD CONSTRAINT online_order_confirmation_shape CHECK (
    (status IN ('confirmed', 'shipped', 'delivered', 'delivery_failed', 'cancelled_after_failed_delivery')
      AND confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status IN ('pending', 'cancelled_unreachable')
      AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL)
    OR (status = 'cancelled_before_shipment'
      AND ((confirmed_by_staff_id IS NULL AND confirmed_at IS NULL)
        OR (confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL)))
  ),
  ADD CONSTRAINT online_order_cancellation_shape CHECK (
    (status IN ('cancelled_unreachable', 'cancelled_before_shipment', 'cancelled_after_failed_delivery')
      AND cancelled_by_staff_id IS NOT NULL AND cancelled_at IS NOT NULL
      AND char_length(btrim(cancellation_reason)) BETWEEN 1 AND 500)
    OR (status NOT IN ('cancelled_unreachable', 'cancelled_before_shipment', 'cancelled_after_failed_delivery')
      AND cancelled_by_staff_id IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  );

ALTER TABLE online_order_operation DROP CONSTRAINT online_order_operation_operation_type_check;
ALTER TABLE online_order_operation
  ADD CONSTRAINT online_order_operation_operation_type_check CHECK (operation_type IN (
    'contact_attempt', 'agreed_revision', 'confirmation', 'unreachable_cancellation',
    'shipment', 'delivery', 'delivery_failure', 'pre_shipment_cancellation',
    'failed_return_inspection_draft', 'failed_return_inspection_post',
    'failed_return_inspection_abandon', 'failed_delivery_closure'
  ));

CREATE TABLE online_order_fulfillment_event (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'shipped', 'delivered', 'delivery_failed', 'cancelled_before_shipment',
    'failed_return_inspection_drafted', 'failed_return_inspection_posted',
    'failed_return_inspection_abandoned',
    'cancelled_after_failed_delivery'
  )),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  CONSTRAINT online_order_fulfillment_reason_length
    CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX online_order_fulfillment_event_order
  ON online_order_fulfillment_event (order_id, recorded_at, id);

CREATE TABLE online_order_failed_return_inspection (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  draft_operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'abandoned')),
  recorded_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL,
  posted_operation_id UUID UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  posted_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  abandoned_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  abandoned_at TIMESTAMPTZ,
  abandonment_reason TEXT,
  CONSTRAINT online_order_failed_return_inspection_post_shape CHECK (
    (status = 'draft' AND posted_operation_id IS NULL AND posted_by_staff_id IS NULL AND posted_at IS NULL
      AND abandoned_by_staff_id IS NULL AND abandoned_at IS NULL AND abandonment_reason IS NULL)
    OR (status = 'posted' AND posted_operation_id IS NOT NULL AND posted_by_staff_id IS NOT NULL AND posted_at IS NOT NULL
      AND abandoned_by_staff_id IS NULL AND abandoned_at IS NULL AND abandonment_reason IS NULL)
    OR (status = 'abandoned' AND posted_operation_id IS NULL AND posted_by_staff_id IS NULL AND posted_at IS NULL
      AND abandoned_by_staff_id IS NOT NULL AND abandoned_at IS NOT NULL
      AND char_length(btrim(abandonment_reason)) BETWEEN 1 AND 500)
  )
);

CREATE UNIQUE INDEX online_order_failed_return_one_draft
  ON online_order_failed_return_inspection (order_id) WHERE status = 'draft';

CREATE INDEX online_order_failed_return_inspection_order
  ON online_order_failed_return_inspection (order_id, recorded_at, id);

CREATE TABLE online_order_failed_return_inspection_line (
  inspection_id UUID NOT NULL REFERENCES online_order_failed_return_inspection (id) ON DELETE RESTRICT,
  confirmed_line_id UUID NOT NULL,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  received_quantity INTEGER NOT NULL CHECK (received_quantity > 0),
  sellable_quantity INTEGER NOT NULL CHECK (sellable_quantity >= 0),
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  PRIMARY KEY (inspection_id, confirmed_line_id),
  CONSTRAINT online_order_failed_return_inspection_sellable_lte
    CHECK (sellable_quantity <= received_quantity),
  CONSTRAINT online_order_failed_return_inspection_line_index_unique
    UNIQUE (inspection_id, line_index)
);

CREATE INDEX online_order_failed_return_inspection_line_variant
  ON online_order_failed_return_inspection_line (variant_id, inspection_id);

ALTER TABLE pricing_coupon_usage
  ADD COLUMN release_operation_id UUID UNIQUE,
  ADD COLUMN release_payload_fingerprint TEXT,
  ADD COLUMN released_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pricing_coupon_usage_release_shape CHECK (
    (released_at IS NULL AND release_operation_id IS NULL
      AND release_payload_fingerprint IS NULL AND released_by_staff_id IS NULL)
    OR (released_at IS NOT NULL AND release_operation_id IS NOT NULL
      AND release_payload_fingerprint ~ '^[0-9a-f]{64}$' AND released_by_staff_id IS NOT NULL)
  );
