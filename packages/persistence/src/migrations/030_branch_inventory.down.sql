DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_batch)
     OR EXISTS (SELECT 1 FROM inventory_movement)
     OR EXISTS (SELECT 1 FROM inventory_allocation)
     OR EXISTS (SELECT 1 FROM inventory_discrepancy) THEN
    RAISE EXCEPTION 'Cannot roll back branch inventory after stock activity.';
  END IF;
END $$;

DROP INDEX IF EXISTS inventory_stock_correction_branch_variant_time;
DROP INDEX IF EXISTS inventory_discrepancy_branch_variant;
ALTER TABLE inventory_stock_reconciliation DROP COLUMN branch_id;
ALTER TABLE inventory_stock_correction DROP COLUMN branch_id;
ALTER TABLE inventory_order_disposition DROP COLUMN branch_id;
ALTER TABLE inventory_protected_order DROP COLUMN branch_id;
ALTER TABLE receiving_receipt DROP CONSTRAINT receiving_receipt_operation_branch_unique;
ALTER TABLE receiving_receipt DROP COLUMN branch_id;
ALTER TABLE receiving_receipt ADD CONSTRAINT receiving_receipt_operation_id_key UNIQUE (operation_id);
ALTER TABLE inventory_discrepancy DROP CONSTRAINT inventory_discrepancy_operation_branch_variant;
ALTER TABLE inventory_discrepancy DROP COLUMN branch_id;
ALTER TABLE inventory_discrepancy ADD CONSTRAINT inventory_discrepancy_operation_variant UNIQUE (operation_id, variant_id);
ALTER TABLE inventory_allocation DROP CONSTRAINT inventory_allocation_batch_branch_fk;
ALTER TABLE inventory_allocation DROP COLUMN branch_id;
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_batch_branch_fk;
ALTER TABLE inventory_movement DROP COLUMN branch_id;
ALTER TABLE inventory_batch ADD COLUMN remaining_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch ADD CONSTRAINT inventory_batch_remaining_nonnegative CHECK (remaining_quantity >= 0);
ALTER TABLE inventory_batch ADD CONSTRAINT inventory_batch_remaining_lte_effective_received
  CHECK (remaining_quantity <= effective_received_quantity);
DROP INDEX IF EXISTS inventory_batch_balance_branch;
DROP TRIGGER restore_write_guard_inventory_batch_balance ON inventory_batch_balance;
DROP TABLE inventory_batch_balance;
