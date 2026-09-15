CREATE TABLE inventory_stock_clock (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  version BIGINT NOT NULL
    CONSTRAINT inventory_stock_clock_version_nonnegative CHECK (version >= 0)
);

INSERT INTO inventory_stock_clock (id, version) VALUES (TRUE, 0);

ALTER TABLE sales_sale
  ADD COLUMN recovered_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  ADD COLUMN recovered_at TIMESTAMPTZ;

ALTER TABLE sales_sale
  ADD CONSTRAINT sales_sale_recovery_pair CHECK (
    (recovered_by_staff_id IS NULL) = (recovered_at IS NULL)
  );
