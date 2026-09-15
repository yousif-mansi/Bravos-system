ALTER TABLE sales_sale
  ADD COLUMN exchange_credit_applied_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN cash_received_piasters BIGINT;

ALTER TABLE returns_return
  DROP CONSTRAINT returns_return_paid_state,
  ADD COLUMN exchange_credit_applied_piasters BIGINT NOT NULL DEFAULT 0
    CONSTRAINT returns_return_exchange_credit_nonnegative CHECK (exchange_credit_applied_piasters >= 0),
  ADD CONSTRAINT returns_return_paid_state CHECK (
    (refund_status = 'none' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_status = 'owed' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
    OR (refund_status = 'paid' AND refund_paid_piasters >= 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
  );

UPDATE sales_sale SET cash_received_piasters = final_total_piasters;

ALTER TABLE sales_sale
  ALTER COLUMN cash_received_piasters SET NOT NULL,
  ADD CONSTRAINT sales_sale_exchange_credit_nonnegative CHECK (exchange_credit_applied_piasters >= 0),
  ADD CONSTRAINT sales_sale_cash_received_nonnegative CHECK (cash_received_piasters >= 0),
  ADD CONSTRAINT sales_sale_settlement_matches_total
    CHECK (exchange_credit_applied_piasters + cash_received_piasters = final_total_piasters);

CREATE TABLE returns_exchange_quote (
  id UUID PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES returns_return (id) ON DELETE RESTRICT,
  return_revision INTEGER NOT NULL CHECK (return_revision >= 1),
  correction_revision INTEGER NOT NULL CHECK (correction_revision >= 0),
  credit_available_piasters BIGINT NOT NULL CHECK (credit_available_piasters >= 0),
  settlement_identity JSONB NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  accepted_quote JSONB NOT NULL,
  quoted_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  quoted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX returns_exchange_quote_return ON returns_exchange_quote (return_id);

CREATE TABLE returns_exchange (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  return_id UUID NOT NULL UNIQUE REFERENCES returns_return (id) ON DELETE RESTRICT,
  replacement_sale_id UUID NOT NULL UNIQUE REFERENCES sales_sale (id) ON DELETE RESTRICT,
  payload_fingerprint TEXT NOT NULL,
  credit_available_piasters BIGINT NOT NULL
    CONSTRAINT returns_exchange_credit_available_nonnegative CHECK (credit_available_piasters >= 0),
  credit_applied_piasters BIGINT NOT NULL
    CONSTRAINT returns_exchange_credit_nonnegative CHECK (credit_applied_piasters >= 0),
  cash_collected_piasters BIGINT NOT NULL
    CONSTRAINT returns_exchange_cash_collected_nonnegative CHECK (cash_collected_piasters >= 0),
  cash_refund_status TEXT NOT NULL
    CONSTRAINT returns_exchange_cash_refund_status_known CHECK (cash_refund_status IN ('none', 'owed', 'paid')),
  cash_refund_piasters BIGINT NOT NULL
    CONSTRAINT returns_exchange_cash_refund_nonnegative CHECK (cash_refund_piasters >= 0),
  cash_refund_paid_piasters BIGINT NOT NULL
    CONSTRAINT returns_exchange_cash_refund_paid_nonnegative CHECK (cash_refund_paid_piasters >= 0),
  completed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT returns_exchange_cash_refund_shape CHECK (
    (cash_refund_status = 'none' AND cash_refund_piasters = 0 AND cash_refund_paid_piasters = 0)
    OR (cash_refund_status = 'owed' AND cash_refund_piasters > 0 AND cash_refund_paid_piasters = 0)
    OR (cash_refund_status = 'paid' AND cash_refund_piasters > 0 AND cash_refund_paid_piasters = cash_refund_piasters)
  ),
  CONSTRAINT returns_exchange_credit_settlement_matches
    CHECK (credit_applied_piasters + cash_refund_piasters = credit_available_piasters)
);

CREATE INDEX returns_exchange_return ON returns_exchange (return_id);
CREATE INDEX returns_exchange_sale ON returns_exchange (replacement_sale_id);
