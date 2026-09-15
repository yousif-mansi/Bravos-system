DROP TABLE IF EXISTS recording_merchandise_fact;
DROP TABLE IF EXISTS recording_return_line_value;
ALTER TABLE returns_return DROP CONSTRAINT returns_return_paid_state;
ALTER TABLE returns_return
  ADD CONSTRAINT returns_return_paid_state CHECK (
    (refund_status = 'none' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_status = 'owed' AND refund_paid_piasters = 0
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
    OR (refund_status = 'paid' AND refund_paid_piasters = authorized_refund_piasters
      AND refund_recorded_by_staff_id IS NOT NULL AND refund_recorded_at IS NOT NULL)
  );
ALTER TABLE returns_return_unit
  DROP CONSTRAINT returns_return_unit_source_exact,
  DROP COLUMN source_recording_sale_unit_id,
  ALTER COLUMN source_sale_unit_id SET NOT NULL;
DROP TABLE IF EXISTS recording_sale_unit_value;
DROP TABLE IF EXISTS recording_sale_line_value;
DROP TABLE IF EXISTS recording_correction;

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive', 'sale', 'return'));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive', 'sale', 'return'));
