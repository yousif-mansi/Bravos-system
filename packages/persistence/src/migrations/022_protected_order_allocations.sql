ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation',
    'order_confirmation'
  ));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate', 'order_confirmation'
  ));

ALTER TABLE inventory_allocation
  ADD CONSTRAINT inventory_allocation_identity_operation_unique UNIQUE (id, operation_id);

CREATE TABLE inventory_protected_order (
  order_id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  protected_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_protected_order_identity_operation_unique UNIQUE (order_id, operation_id)
);

CREATE TABLE inventory_protected_order_allocation (
  protected_order_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  allocation_id UUID PRIMARY KEY,
  CONSTRAINT inventory_protected_order_allocation_header_fk
    FOREIGN KEY (protected_order_id, operation_id)
    REFERENCES inventory_protected_order (order_id, operation_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_protected_order_allocation_fact_fk
    FOREIGN KEY (allocation_id, operation_id)
    REFERENCES inventory_allocation (id, operation_id) ON DELETE RESTRICT
);

CREATE INDEX inventory_protected_order_allocation_order
  ON inventory_protected_order_allocation (protected_order_id, allocation_id);

CREATE INDEX inventory_protected_order_allocation_operation
  ON inventory_protected_order_allocation (operation_id, allocation_id);
