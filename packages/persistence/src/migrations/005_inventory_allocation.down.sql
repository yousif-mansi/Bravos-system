DROP TABLE IF EXISTS inventory_discrepancy;
DROP INDEX IF EXISTS inventory_allocation_batch;
DROP INDEX IF EXISTS inventory_allocation_operation;
DROP TABLE IF EXISTS inventory_allocation;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive'));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive'));
