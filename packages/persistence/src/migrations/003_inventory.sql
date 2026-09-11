CREATE TABLE inventory_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  low_stock_threshold INTEGER NOT NULL
    CONSTRAINT inventory_settings_threshold_nonnegative CHECK (low_stock_threshold >= 0),
  updated_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO inventory_settings (id, low_stock_threshold) VALUES ('default', 3);

CREATE TABLE inventory_operation (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL
    CONSTRAINT inventory_operation_kind_known CHECK (kind IN ('receive')),
  payload_fingerprint TEXT NOT NULL,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_batch (
  id UUID PRIMARY KEY,
  variant_id UUID NOT NULL,
  received_quantity INTEGER NOT NULL
    CONSTRAINT inventory_batch_received_positive CHECK (received_quantity > 0),
  remaining_quantity INTEGER NOT NULL
    CONSTRAINT inventory_batch_remaining_nonnegative CHECK (remaining_quantity >= 0),
  unit_cost_piasters INTEGER NOT NULL
    CONSTRAINT inventory_batch_cost_nonnegative CHECK (unit_cost_piasters >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  operation_id UUID NOT NULL REFERENCES inventory_operation (id),
  source_receipt_id UUID NOT NULL,
  receipt_date DATE NOT NULL,
  source_line_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_batch_remaining_lte_received CHECK (remaining_quantity <= received_quantity),
  CONSTRAINT inventory_batch_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX inventory_batch_source_line ON inventory_batch (source_line_id);
CREATE INDEX inventory_batch_fifo ON inventory_batch (variant_id, recorded_at, id);

CREATE TABLE inventory_movement (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES inventory_batch (id),
  variant_id UUID NOT NULL,
  operation_id UUID NOT NULL REFERENCES inventory_operation (id),
  kind TEXT NOT NULL
    CONSTRAINT inventory_movement_kind_known CHECK (kind IN ('receive')),
  quantity INTEGER NOT NULL
    CONSTRAINT inventory_movement_quantity_positive CHECK (quantity > 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT inventory_movement_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT
);

CREATE INDEX inventory_movement_operation ON inventory_movement (operation_id);
CREATE INDEX inventory_movement_batch ON inventory_movement (batch_id);

CREATE TABLE inventory_variant_setting (
  variant_id UUID PRIMARY KEY,
  low_stock_threshold INTEGER
    CONSTRAINT inventory_variant_threshold_nonnegative CHECK (
      low_stock_threshold IS NULL OR low_stock_threshold >= 0
    ),
  updated_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_variant_setting_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE CASCADE
);
