DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM online_order_fulfillment_event)
    OR EXISTS (SELECT 1 FROM online_order_failed_return_inspection)
    OR EXISTS (SELECT 1 FROM online_order_failed_return_inspection_line)
    OR EXISTS (SELECT 1 FROM pricing_coupon_usage WHERE released_at IS NOT NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Cannot revert order fulfillment migration while retained fulfillment history exists';
  END IF;
END $$;

ALTER TABLE pricing_coupon_usage
  DROP CONSTRAINT pricing_coupon_usage_release_shape,
  DROP COLUMN released_by_staff_id,
  DROP COLUMN release_payload_fingerprint,
  DROP COLUMN release_operation_id;

DROP TABLE online_order_failed_return_inspection_line;
DROP TABLE online_order_failed_return_inspection;
DROP TABLE online_order_fulfillment_event;

ALTER TABLE online_order_operation DROP CONSTRAINT online_order_operation_operation_type_check;
ALTER TABLE online_order_operation
  ADD CONSTRAINT online_order_operation_operation_type_check
  CHECK (operation_type IN ('contact_attempt', 'agreed_revision', 'confirmation', 'unreachable_cancellation'));

ALTER TABLE online_order DROP CONSTRAINT online_order_cancellation_shape;
ALTER TABLE online_order DROP CONSTRAINT online_order_confirmation_shape;
ALTER TABLE online_order DROP CONSTRAINT online_order_status_check;
ALTER TABLE online_order
  ADD CONSTRAINT online_order_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled_unreachable')),
  ADD CONSTRAINT online_order_confirmation_shape CHECK (
    (status = 'confirmed' AND confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL)
  ),
  ADD CONSTRAINT online_order_cancellation_shape CHECK (
    (status = 'cancelled_unreachable' AND cancelled_by_staff_id IS NOT NULL
      AND cancelled_at IS NOT NULL AND char_length(btrim(cancellation_reason)) BETWEEN 1 AND 500)
    OR (status <> 'cancelled_unreachable' AND cancelled_by_staff_id IS NULL
      AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  );
