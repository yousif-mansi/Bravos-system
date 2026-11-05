-- The existing archive manifest carries the high-water mark for this singleton.
-- Take the sale table lock before reading its high-water mark.
ALTER TABLE sales_sale ALTER COLUMN reference DROP DEFAULT;

CREATE TABLE sales_pos_reference_counter (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  last_number BIGINT NOT NULL CHECK (last_number >= 0)
);

INSERT INTO sales_pos_reference_counter (singleton, last_number)
SELECT TRUE, GREATEST(
  COALESCE((SELECT MAX(substring(reference FROM '^POS-([0-9]+)$')::bigint) FROM sales_sale), 0),
  CASE WHEN is_called THEN last_value ELSE last_value - 1 END
)
FROM sales_sale_reference_number_seq;

CREATE TRIGGER restore_write_guard_sales_pos_reference_counter
  BEFORE INSERT OR UPDATE OR DELETE ON sales_pos_reference_counter
  FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard();
