ALTER TABLE sales_sale
  ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN online_received_piasters BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_settlement_matches_total;
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_settlement_matches_total
  CHECK (exchange_credit_applied_piasters + cash_received_piasters + online_received_piasters = final_total_piasters);
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_payment_method
  CHECK (
    (payment_method = 'cash' AND online_received_piasters = 0) OR
    (payment_method = 'online' AND cash_received_piasters = 0) OR
    (payment_method = 'split' AND cash_received_piasters > 0 AND online_received_piasters > 0)
  );
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_online_received_nonnegative CHECK (online_received_piasters >= 0);
