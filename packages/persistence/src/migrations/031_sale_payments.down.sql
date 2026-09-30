ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_online_received_nonnegative;
ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_payment_method;
ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_settlement_matches_total;
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_settlement_matches_total
  CHECK (exchange_credit_applied_piasters + cash_received_piasters = final_total_piasters);
ALTER TABLE sales_sale DROP COLUMN online_received_piasters;
ALTER TABLE sales_sale DROP COLUMN payment_method;
