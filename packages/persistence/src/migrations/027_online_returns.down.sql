DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM returns_return WHERE source_online_order_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM inventory_delivered_return_allocation_effect) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Cannot downgrade migration 027 while delivered online Return records exist.';
  END IF;
END $$;

DROP TABLE inventory_delivered_return_allocation_effect;
DROP TABLE recording_online_return_unit_value;

ALTER TABLE recording_correction
  DROP CONSTRAINT recording_correction_refund_components_shape,
  DROP CONSTRAINT recording_correction_refund_checkout_nonnegative,
  DROP CONSTRAINT recording_correction_refund_merchandise_nonnegative,
  DROP COLUMN effective_refund_checkout_charge_piasters,
  DROP COLUMN effective_refund_merchandise_piasters;

DROP INDEX returns_return_unit_online_segment_unique;
ALTER TABLE returns_return_unit DROP CONSTRAINT returns_return_unit_source_exact;
ALTER TABLE returns_return_unit
  DROP COLUMN source_online_order_unit_index,
  DROP COLUMN source_online_order_line_id,
  ADD CONSTRAINT returns_return_unit_source_exact CHECK (
    (source_sale_unit_id IS NOT NULL AND source_recording_sale_unit_id IS NULL)
    OR (source_sale_unit_id IS NULL AND source_recording_sale_unit_id IS NOT NULL)
  );

DROP INDEX returns_return_line_online_source;
DROP INDEX returns_return_line_online_unique;
ALTER TABLE returns_return_line
  DROP CONSTRAINT returns_return_line_source_exact,
  DROP COLUMN source_variant_id,
  DROP COLUMN source_online_order_line_id,
  ALTER COLUMN source_sale_line_id SET NOT NULL;

DROP INDEX returns_return_online_source;
ALTER TABLE returns_return
  DROP CONSTRAINT returns_return_authorized_components_total,
  DROP CONSTRAINT returns_return_suggested_components_total,
  DROP CONSTRAINT returns_return_authorized_checkout_nonnegative,
  DROP CONSTRAINT returns_return_authorized_merchandise_nonnegative,
  DROP CONSTRAINT returns_return_suggested_checkout_nonnegative,
  DROP CONSTRAINT returns_return_suggested_merchandise_nonnegative,
  DROP CONSTRAINT returns_return_source_exact,
  DROP COLUMN authorized_checkout_charge_refund_piasters,
  DROP COLUMN authorized_merchandise_refund_piasters,
  DROP COLUMN suggested_checkout_charge_refund_piasters,
  DROP COLUMN suggested_merchandise_refund_piasters,
  DROP COLUMN source_online_order_id,
  ALTER COLUMN source_sale_id SET NOT NULL;
