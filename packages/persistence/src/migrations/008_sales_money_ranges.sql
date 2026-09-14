ALTER TABLE sales_sale
  ALTER COLUMN original_total_piasters TYPE BIGINT,
  ALTER COLUMN employee_discount_piasters TYPE BIGINT,
  ALTER COLUMN final_total_piasters TYPE BIGINT;

ALTER TABLE sales_sale_line
  ALTER COLUMN original_piasters TYPE BIGINT,
  ALTER COLUMN discount_piasters TYPE BIGINT,
  ALTER COLUMN paid_piasters TYPE BIGINT;

ALTER TABLE sales_sale_unit
  ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
    CONSTRAINT sales_sale_unit_quantity_positive CHECK (quantity > 0);
