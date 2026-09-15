ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive', 'sale', 'return', 'correction'));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
    CHECK (kind IN ('receive', 'sale', 'return', 'correction_restore', 'correction_deduct'));

CREATE TABLE recording_correction (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CONSTRAINT recording_correction_target_known CHECK (target_type IN ('sale', 'return')),
  sale_id UUID REFERENCES sales_sale (id) ON DELETE RESTRICT,
  return_id UUID REFERENCES returns_return (id) ON DELETE RESTRICT,
  change_type TEXT NOT NULL CONSTRAINT recording_correction_type_known CHECK (change_type IN ('correction', 'cancellation')),
  revision INTEGER NOT NULL CONSTRAINT recording_correction_revision_positive CHECK (revision > 0),
  reason TEXT NOT NULL CONSTRAINT recording_correction_reason_present CHECK (length(btrim(reason)) > 0),
  payload_fingerprint TEXT NOT NULL,
  effective_total_piasters BIGINT CONSTRAINT recording_correction_total_nonnegative CHECK (effective_total_piasters >= 0),
  cash_direction TEXT CONSTRAINT recording_correction_cash_direction_known CHECK (cash_direction IN ('paid_out', 'recovered')),
  cash_amount_piasters BIGINT NOT NULL DEFAULT 0 CONSTRAINT recording_correction_cash_nonnegative CHECK (cash_amount_piasters >= 0),
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT recording_correction_target_exact CHECK (
    (target_type = 'sale' AND sale_id IS NOT NULL AND return_id IS NULL)
    OR (target_type = 'return' AND return_id IS NOT NULL AND sale_id IS NULL)
  ),
  CONSTRAINT recording_correction_cash_pair CHECK (
    (cash_direction IS NULL AND cash_amount_piasters = 0)
    OR (cash_direction IS NOT NULL AND cash_amount_piasters > 0)
  ),
  CONSTRAINT recording_correction_effective_pair CHECK (
    (change_type = 'cancellation' AND effective_total_piasters IS NULL)
    OR (change_type = 'correction' AND effective_total_piasters IS NOT NULL)
  )
);

CREATE UNIQUE INDEX recording_correction_sale_revision
  ON recording_correction (sale_id, revision) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX recording_correction_return_revision
  ON recording_correction (return_id, revision) WHERE return_id IS NOT NULL;
CREATE INDEX recording_correction_sale_history ON recording_correction (sale_id, revision);
CREATE INDEX recording_correction_return_history ON recording_correction (return_id, revision);

CREATE TABLE recording_sale_line_value (
  correction_id UUID NOT NULL REFERENCES recording_correction (id) ON DELETE RESTRICT,
  sale_line_id UUID NOT NULL REFERENCES sales_sale_line (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CONSTRAINT recording_sale_line_quantity_nonnegative CHECK (quantity >= 0),
  paid_piasters BIGINT NOT NULL CONSTRAINT recording_sale_line_paid_nonnegative CHECK (paid_piasters >= 0),
  PRIMARY KEY (correction_id, sale_line_id)
);

CREATE TABLE recording_sale_unit_value (
  id UUID PRIMARY KEY,
  correction_id UUID NOT NULL REFERENCES recording_correction (id) ON DELETE RESTRICT,
  sale_line_id UUID NOT NULL REFERENCES sales_sale_line (id) ON DELETE RESTRICT,
  unit_index INTEGER NOT NULL CONSTRAINT recording_sale_unit_index_nonnegative CHECK (unit_index >= 0),
  quantity INTEGER NOT NULL CONSTRAINT recording_sale_unit_quantity_positive CHECK (quantity > 0),
  paid_unit_piasters BIGINT NOT NULL CONSTRAINT recording_sale_unit_paid_nonnegative CHECK (paid_unit_piasters >= 0),
  CONSTRAINT recording_sale_unit_index_unique UNIQUE (correction_id, sale_line_id, unit_index)
);

ALTER TABLE returns_return_unit
  ALTER COLUMN source_sale_unit_id DROP NOT NULL,
  ADD COLUMN source_recording_sale_unit_id UUID REFERENCES recording_sale_unit_value (id) ON DELETE RESTRICT,
  ADD CONSTRAINT returns_return_unit_source_exact CHECK (
    (source_sale_unit_id IS NOT NULL AND source_recording_sale_unit_id IS NULL)
    OR (source_sale_unit_id IS NULL AND source_recording_sale_unit_id IS NOT NULL)
  );

ALTER TABLE returns_return DROP CONSTRAINT returns_return_paid_state;
ALTER TABLE returns_return
  ADD CONSTRAINT returns_return_paid_state CHECK (
    (refund_status = 'none' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_status = 'owed' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
    OR (refund_status = 'paid' AND refund_paid_piasters >= 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
  );

CREATE TABLE recording_return_line_value (
  correction_id UUID NOT NULL REFERENCES recording_correction (id) ON DELETE RESTRICT,
  return_line_id UUID NOT NULL REFERENCES returns_return_line (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CONSTRAINT recording_return_line_quantity_nonnegative CHECK (quantity >= 0),
  sellable_quantity INTEGER NOT NULL CONSTRAINT recording_return_line_sellable_nonnegative CHECK (sellable_quantity >= 0),
  CONSTRAINT recording_return_line_sellable_lte CHECK (sellable_quantity <= quantity),
  PRIMARY KEY (correction_id, return_line_id)
);

CREATE TABLE recording_merchandise_fact (
  id UUID PRIMARY KEY,
  correction_id UUID NOT NULL REFERENCES recording_correction (id) ON DELETE RESTRICT,
  target_line_type TEXT NOT NULL CONSTRAINT recording_merchandise_line_type_known CHECK (target_line_type IN ('sale', 'return')),
  sale_line_id UUID REFERENCES sales_sale_line (id) ON DELETE RESTRICT,
  return_line_id UUID REFERENCES returns_return_line (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CONSTRAINT recording_merchandise_direction_known CHECK (direction IN ('restore', 'deduct')),
  quantity INTEGER NOT NULL CONSTRAINT recording_merchandise_quantity_positive CHECK (quantity > 0),
  unit_cost_piasters BIGINT NOT NULL CONSTRAINT recording_merchandise_cost_nonnegative CHECK (unit_cost_piasters >= 0),
  CONSTRAINT recording_merchandise_line_exact CHECK (
    (target_line_type = 'sale' AND sale_line_id IS NOT NULL AND return_line_id IS NULL)
    OR (target_line_type = 'return' AND return_line_id IS NOT NULL AND sale_line_id IS NULL)
  )
);

CREATE INDEX recording_merchandise_correction ON recording_merchandise_fact (correction_id, id);
CREATE INDEX recording_merchandise_sale_line ON recording_merchandise_fact (sale_line_id) WHERE sale_line_id IS NOT NULL;
CREATE INDEX recording_merchandise_return_line ON recording_merchandise_fact (return_line_id) WHERE return_line_id IS NOT NULL;
