-- Human-facing numbers never replace the UUID identities used by offline retries.
CREATE FUNCTION bravos_human_reference(prefix TEXT, number BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT prefix || lpad(number::text, GREATEST(6, length(number::text)), '0')
$$;

CREATE SEQUENCE sales_sale_reference_number_seq;
ALTER TABLE sales_sale ADD COLUMN reference TEXT;
UPDATE sales_sale
SET reference = bravos_human_reference('POS-', nextval('sales_sale_reference_number_seq'));
ALTER TABLE sales_sale ALTER COLUMN reference
  SET DEFAULT bravos_human_reference('POS-', nextval('sales_sale_reference_number_seq'));
ALTER TABLE sales_sale ALTER COLUMN reference SET NOT NULL;
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_reference_unique UNIQUE (reference);

CREATE SEQUENCE returns_return_reference_number_seq;
ALTER TABLE returns_return ADD COLUMN reference TEXT;
UPDATE returns_return
SET reference = bravos_human_reference('RET-', nextval('returns_return_reference_number_seq'));
ALTER TABLE returns_return ALTER COLUMN reference
  SET DEFAULT bravos_human_reference('RET-', nextval('returns_return_reference_number_seq'));
ALTER TABLE returns_return ALTER COLUMN reference SET NOT NULL;
ALTER TABLE returns_return ADD CONSTRAINT returns_return_reference_unique UNIQUE (reference);
