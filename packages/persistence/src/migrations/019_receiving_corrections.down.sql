DROP TABLE IF EXISTS receiving_correction_line;
DROP INDEX IF EXISTS receiving_correction_history;
DROP TABLE IF EXISTS receiving_correction;

ALTER TABLE inventory_batch
  DROP CONSTRAINT inventory_batch_remaining_lte_effective_received,
  DROP CONSTRAINT inventory_batch_effective_cost_nonnegative,
  DROP CONSTRAINT inventory_batch_effective_received_nonnegative,
  DROP COLUMN effective_unit_cost_piasters,
  DROP COLUMN effective_received_quantity,
  ADD CONSTRAINT inventory_batch_remaining_lte_received CHECK (remaining_quantity <= received_quantity);
