DROP INDEX IF EXISTS sales_sale_receipt_reference_assigned_uidx;
ALTER TABLE sales_sale DROP CONSTRAINT IF EXISTS sales_sale_receipt_identity_shape;
ALTER TABLE sales_sale DROP COLUMN IF EXISTS receipt_identity;
DROP TABLE IF EXISTS sales_receipt_registration;
DROP SEQUENCE IF EXISTS sales_receipt_prefix_seq;
