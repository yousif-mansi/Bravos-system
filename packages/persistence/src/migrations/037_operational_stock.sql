-- Operational product stock, central warehouse, suppliers, customers, transfers, and a nullable selling floor.
-- Existing branch balances are not moved. Sentinel size/color rows exist only to satisfy the variant foreign keys.

ALTER TABLE branch DROP CONSTRAINT branch_code_known;
ALTER TABLE branch
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'retail'
    CONSTRAINT branch_kind_known CHECK (kind IN ('retail', 'warehouse'));
ALTER TABLE branch
  ADD CONSTRAINT branch_code_known CHECK (code IN ('abshway', 'fayoum', 'warehouse')),
  ADD CONSTRAINT branch_kind_matches_code CHECK (
    (kind = 'warehouse' AND code = 'warehouse')
    OR (kind = 'retail' AND code <> 'warehouse')
  );

INSERT INTO branch (id, code, name_ar, kind, created_at)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'warehouse',
  'المخزن المركزي',
  'warehouse',
  '2026-11-01T00:00:00.000Z'
);

ALTER TABLE catalog_product
  ADD COLUMN minimum_selling_price_piasters INTEGER
    CONSTRAINT catalog_product_minimum_nonnegative CHECK (
      minimum_selling_price_piasters IS NULL OR minimum_selling_price_piasters >= 0
    ),
  ADD CONSTRAINT catalog_product_minimum_lte_price CHECK (
    minimum_selling_price_piasters IS NULL
    OR minimum_selling_price_piasters <= default_selling_price_piasters
  );

ALTER TABLE catalog_product_variant
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'website_option'
    CONSTRAINT catalog_product_variant_purpose_known CHECK (purpose IN ('website_option', 'operational'));

CREATE UNIQUE INDEX catalog_product_variant_one_operational
  ON catalog_product_variant (product_id)
  WHERE purpose = 'operational';

INSERT INTO catalog_size (id, name_ar, created_at, updated_at)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'internal-operational-size',
  '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z'
);

INSERT INTO catalog_color (id, name_ar, created_at, updated_at)
VALUES (
  'a0000000-0000-4000-8000-000000000002',
  'internal-operational-color',
  '2026-11-01T00:00:00.000Z',
  '2026-11-01T00:00:00.000Z'
);

INSERT INTO catalog_product_variant (
  id, product_id, size_id, color_id, selling_price_piasters_override, online_visible, purpose, created_at, updated_at
)
SELECT (
  substr(md5('operational:' || product.id::text), 1, 8) || '-' ||
  substr(md5('operational:' || product.id::text), 9, 4) || '-' ||
  '4' || substr(md5('operational:' || product.id::text), 14, 3) || '-' ||
  '8' || substr(md5('operational:' || product.id::text), 18, 3) || '-' ||
  substr(md5('operational:' || product.id::text), 21, 12)
)::uuid,
       product.id,
       'a0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000002',
       NULL, FALSE, 'operational',
       '2026-11-01T00:00:00.000Z',
       '2026-11-01T00:00:00.000Z'
FROM catalog_product product;

