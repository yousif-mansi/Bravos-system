CREATE TABLE receiving_receipt (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id),
  receipt_date DATE NOT NULL,
  received_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receiving_receipt_recorded ON receiving_receipt (recorded_at DESC, id DESC);

CREATE TABLE receiving_receipt_line (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL REFERENCES receiving_receipt (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL,
  quantity INTEGER NOT NULL
    CONSTRAINT receiving_receipt_line_quantity_positive CHECK (quantity > 0),
  unit_cost_piasters INTEGER NOT NULL
    CONSTRAINT receiving_receipt_line_cost_nonnegative CHECK (unit_cost_piasters >= 0),
  batch_id UUID NOT NULL REFERENCES inventory_batch (id),
  line_index INTEGER NOT NULL,
  CONSTRAINT receiving_receipt_line_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  CONSTRAINT receiving_receipt_line_unique UNIQUE (receipt_id, line_index)
);

CREATE INDEX receiving_receipt_line_receipt ON receiving_receipt_line (receipt_id);
