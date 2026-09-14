DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_sale
    WHERE original_total_piasters > 2147483647
       OR employee_discount_piasters > 2147483647
       OR final_total_piasters > 2147483647
  ) OR EXISTS (
    SELECT 1 FROM sales_sale_line
    WHERE original_piasters > 2147483647
       OR discount_piasters > 2147483647
       OR paid_piasters > 2147483647
  ) THEN
    RAISE EXCEPTION 'cannot restore 32-bit sale money columns without losing values';
  END IF;
END $$;

INSERT INTO sales_sale_unit (
  id, sale_id, line_id, unit_index, quantity, listed_piasters, discount_piasters, paid_piasters
)
SELECT
  gen_random_uuid(),
  sale_id,
  line_id,
  unit_index + step,
  1,
  listed_piasters,
  discount_piasters,
  paid_piasters
FROM sales_sale_unit
CROSS JOIN LATERAL generate_series(1, quantity - 1) AS step
WHERE quantity > 1;

UPDATE sales_sale_unit
SET quantity = 1
WHERE quantity <> 1;

ALTER TABLE sales_sale_unit
  DROP CONSTRAINT IF EXISTS sales_sale_unit_quantity_positive;

ALTER TABLE sales_sale_unit
  DROP COLUMN quantity;

ALTER TABLE sales_sale_line
  ALTER COLUMN original_piasters TYPE INTEGER,
  ALTER COLUMN discount_piasters TYPE INTEGER,
  ALTER COLUMN paid_piasters TYPE INTEGER;

ALTER TABLE sales_sale
  ALTER COLUMN original_total_piasters TYPE INTEGER,
  ALTER COLUMN employee_discount_piasters TYPE INTEGER,
  ALTER COLUMN final_total_piasters TYPE INTEGER;
