ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN ('receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation'));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate'
  ));

ALTER TABLE sales_sale
  ADD COLUMN source_device_id UUID,
  ADD COLUMN source_snapshot_id UUID REFERENCES sales_pos_snapshot (id) ON DELETE RESTRICT;

CREATE INDEX sales_sale_source_device ON sales_sale (source_device_id, recorded_at);

CREATE TABLE inventory_known_till (
  device_id UUID PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  latest_snapshot_id UUID NOT NULL UNIQUE REFERENCES sales_pos_snapshot (id) ON DELETE RESTRICT,
  latest_snapshot_at TIMESTAMPTZ NOT NULL,
  stock_version BIGINT CHECK (stock_version >= 0),
  pending_operation_ids UUID[] NOT NULL DEFAULT '{}',
  included_operation_ids UUID[] NOT NULL DEFAULT '{}',
  synchronization_complete BOOLEAN NOT NULL
);

INSERT INTO inventory_known_till (
  device_id, staff_id, latest_snapshot_id, latest_snapshot_at, stock_version,
  pending_operation_ids, included_operation_ids, synchronization_complete
)
SELECT DISTINCT ON (device_id)
  device_id, staff_id, id, issued_at, NULL, '{}'::uuid[], '{}'::uuid[], FALSE
FROM sales_pos_snapshot
ORDER BY device_id, issued_at DESC, id DESC;

CREATE TABLE inventory_count_coordination (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
  boundary_stock_version BIGINT NOT NULL CHECK (boundary_stock_version >= 0),
  boundary_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  started_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  finished_operation_id UUID UNIQUE,
  finished_payload_fingerprint TEXT,
  finished_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  finished_at TIMESTAMPTZ,
  CHECK (expires_at > boundary_at),
  CHECK (
    (finished_by_staff_id IS NULL AND finished_at IS NULL AND finished_operation_id IS NULL AND finished_payload_fingerprint IS NULL)
    OR
    (status = 'expired' AND finished_by_staff_id IS NOT NULL AND finished_at IS NOT NULL
      AND finished_operation_id IS NULL AND finished_payload_fingerprint IS NULL)
    OR
    (finished_by_staff_id IS NOT NULL AND finished_at IS NOT NULL AND finished_operation_id IS NOT NULL AND finished_payload_fingerprint IS NOT NULL)
  )
);

CREATE UNIQUE INDEX inventory_one_active_count
  ON inventory_count_coordination ((status)) WHERE status = 'active';

CREATE TABLE inventory_count_coordination_device (
  coordination_id UUID NOT NULL REFERENCES inventory_count_coordination (id) ON DELETE RESTRICT,
  device_id UUID NOT NULL,
  known_snapshot_id UUID NOT NULL REFERENCES sales_pos_snapshot (id) ON DELETE RESTRICT,
  known_snapshot_at TIMESTAMPTZ NOT NULL,
  known_stock_version BIGINT CHECK (known_stock_version >= 0),
  acknowledged_snapshot_id UUID REFERENCES sales_pos_snapshot (id) ON DELETE RESTRICT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_stock_version BIGINT CHECK (acknowledged_stock_version >= 0),
  PRIMARY KEY (coordination_id, device_id),
  CHECK (
    (acknowledged_snapshot_id IS NULL AND acknowledged_at IS NULL AND acknowledged_stock_version IS NULL)
    OR
    (acknowledged_snapshot_id IS NOT NULL AND acknowledged_at IS NOT NULL AND acknowledged_stock_version IS NOT NULL)
  )
);

CREATE TABLE inventory_stock_correction (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  coordination_id UUID NOT NULL UNIQUE REFERENCES inventory_count_coordination (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  previous_available_quantity INTEGER NOT NULL CHECK (previous_available_quantity >= 0),
  corrected_available_quantity INTEGER NOT NULL CHECK (corrected_available_quantity >= 0),
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  positive_source_batch_id UUID REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL,
  boundary_stock_version BIGINT NOT NULL CHECK (boundary_stock_version >= 0),
  boundary_at TIMESTAMPTZ NOT NULL,
  CHECK (previous_available_quantity + quantity_delta = corrected_available_quantity),
  CHECK (quantity_delta <> 0),
  CHECK ((quantity_delta > 0) = (positive_source_batch_id IS NOT NULL))
);

CREATE INDEX inventory_stock_correction_variant_time
  ON inventory_stock_correction (variant_id, changed_at DESC, id DESC);

CREATE TABLE inventory_stock_correction_batch (
  correction_id UUID NOT NULL REFERENCES inventory_stock_correction (id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('restore', 'deduct')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_piasters BIGINT NOT NULL CHECK (unit_cost_piasters >= 0),
  effective_unit_cost_piasters BIGINT NOT NULL CHECK (effective_unit_cost_piasters >= 0),
  PRIMARY KEY (correction_id, batch_id, direction)
);

CREATE TABLE inventory_stock_reconciliation (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  correction_id UUID NOT NULL REFERENCES inventory_stock_correction (id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL REFERENCES sales_sale (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  resolution TEXT NOT NULL CHECK (resolution IN ('included_in_count', 'allocate_missing_source')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  previous_available_quantity INTEGER NOT NULL CHECK (previous_available_quantity >= 0),
  resulting_available_quantity INTEGER NOT NULL CHECK (resulting_available_quantity >= 0),
  resolved_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ NOT NULL,
  payload_fingerprint TEXT NOT NULL
);

CREATE INDEX inventory_stock_reconciliation_sale
  ON inventory_stock_reconciliation (sale_id, variant_id, resolved_at);

CREATE TABLE inventory_stock_reconciliation_batch (
  reconciliation_id UUID NOT NULL REFERENCES inventory_stock_reconciliation (id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('restore', 'allocate')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_piasters BIGINT NOT NULL CHECK (unit_cost_piasters >= 0),
  effective_unit_cost_piasters BIGINT NOT NULL CHECK (effective_unit_cost_piasters >= 0),
  PRIMARY KEY (reconciliation_id, batch_id, direction)
);
