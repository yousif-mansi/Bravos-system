ALTER TABLE inventory_batch
  ADD COLUMN effective_received_quantity INTEGER,
  ADD COLUMN effective_unit_cost_piasters INTEGER;

UPDATE inventory_batch
SET effective_received_quantity = received_quantity,
    effective_unit_cost_piasters = unit_cost_piasters;

ALTER TABLE inventory_batch
  ALTER COLUMN effective_received_quantity SET NOT NULL,
  ALTER COLUMN effective_unit_cost_piasters SET NOT NULL,
  DROP CONSTRAINT inventory_batch_remaining_lte_received,
  ADD CONSTRAINT inventory_batch_effective_received_nonnegative
    CHECK (effective_received_quantity >= 0),
  ADD CONSTRAINT inventory_batch_effective_cost_nonnegative
    CHECK (effective_unit_cost_piasters >= 0),
  ADD CONSTRAINT inventory_batch_remaining_lte_effective_received
    CHECK (remaining_quantity <= effective_received_quantity);

CREATE TABLE receiving_correction (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL REFERENCES receiving_receipt (id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CONSTRAINT receiving_correction_revision_positive CHECK (revision > 0),
  reason TEXT NOT NULL CONSTRAINT receiving_correction_reason_present CHECK (length(btrim(reason)) > 0),
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT receiving_correction_receipt_revision UNIQUE (receipt_id, revision)
);

CREATE INDEX receiving_correction_history ON receiving_correction (receipt_id, revision);

CREATE TABLE receiving_correction_line (
  correction_id UUID NOT NULL REFERENCES receiving_correction (id) ON DELETE RESTRICT,
  receipt_line_id UUID NOT NULL REFERENCES receiving_receipt_line (id) ON DELETE RESTRICT,
  previous_quantity INTEGER NOT NULL CONSTRAINT receiving_correction_line_previous_quantity_nonnegative CHECK (previous_quantity >= 0),
  previous_unit_cost_piasters INTEGER NOT NULL CONSTRAINT receiving_correction_line_previous_cost_nonnegative CHECK (previous_unit_cost_piasters >= 0),
  effective_quantity INTEGER NOT NULL CONSTRAINT receiving_correction_line_effective_quantity_nonnegative CHECK (effective_quantity >= 0),
  effective_unit_cost_piasters INTEGER NOT NULL CONSTRAINT receiving_correction_line_effective_cost_nonnegative CHECK (effective_unit_cost_piasters >= 0),
  remaining_quantity INTEGER NOT NULL CONSTRAINT receiving_correction_line_remaining_nonnegative CHECK (remaining_quantity >= 0),
  allocated_quantity INTEGER NOT NULL CONSTRAINT receiving_correction_line_allocated_nonnegative CHECK (allocated_quantity >= 0),
  quantity_delta INTEGER NOT NULL,
  unit_cost_delta_piasters INTEGER NOT NULL,
  PRIMARY KEY (correction_id, receipt_line_id),
  CONSTRAINT receiving_correction_line_quantity_delta_exact
    CHECK (previous_quantity + quantity_delta = effective_quantity),
  CONSTRAINT receiving_correction_line_balance_exact
    CHECK (remaining_quantity + allocated_quantity = effective_quantity),
  CONSTRAINT receiving_correction_line_cost_delta_exact
    CHECK (previous_unit_cost_piasters + unit_cost_delta_piasters = effective_unit_cost_piasters)
);
