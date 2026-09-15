DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_order_disposition)
    OR EXISTS (SELECT 1 FROM inventory_order_disposition_allocation) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Cannot revert inventory order disposition migration while retained disposition history exists';
  END IF;
END $$;

DROP TABLE inventory_order_disposition_allocation;
DROP TABLE inventory_order_disposition;

DROP INDEX inventory_protected_order_allocation_line;
ALTER TABLE inventory_protected_order_allocation
  DROP CONSTRAINT inventory_protected_order_allocation_source_line_unique,
  DROP COLUMN source_line_id;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate', 'order_confirmation'
  ));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation',
    'order_confirmation'
  ));
