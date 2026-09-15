ALTER TABLE sales_sale_unit DROP CONSTRAINT sales_sale_unit_effects_total;
ALTER TABLE sales_sale_unit DROP COLUMN coupon_discount_piasters;
ALTER TABLE sales_sale_unit ADD CONSTRAINT sales_sale_unit_effects_total CHECK (
  discount_piasters = automatic_offer_discount_piasters + employee_discount_piasters
);

ALTER TABLE sales_sale_line DROP CONSTRAINT sales_sale_line_effects_total;
ALTER TABLE sales_sale_line DROP COLUMN coupon_discount_piasters;
ALTER TABLE sales_sale_line ADD CONSTRAINT sales_sale_line_effects_total CHECK (
  discount_piasters = automatic_offer_discount_piasters + employee_discount_piasters
);

ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_totals;
ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_applied_coupon_complete;
ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_coupon_discount_nonnegative;
ALTER TABLE sales_sale
  DROP COLUMN applied_coupon_allow_automatic_offer,
  DROP COLUMN applied_coupon_fixed_discount_piasters,
  DROP COLUMN applied_coupon_percentage_basis_points,
  DROP COLUMN applied_coupon_type,
  DROP COLUMN applied_coupon_code,
  DROP COLUMN applied_coupon_id,
  DROP COLUMN coupon_discount_piasters;
ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_totals CHECK (
  final_total_piasters = original_total_piasters - automatic_offer_discount_piasters - employee_discount_piasters
);

DROP TABLE pricing_coupon_usage;
DROP TABLE pricing_coupon_category;
DROP TABLE pricing_coupon_product;
DROP TABLE pricing_coupon;
