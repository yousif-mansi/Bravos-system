ALTER TABLE sales_pos_snapshot
  ADD COLUMN pricing_version SMALLINT,
  ADD COLUMN automatic_offers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN coupons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN coupon_accounted_operations JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE sales_pos_snapshot_price
  ADD COLUMN product_id UUID REFERENCES catalog_product (id),
  ADD COLUMN category_id UUID REFERENCES catalog_category (id);

UPDATE sales_pos_snapshot_price sp
SET product_id = pv.product_id,
    category_id = p.category_id
FROM catalog_product_variant pv
JOIN catalog_product p ON p.id = pv.product_id
WHERE pv.id = sp.variant_id;

ALTER TABLE sales_pos_snapshot_price
  ALTER COLUMN product_id SET NOT NULL,
  ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE sales_pos_snapshot
  ADD CONSTRAINT sales_pos_snapshot_pricing_version CHECK (pricing_version IS NULL OR pricing_version = 1),
  ADD CONSTRAINT sales_pos_snapshot_automatic_offers_array CHECK (jsonb_typeof(automatic_offers) = 'array'),
  ADD CONSTRAINT sales_pos_snapshot_coupons_array CHECK (jsonb_typeof(coupons) = 'array'),
  ADD CONSTRAINT sales_pos_snapshot_coupon_accounted_operations_array CHECK (jsonb_typeof(coupon_accounted_operations) = 'array');

ALTER TABLE sales_sale
  ADD COLUMN coupon_usage_discrepancy_detected_at TIMESTAMPTZ,
  ADD COLUMN coupon_usage_limit INTEGER,
  ADD COLUMN coupon_usage_count_before INTEGER,
  ADD COLUMN coupon_usage_actual_count INTEGER,
  ADD CONSTRAINT sales_sale_coupon_usage_discrepancy_complete CHECK (
    (coupon_usage_discrepancy_detected_at IS NULL
      AND coupon_usage_limit IS NULL
      AND coupon_usage_count_before IS NULL
      AND coupon_usage_actual_count IS NULL)
    OR
    (coupon_usage_discrepancy_detected_at IS NOT NULL
      AND coupon_usage_limit > 0
      AND coupon_usage_count_before >= coupon_usage_limit
      AND coupon_usage_actual_count = coupon_usage_count_before + 1
      AND applied_coupon_id IS NOT NULL
      AND coupon_discount_piasters > 0)
  );
