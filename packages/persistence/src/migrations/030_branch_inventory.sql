-- Existing shared stock has no reliable physical location. Refuse to guess its branch.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_batch)
     OR EXISTS (SELECT 1 FROM receiving_receipt)
     OR EXISTS (SELECT 1 FROM inventory_movement)
     OR EXISTS (SELECT 1 FROM inventory_allocation)
     OR EXISTS (SELECT 1 FROM inventory_discrepancy)
     OR EXISTS (SELECT 1 FROM inventory_protected_order) THEN
    RAISE EXCEPTION 'Branch inventory migration requires an empty business inventory; create a fresh database or reconcile stock explicitly.';
  END IF;
END $$;

CREATE TABLE inventory_batch_balance (
  batch_id UUID NOT NULL REFERENCES inventory_batch (id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
  PRIMARY KEY (batch_id, branch_id)
);

CREATE TRIGGER restore_write_guard_inventory_batch_balance
  BEFORE INSERT OR UPDATE OR DELETE ON inventory_batch_balance
  FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard();

CREATE INDEX inventory_batch_balance_branch ON inventory_batch_balance (branch_id, batch_id)
  WHERE remaining_quantity > 0;

ALTER TABLE inventory_batch DROP COLUMN remaining_quantity;

ALTER TABLE inventory_movement
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movement_batch_branch_fk
    FOREIGN KEY (batch_id, branch_id) REFERENCES inventory_batch_balance (batch_id, branch_id) ON DELETE RESTRICT;

ALTER TABLE inventory_allocation
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_allocation_batch_branch_fk
    FOREIGN KEY (batch_id, branch_id) REFERENCES inventory_batch_balance (batch_id, branch_id) ON DELETE RESTRICT;

ALTER TABLE inventory_discrepancy
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE inventory_discrepancy DROP CONSTRAINT inventory_discrepancy_operation_variant;
ALTER TABLE inventory_discrepancy ADD CONSTRAINT inventory_discrepancy_operation_branch_variant
  UNIQUE (operation_id, branch_id, variant_id);

ALTER TABLE receiving_receipt
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE receiving_receipt DROP CONSTRAINT receiving_receipt_operation_id_key;
ALTER TABLE receiving_receipt ADD CONSTRAINT receiving_receipt_operation_branch_unique
  UNIQUE (operation_id, branch_id);

ALTER TABLE inventory_protected_order
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE inventory_order_disposition
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_correction
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_reconciliation
  ADD COLUMN branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT;

CREATE INDEX inventory_discrepancy_branch_variant ON inventory_discrepancy (branch_id, variant_id)
  WHERE unallocated_quantity > 0;

CREATE INDEX inventory_stock_correction_branch_variant_time
  ON inventory_stock_correction (branch_id, variant_id, changed_at DESC, id DESC);
