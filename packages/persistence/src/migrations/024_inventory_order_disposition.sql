ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation',
    'order_confirmation', 'order_disposition'
  ));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate', 'order_confirmation', 'order_cancellation_restore',
    'failed_delivery_restore'
  ));

ALTER TABLE inventory_protected_order_allocation
  ADD COLUMN source_line_id UUID;

UPDATE inventory_protected_order_allocation protected
SET source_line_id = matched.line_id
FROM (
  SELECT protected_inner.allocation_id, (line.value ->> 'id')::uuid AS line_id
  FROM inventory_protected_order_allocation protected_inner
  JOIN inventory_protected_order header ON header.order_id = protected_inner.protected_order_id
  JOIN inventory_allocation allocation ON allocation.id = protected_inner.allocation_id
  JOIN online_order_confirmation confirmation ON confirmation.order_id = header.order_id
  CROSS JOIN LATERAL jsonb_array_elements(confirmation.confirmed_quote_json -> 'lines') AS line(value)
  WHERE line.value ->> 'variantId' = allocation.variant_id::text
) matched
WHERE protected.allocation_id = matched.allocation_id;

ALTER TABLE inventory_protected_order_allocation
  ALTER COLUMN source_line_id SET NOT NULL,
  ADD CONSTRAINT inventory_protected_order_allocation_source_line_unique
    UNIQUE (allocation_id, source_line_id);

CREATE INDEX inventory_protected_order_allocation_line
  ON inventory_protected_order_allocation (protected_order_id, source_line_id, allocation_id);

CREATE TABLE inventory_order_disposition (
  operation_id UUID PRIMARY KEY REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES inventory_protected_order (order_id) ON DELETE RESTRICT,
  disposition_type TEXT NOT NULL CHECK (disposition_type IN ('pre_shipment_cancellation', 'failed_delivery_inspection')),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_order_disposition_order_operation_unique UNIQUE (order_id, operation_id)
);

CREATE INDEX inventory_order_disposition_order
  ON inventory_order_disposition (order_id, recorded_at, operation_id);

CREATE TABLE inventory_order_disposition_allocation (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES inventory_order_disposition (operation_id) ON DELETE RESTRICT,
  allocation_id UUID NOT NULL REFERENCES inventory_protected_order_allocation (allocation_id) ON DELETE RESTRICT,
  source_line_id UUID NOT NULL,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK (disposition IN ('sellable_restored', 'nonsellable_removed')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_order_disposition_allocation_operation_unique
    UNIQUE (operation_id, allocation_id, disposition),
  CONSTRAINT inventory_order_disposition_allocation_line_fk
    FOREIGN KEY (allocation_id, source_line_id)
    REFERENCES inventory_protected_order_allocation (allocation_id, source_line_id) ON DELETE RESTRICT
);

CREATE INDEX inventory_order_disposition_allocation_source
  ON inventory_order_disposition_allocation (allocation_id, recorded_at, id);

CREATE INDEX inventory_order_disposition_allocation_order_line
  ON inventory_order_disposition_allocation (source_line_id, variant_id, recorded_at, id);
