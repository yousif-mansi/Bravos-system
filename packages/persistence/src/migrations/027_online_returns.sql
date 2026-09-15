ALTER TABLE returns_return
  ALTER COLUMN source_sale_id DROP NOT NULL,
  ADD COLUMN source_online_order_id UUID REFERENCES online_order (id) ON DELETE RESTRICT,
  ADD COLUMN suggested_merchandise_refund_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN suggested_checkout_charge_refund_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN authorized_merchandise_refund_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN authorized_checkout_charge_refund_piasters BIGINT NOT NULL DEFAULT 0;

UPDATE returns_return
SET suggested_merchandise_refund_piasters = suggested_refund_piasters,
    authorized_merchandise_refund_piasters = authorized_refund_piasters;

ALTER TABLE returns_return
  ADD CONSTRAINT returns_return_source_exact CHECK (
    (source_sale_id IS NOT NULL AND source_online_order_id IS NULL)
    OR (source_sale_id IS NULL AND source_online_order_id IS NOT NULL)
  ),
  ADD CONSTRAINT returns_return_suggested_merchandise_nonnegative
    CHECK (suggested_merchandise_refund_piasters >= 0),
  ADD CONSTRAINT returns_return_suggested_checkout_nonnegative
    CHECK (suggested_checkout_charge_refund_piasters >= 0),
  ADD CONSTRAINT returns_return_authorized_merchandise_nonnegative
    CHECK (authorized_merchandise_refund_piasters >= 0),
  ADD CONSTRAINT returns_return_authorized_checkout_nonnegative
    CHECK (authorized_checkout_charge_refund_piasters >= 0),
  ADD CONSTRAINT returns_return_suggested_components_total CHECK (
    suggested_refund_piasters = suggested_merchandise_refund_piasters
      + suggested_checkout_charge_refund_piasters
  ),
  ADD CONSTRAINT returns_return_authorized_components_total CHECK (
    authorized_refund_piasters = authorized_merchandise_refund_piasters
      + authorized_checkout_charge_refund_piasters
  );

CREATE INDEX returns_return_online_source
  ON returns_return (source_online_order_id, status, created_at)
  WHERE source_online_order_id IS NOT NULL;

ALTER TABLE returns_return_line
  ALTER COLUMN source_sale_line_id DROP NOT NULL,
  ADD COLUMN source_online_order_line_id UUID,
  ADD COLUMN source_variant_id UUID REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  ADD CONSTRAINT returns_return_line_source_exact CHECK (
    (source_sale_line_id IS NOT NULL AND source_online_order_line_id IS NULL)
    OR (source_sale_line_id IS NULL AND source_online_order_line_id IS NOT NULL)
  );

UPDATE returns_return_line line
SET source_variant_id=sale_line.variant_id
FROM sales_sale_line sale_line
WHERE sale_line.id=line.source_sale_line_id;

ALTER TABLE returns_return_line ALTER COLUMN source_variant_id SET NOT NULL;

CREATE UNIQUE INDEX returns_return_line_online_unique
  ON returns_return_line (return_id, source_online_order_line_id)
  WHERE source_online_order_line_id IS NOT NULL;

CREATE INDEX returns_return_line_online_source
  ON returns_return_line (source_online_order_line_id)
  WHERE source_online_order_line_id IS NOT NULL;

ALTER TABLE returns_return_unit DROP CONSTRAINT returns_return_unit_source_exact;
ALTER TABLE returns_return_unit
  ADD COLUMN source_online_order_line_id UUID,
  ADD COLUMN source_online_order_unit_index INTEGER
    CONSTRAINT returns_return_unit_online_index_nonnegative CHECK (source_online_order_unit_index >= 0),
  ADD CONSTRAINT returns_return_unit_source_exact CHECK (
    (source_online_order_line_id IS NOT NULL AND source_online_order_unit_index IS NOT NULL
      AND source_sale_unit_id IS NULL AND source_recording_sale_unit_id IS NULL)
    OR (source_online_order_line_id IS NULL AND source_online_order_unit_index IS NULL
      AND ((source_sale_unit_id IS NOT NULL AND source_recording_sale_unit_id IS NULL)
        OR (source_sale_unit_id IS NULL AND source_recording_sale_unit_id IS NOT NULL)))
  );

CREATE UNIQUE INDEX returns_return_unit_online_segment_unique
  ON returns_return_unit (
    return_id, source_online_order_line_id, source_online_order_unit_index, start_offset
  ) WHERE source_online_order_line_id IS NOT NULL;

ALTER TABLE recording_correction
  ADD COLUMN effective_refund_merchandise_piasters BIGINT,
  ADD COLUMN effective_refund_checkout_charge_piasters BIGINT;

UPDATE recording_correction
SET effective_refund_merchandise_piasters = effective_total_piasters,
    effective_refund_checkout_charge_piasters = 0
WHERE target_type = 'return' AND change_type = 'correction';

ALTER TABLE recording_correction
  ADD CONSTRAINT recording_correction_refund_merchandise_nonnegative
    CHECK (effective_refund_merchandise_piasters >= 0),
  ADD CONSTRAINT recording_correction_refund_checkout_nonnegative
    CHECK (effective_refund_checkout_charge_piasters >= 0),
  ADD CONSTRAINT recording_correction_refund_components_shape CHECK (
    (target_type = 'sale' AND effective_refund_merchandise_piasters IS NULL
      AND effective_refund_checkout_charge_piasters IS NULL)
    OR (target_type = 'return' AND change_type = 'cancellation'
      AND effective_refund_merchandise_piasters IS NULL
      AND effective_refund_checkout_charge_piasters IS NULL)
    OR (target_type = 'return' AND change_type = 'correction'
      AND effective_refund_merchandise_piasters IS NOT NULL
      AND effective_refund_checkout_charge_piasters IS NOT NULL
      AND effective_total_piasters = effective_refund_merchandise_piasters
        + effective_refund_checkout_charge_piasters)
  );

CREATE TABLE recording_online_return_unit_value (
  correction_id UUID NOT NULL REFERENCES recording_correction (id) ON DELETE RESTRICT,
  return_line_id UUID NOT NULL REFERENCES returns_return_line (id) ON DELETE RESTRICT,
  source_online_order_line_id UUID NOT NULL,
  source_online_order_unit_index INTEGER NOT NULL CHECK (source_online_order_unit_index >= 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  paid_unit_piasters BIGINT NOT NULL CHECK (paid_unit_piasters >= 0),
  PRIMARY KEY (correction_id, return_line_id, source_online_order_unit_index, start_offset)
);

CREATE INDEX recording_online_return_unit_source
  ON recording_online_return_unit_value (
    source_online_order_line_id, source_online_order_unit_index, start_offset
  );

CREATE TABLE inventory_delivered_return_allocation_effect (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES inventory_protected_order (order_id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES inventory_protected_order_allocation (allocation_id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_delivered_return_effect_operation_allocation_unique
    UNIQUE (operation_id, allocation_id)
);

CREATE INDEX inventory_delivered_return_effect_order
  ON inventory_delivered_return_allocation_effect (order_id, allocation_id, recorded_at, id);
