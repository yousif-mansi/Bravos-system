DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM returns_exchange) THEN
    RAISE EXCEPTION 'Cannot downgrade migration 018 while exchange records exist; export or retain the credit-backed settlement history first.'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP TABLE IF EXISTS returns_exchange;
DROP TABLE IF EXISTS returns_exchange_quote;

ALTER TABLE sales_sale
  DROP CONSTRAINT IF EXISTS sales_sale_settlement_matches_total,
  DROP CONSTRAINT IF EXISTS sales_sale_cash_received_nonnegative,
  DROP CONSTRAINT IF EXISTS sales_sale_exchange_credit_nonnegative,
  DROP COLUMN IF EXISTS cash_received_piasters,
  DROP COLUMN IF EXISTS exchange_credit_applied_piasters;

ALTER TABLE returns_return
  DROP CONSTRAINT IF EXISTS returns_return_paid_state,
  DROP COLUMN IF EXISTS exchange_credit_applied_piasters,
  ADD CONSTRAINT returns_return_paid_state CHECK (
    (refund_status = 'none' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_status = 'owed' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
    OR (refund_status = 'paid' AND refund_paid_piasters = authorized_refund_piasters
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
  );
