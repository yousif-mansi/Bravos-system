DO $$
DECLARE
  next_number BIGINT;
BEGIN
  SELECT last_number + 1 INTO STRICT next_number FROM sales_pos_reference_counter WHERE singleton;
  EXECUTE format('ALTER SEQUENCE sales_sale_reference_number_seq RESTART WITH %s', next_number);
END;
$$;

ALTER TABLE sales_sale ALTER COLUMN reference
  SET DEFAULT bravos_human_reference('POS-', nextval('sales_sale_reference_number_seq'));

DROP TABLE sales_pos_reference_counter;
