CREATE TABLE sales_pos_snapshot (
  id UUID PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  branch_id UUID NOT NULL REFERENCES branch (id),
  device_id UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  price_fingerprint TEXT NOT NULL
);

CREATE INDEX sales_pos_snapshot_staff ON sales_pos_snapshot (staff_id, issued_at DESC);

CREATE TABLE sales_pos_snapshot_price (
  snapshot_id UUID NOT NULL REFERENCES sales_pos_snapshot (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  listed_unit_price_piasters INTEGER NOT NULL
    CONSTRAINT sales_pos_snapshot_price_nonnegative CHECK (listed_unit_price_piasters >= 0),
  PRIMARY KEY (snapshot_id, variant_id)
);
