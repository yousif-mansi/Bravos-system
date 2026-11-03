DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_transfer)
    OR EXISTS (SELECT 1 FROM inventory_operation WHERE kind = 'transfer') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while a transfer exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM inventory_batch_balance balance
    JOIN branch ON branch.id = balance.branch_id
    WHERE branch.code = 'warehouse' AND balance.remaining_quantity > 0
  ) OR EXISTS (
    SELECT 1 FROM inventory_movement movement
    JOIN branch ON branch.id = movement.branch_id
    WHERE branch.code = 'warehouse'
  ) OR EXISTS (
    SELECT 1 FROM receiving_receipt receipt
    JOIN branch ON branch.id = receipt.branch_id
    WHERE branch.code = 'warehouse'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while warehouse history exists';
  END IF;
  IF EXISTS (SELECT 1 FROM supplier)
    OR EXISTS (SELECT 1 FROM receiving_receipt WHERE supplier_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while a supplier exists';
  END IF;
  IF EXISTS (SELECT 1 FROM customer)
    OR EXISTS (SELECT 1 FROM sales_sale WHERE customer_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while a customer exists';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog_product WHERE minimum_selling_price_piasters IS NOT NULL)
    OR EXISTS (SELECT 1 FROM sales_sale_line WHERE accepted_minimum_unit_piasters IS NOT NULL)
    OR EXISTS (SELECT 1 FROM sales_pos_snapshot_price WHERE minimum_unit_price_piasters IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while a minimum price exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM inventory_batch batch
    JOIN catalog_product_variant variant ON variant.id = batch.variant_id
    WHERE variant.purpose = 'operational'
  ) OR EXISTS (
    SELECT 1 FROM inventory_allocation allocation
    WHERE allocation.requested_variant_id IS NOT NULL
      AND allocation.requested_variant_id IS DISTINCT FROM allocation.variant_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cannot revert operational stock while operational batches exist';
  END IF;
END $$;

DROP TRIGGER restore_write_guard_inventory_transfer ON inventory_transfer;
DROP TABLE inventory_transfer;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate', 'order_confirmation', 'order_cancellation_restore',
    'failed_delivery_restore'
  ));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation',
    'order_confirmation', 'order_disposition'
  ));

ALTER TABLE sales_pos_snapshot_price DROP CONSTRAINT sales_pos_snapshot_minimum_nonnegative;
ALTER TABLE sales_pos_snapshot_price DROP COLUMN minimum_unit_price_piasters;

ALTER TABLE sales_sale_line DROP CONSTRAINT sales_sale_line_accepted_minimum_nonnegative;
ALTER TABLE sales_sale_line DROP COLUMN accepted_minimum_unit_piasters;

ALTER TABLE sales_sale DROP COLUMN customer_id;
DROP TRIGGER restore_write_guard_customer ON customer;
DROP TABLE customer;

ALTER TABLE receiving_receipt DROP COLUMN supplier_id;
DROP TRIGGER restore_write_guard_supplier ON supplier;
DROP TABLE supplier;

ALTER TABLE inventory_allocation DROP COLUMN requested_variant_id;

DROP TRIGGER inventory_batch_product_from_variant ON inventory_batch;
DROP FUNCTION inventory_batch_product_from_variant();
DROP INDEX inventory_batch_product_fifo;
ALTER TABLE inventory_batch DROP CONSTRAINT inventory_batch_product_fk;
ALTER TABLE inventory_batch DROP COLUMN product_id;

DROP TRIGGER catalog_product_ensure_operational ON catalog_product;
DROP FUNCTION catalog_product_ensure_operational();

DELETE FROM catalog_product_variant WHERE purpose = 'operational';
DROP INDEX catalog_product_variant_one_operational;
ALTER TABLE catalog_product_variant DROP CONSTRAINT catalog_product_variant_purpose_known;
ALTER TABLE catalog_product_variant DROP COLUMN purpose;

DELETE FROM catalog_size WHERE id = 'a0000000-0000-4000-8000-000000000001';
DELETE FROM catalog_color WHERE id = 'a0000000-0000-4000-8000-000000000002';

ALTER TABLE catalog_product DROP CONSTRAINT catalog_product_minimum_lte_price;
ALTER TABLE catalog_product DROP CONSTRAINT catalog_product_minimum_nonnegative;
ALTER TABLE catalog_product DROP COLUMN minimum_selling_price_piasters;

DELETE FROM branch WHERE id = '33333333-3333-4333-8333-333333333333';
ALTER TABLE branch DROP CONSTRAINT branch_kind_matches_code;
ALTER TABLE branch DROP CONSTRAINT branch_code_known;
ALTER TABLE branch DROP CONSTRAINT branch_kind_known;
ALTER TABLE branch DROP COLUMN kind;
ALTER TABLE branch
  ADD CONSTRAINT branch_code_known CHECK (code IN ('abshway', 'fayoum'));
