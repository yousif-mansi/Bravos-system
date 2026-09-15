DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_protected_order) THEN
    RAISE EXCEPTION 'cannot revert protected order allocations while confirmed merchandise exists';
  END IF;
END $$;

DROP INDEX IF EXISTS inventory_protected_order_allocation_operation;
DROP INDEX IF EXISTS inventory_protected_order_allocation_order;
DROP TABLE inventory_protected_order_allocation;
DROP TABLE inventory_protected_order;

ALTER TABLE inventory_allocation
  DROP CONSTRAINT inventory_allocation_identity_operation_unique;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate'
  ));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN ('receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation'));