CREATE FUNCTION catalog_product_ensure_operational() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('bravos.restore_loading', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catalog_product_variant
    WHERE product_id = NEW.id AND purpose = 'operational'
  ) THEN
    INSERT INTO catalog_product_variant (
      id, product_id, size_id, color_id, selling_price_piasters_override, online_visible, purpose
    ) VALUES (
      gen_random_uuid(), NEW.id,
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      NULL, FALSE, 'operational'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_product_ensure_operational
  AFTER INSERT ON catalog_product
  FOR EACH ROW EXECUTE FUNCTION catalog_product_ensure_operational();

ALTER TABLE inventory_batch ADD COLUMN product_id UUID;

UPDATE inventory_batch batch
SET product_id = variant.product_id
FROM catalog_product_variant variant
WHERE variant.id = batch.variant_id;

ALTER TABLE inventory_batch
  ALTER COLUMN product_id SET NOT NULL,
  ADD CONSTRAINT inventory_batch_product_fk
    FOREIGN KEY (product_id) REFERENCES catalog_product (id) ON DELETE RESTRICT;

CREATE FUNCTION inventory_batch_product_from_variant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  variant_product UUID;
BEGIN
  SELECT product_id INTO variant_product
  FROM catalog_product_variant
  WHERE id = NEW.variant_id;
  IF variant_product IS NULL THEN
    RAISE EXCEPTION 'inventory batch variant has no product';
  END IF;
  IF NEW.product_id IS NULL THEN
    NEW.product_id := variant_product;
  ELSIF NEW.product_id <> variant_product THEN
    RAISE EXCEPTION 'inventory batch product does not match its variant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_batch_product_from_variant
  BEFORE INSERT ON inventory_batch
  FOR EACH ROW EXECUTE FUNCTION inventory_batch_product_from_variant();

CREATE INDEX inventory_batch_product_fifo ON inventory_batch (product_id, recorded_at, id);

ALTER TABLE inventory_allocation
  ADD COLUMN requested_variant_id UUID
    REFERENCES catalog_product_variant (id) ON DELETE RESTRICT;

CREATE TABLE supplier (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  CONSTRAINT supplier_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 80)
);

CREATE TRIGGER restore_write_guard_supplier
  BEFORE INSERT OR UPDATE OR DELETE ON supplier
  FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard();

ALTER TABLE receiving_receipt
  ADD COLUMN supplier_id UUID REFERENCES supplier (id) ON DELETE RESTRICT;

CREATE TABLE customer (
  id UUID PRIMARY KEY,
  normalized_phone TEXT NOT NULL UNIQUE
    CONSTRAINT customer_phone_digits CHECK (normalized_phone ~ '^[0-9]{10,15}$'),
  display_name TEXT NOT NULL
    CONSTRAINT customer_display_name_len CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_staff_id TEXT REFERENCES staff_profile (staff_id)
);

CREATE TRIGGER restore_write_guard_customer
  BEFORE INSERT OR UPDATE OR DELETE ON customer
  FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard();

ALTER TABLE sales_sale
  ADD COLUMN customer_id UUID REFERENCES customer (id) ON DELETE RESTRICT;

ALTER TABLE sales_sale_line
  ADD COLUMN accepted_minimum_unit_piasters INTEGER
    CONSTRAINT sales_sale_line_accepted_minimum_nonnegative CHECK (
      accepted_minimum_unit_piasters IS NULL OR accepted_minimum_unit_piasters >= 0
    );

ALTER TABLE sales_pos_snapshot_price
  ADD COLUMN minimum_unit_price_piasters INTEGER
    CONSTRAINT sales_pos_snapshot_minimum_nonnegative CHECK (
      minimum_unit_price_piasters IS NULL OR minimum_unit_price_piasters >= 0
    );

ALTER TABLE inventory_operation DROP CONSTRAINT inventory_operation_kind_known;
ALTER TABLE inventory_operation
  ADD CONSTRAINT inventory_operation_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction', 'stock_correction', 'stock_reconciliation',
    'order_confirmation', 'order_disposition', 'transfer'
  ));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_known;
ALTER TABLE inventory_movement
  ADD CONSTRAINT inventory_movement_kind_known
  CHECK (kind IN (
    'receive', 'sale', 'return', 'correction_restore', 'correction_deduct',
    'stock_correction_restore', 'stock_correction_deduct', 'stock_reconciliation_restore',
    'stock_reconciliation_allocate', 'order_confirmation', 'order_cancellation_restore',
    'failed_delivery_restore', 'transfer_out', 'transfer_in'
  ));

CREATE TABLE inventory_transfer (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES inventory_operation (id) ON DELETE RESTRICT,
  source_branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  destination_branch_id UUID NOT NULL REFERENCES branch (id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  recorded_at TIMESTAMPTZ NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  CONSTRAINT inventory_transfer_distinct_locations CHECK (source_branch_id <> destination_branch_id)
);

CREATE INDEX inventory_transfer_product ON inventory_transfer (product_id, recorded_at DESC, id DESC);

CREATE TRIGGER restore_write_guard_inventory_transfer
  BEFORE INSERT OR UPDATE OR DELETE ON inventory_transfer
  FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard();
