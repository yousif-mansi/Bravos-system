DROP TABLE IF EXISTS returns_refund_event;
DROP TABLE IF EXISTS returns_batch_restoration;
DROP TABLE IF EXISTS returns_return_unit;
DROP TABLE IF EXISTS returns_return_line;
DROP TABLE IF EXISTS returns_return;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM inventory_batch b
    JOIN (
      SELECT batch_id, SUM(quantity)::int AS restored
      FROM inventory_movement WHERE kind = 'return' GROUP BY batch_id
    ) r ON r.batch_id = b.id
    WHERE b.remaining_quantity < r.restored
  ) THEN
    RAISE EXCEPTION 'cannot revert physical returns after restored units were reallocated';
  END IF;
END $$;

UPDATE inventory_batch b
SET remaining_quantity = b.remaining_quantity - r.restored
FROM (
  SELECT batch_id, SUM(quantity)::int AS restored
  FROM inventory_movement WHERE kind = 'return' GROUP BY batch_id
) r
WHERE r.batch_id = b.id;

DELETE FROM inventory_movement WHERE kind = 'return';
DELETE FROM inventory_operation WHERE kind = 'return';

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive', 'sale'));

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive', 'sale'));
