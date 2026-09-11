ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive', 'sale'));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive', 'sale'));

CREATE TABLE inventory_allocation (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id),
  variant_id UUID NOT NULL,
  operation_id UUID NOT NULL REFERENCES inventory_operation (id),
  quantity INTEGER NOT NULL
    CONSTRAINT inventory_allocation_quantity_positive CHECK (quantity > 0),
  unit_cost_piasters INTEGER NOT NULL
    CONSTRAINT inventory_allocation_cost_nonnegative CHECK (unit_cost_piasters >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_allocation_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT
);

CREATE INDEX inventory_allocation_operation ON inventory_allocation (operation_id);
CREATE INDEX inventory_allocation_batch ON inventory_allocation (batch_id);

CREATE TABLE inventory_discrepancy (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES inventory_operation (id),
  variant_id UUID NOT NULL,
  requested_quantity INTEGER NOT NULL
    CONSTRAINT inventory_discrepancy_requested_positive CHECK (requested_quantity > 0),
  allocated_quantity INTEGER NOT NULL
    CONSTRAINT inventory_discrepancy_allocated_nonnegative CHECK (allocated_quantity >= 0),
  unallocated_quantity INTEGER NOT NULL
    CONSTRAINT inventory_discrepancy_unallocated_positive CHECK (unallocated_quantity > 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_discrepancy_parts CHECK (
    allocated_quantity + unallocated_quantity = requested_quantity
  ),
  CONSTRAINT inventory_discrepancy_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  CONSTRAINT inventory_discrepancy_operation_variant UNIQUE (operation_id, variant_id)
);
