DROP TABLE IF EXISTS inventory_stock_reconciliation_batch;
DROP INDEX IF EXISTS inventory_stock_reconciliation_sale;
DROP TABLE IF EXISTS inventory_stock_reconciliation;
DROP TABLE IF EXISTS inventory_stock_correction_batch;
DROP INDEX IF EXISTS inventory_stock_correction_variant_time;
DROP TABLE IF EXISTS inventory_stock_correction;
DROP TABLE IF EXISTS inventory_count_coordination_device;
DROP INDEX IF EXISTS inventory_one_active_count;
DROP TABLE IF EXISTS inventory_count_coordination;
DROP TABLE IF EXISTS inventory_known_till;

DROP INDEX IF EXISTS sales_sale_source_device;
ALTER TABLE sales_sale DROP COLUMN IF EXISTS source_snapshot_id;
ALTER TABLE sales_sale DROP COLUMN IF EXISTS source_device_id;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN ('receive', 'sale', 'return', 'correction_restore', 'correction_deduct'));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN ('receive', 'sale', 'return', 'correction'));
