ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive', 'sale', 'return'));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive', 'sale', 'return'));

CREATE TABLE returns_return (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  source_sale_id UUID NOT NULL REFERENCES sales_sale (id) ON DELETE RESTRICT,
  handling_branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CONSTRAINT returns_return_status_known CHECK (status IN ('draft', 'posted')),
  payload_fingerprint TEXT NOT NULL,
  draft_payload_fingerprint TEXT NOT NULL,
  suggested_refund_piasters BIGINT NOT NULL
    CONSTRAINT returns_return_suggested_nonnegative CHECK (suggested_refund_piasters >= 0),
  authorized_refund_piasters BIGINT NOT NULL
    CONSTRAINT returns_return_authorized_nonnegative CHECK (authorized_refund_piasters >= 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision INTEGER NOT NULL DEFAULT 1 CONSTRAINT returns_return_revision_positive CHECK (revision > 0),
  updated_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  refund_status TEXT NOT NULL DEFAULT 'none'
    CONSTRAINT returns_return_refund_status_known CHECK (refund_status IN ('none', 'owed', 'paid')),
  refund_paid_piasters BIGINT NOT NULL DEFAULT 0
    CONSTRAINT returns_return_paid_nonnegative CHECK (refund_paid_piasters >= 0),
  refund_recorded_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  refund_recorded_at TIMESTAMPTZ,
  CONSTRAINT returns_return_post_pair CHECK (
    (status = 'draft' AND posted_by_staff_id IS NULL AND posted_at IS NULL)
    OR (status = 'posted' AND posted_by_staff_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT returns_return_refund_pair CHECK (
    (refund_recorded_by_staff_id IS NULL) = (refund_recorded_at IS NULL)
  ),
  CONSTRAINT returns_return_paid_state CHECK (
    (refund_status = 'none' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_status = 'owed' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
    OR (refund_status = 'paid' AND refund_paid_piasters = authorized_refund_piasters
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
  )
);

CREATE INDEX returns_return_source ON returns_return (source_sale_id, status, created_at);
CREATE INDEX returns_return_list ON returns_return (created_at DESC, id DESC);

CREATE TABLE returns_return_line (
  id UUID PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES returns_return (id) ON DELETE RESTRICT,
  source_sale_line_id UUID NOT NULL REFERENCES sales_sale_line (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CONSTRAINT returns_return_line_quantity_positive CHECK (quantity > 0),
  sellable_quantity INTEGER NOT NULL
    CONSTRAINT returns_return_line_sellable_nonnegative CHECK (sellable_quantity >= 0),
  suggested_refund_piasters BIGINT NOT NULL
    CONSTRAINT returns_return_line_suggested_nonnegative CHECK (suggested_refund_piasters >= 0),
  line_index INTEGER NOT NULL,
  CONSTRAINT returns_return_line_sellable_lte CHECK (sellable_quantity <= quantity),
  CONSTRAINT returns_return_line_unique UNIQUE (return_id, source_sale_line_id),
  CONSTRAINT returns_return_line_index_unique UNIQUE (return_id, line_index)
);

CREATE INDEX returns_return_line_source ON returns_return_line (source_sale_line_id);

CREATE TABLE returns_return_unit (
  id UUID PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES returns_return (id) ON DELETE RESTRICT,
  return_line_id UUID NOT NULL REFERENCES returns_return_line (id) ON DELETE RESTRICT,
  source_sale_unit_id UUID NOT NULL REFERENCES sales_sale_unit (id) ON DELETE RESTRICT,
  start_offset INTEGER NOT NULL CONSTRAINT returns_return_unit_offset_nonnegative CHECK (start_offset >= 0),
  quantity INTEGER NOT NULL CONSTRAINT returns_return_unit_quantity_positive CHECK (quantity > 0),
  paid_unit_piasters BIGINT NOT NULL CONSTRAINT returns_return_unit_paid_nonnegative CHECK (paid_unit_piasters >= 0),
  CONSTRAINT returns_return_unit_segment_unique UNIQUE (return_id, source_sale_unit_id, start_offset)
);

CREATE INDEX returns_return_unit_source ON returns_return_unit (source_sale_unit_id);

CREATE TABLE returns_batch_restoration (
  id UUID PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES returns_return (id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CONSTRAINT returns_batch_restoration_quantity_positive CHECK (quantity > 0),
  unit_cost_piasters BIGINT NOT NULL
    CONSTRAINT returns_batch_restoration_cost_nonnegative CHECK (unit_cost_piasters >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT returns_batch_restoration_unique UNIQUE (return_id, batch_id)
);

CREATE INDEX returns_batch_restoration_return ON returns_batch_restoration (return_id);

CREATE TABLE returns_refund_event (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  return_id UUID NOT NULL REFERENCES returns_return (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CONSTRAINT returns_refund_event_status_known CHECK (status IN ('paid')),
  amount_piasters BIGINT NOT NULL CONSTRAINT returns_refund_event_amount_nonnegative CHECK (amount_piasters >= 0),
  payload_fingerprint TEXT NOT NULL,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX returns_refund_event_return ON returns_refund_event (return_id, recorded_at);
