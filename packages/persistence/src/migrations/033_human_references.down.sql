ALTER TABLE returns_return DROP CONSTRAINT returns_return_reference_unique;
ALTER TABLE returns_return DROP COLUMN reference;
DROP SEQUENCE returns_return_reference_number_seq;

ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_reference_unique;
ALTER TABLE sales_sale DROP COLUMN reference;
DROP SEQUENCE sales_sale_reference_number_seq;
DROP FUNCTION bravos_human_reference(TEXT, BIGINT);
