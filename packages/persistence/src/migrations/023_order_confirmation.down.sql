DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM online_order_operation)
    OR EXISTS (SELECT 1 FROM online_order_agreement_quote)
    OR EXISTS (SELECT 1 FROM online_order WHERE status <> 'pending') THEN
    RAISE EXCEPTION 'Cannot revert order confirmation migration while retained order-handling history exists';
  END IF;
END $$;

DROP TABLE online_order_settings;
DROP TABLE online_order_unreachable_cancellation;
DROP TABLE online_order_confirmation;
DROP TABLE online_order_agreed_revision;
DROP TABLE online_order_contact_attempt;
DROP TABLE online_order_operation;
DROP TABLE online_order_agreement_quote;

ALTER TABLE online_order
  DROP CONSTRAINT online_order_cancellation_shape,
  DROP CONSTRAINT online_order_confirmation_shape,
  DROP COLUMN cancellation_reason,
  DROP COLUMN cancelled_at,
  DROP COLUMN cancelled_by_staff_id,
  DROP COLUMN confirmed_at,
  DROP COLUMN confirmed_by_staff_id,
  DROP COLUMN revision;
ALTER TABLE online_order DROP CONSTRAINT online_order_status_check;
ALTER TABLE online_order ADD CONSTRAINT online_order_status_check CHECK (status = 'pending');
