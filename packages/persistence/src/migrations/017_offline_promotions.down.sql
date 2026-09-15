ALTER TABLE sales_pos_snapshot
  DROP CONSTRAINT sales_pos_snapshot_pricing_version,
  DROP CONSTRAINT sales_pos_snapshot_coupon_accounted_operations_array,
  DROP CONSTRAINT sales_pos_snapshot_coupons_array,
  DROP CONSTRAINT sales_pos_snapshot_automatic_offers_array,
  DROP COLUMN coupons,
  DROP COLUMN coupon_accounted_operations,
  DROP COLUMN automatic_offers,
  DROP COLUMN pricing_version;

ALTER TABLE sales_pos_snapshot_price
  DROP COLUMN category_id,
  DROP COLUMN product_id;

ALTER TABLE sales_sale
  DROP CONSTRAINT sales_sale_coupon_usage_discrepancy_complete,
  DROP COLUMN coupon_usage_actual_count,
  DROP COLUMN coupon_usage_count_before,
  DROP COLUMN coupon_usage_limit,
  DROP COLUMN coupon_usage_discrepancy_detected_at;
