ALTER TABLE sales_sale DROP CONSTRAINT IF EXISTS sales_sale_recovery_pair;
ALTER TABLE sales_sale DROP COLUMN IF EXISTS recovered_by_staff_id;
ALTER TABLE sales_sale DROP COLUMN IF EXISTS recovered_at;
DROP TABLE IF EXISTS inventory_stock_clock;
