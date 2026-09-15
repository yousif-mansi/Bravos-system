ALTER TABLE sales_sale_unit
  DROP CONSTRAINT sales_sale_unit_effects_total,
  DROP COLUMN employee_discount_piasters,
  DROP COLUMN automatic_offer_discount_piasters;

ALTER TABLE sales_sale_line
  DROP CONSTRAINT sales_sale_line_effects_total,
  DROP COLUMN employee_discount_piasters,
  DROP COLUMN automatic_offer_discount_piasters;

UPDATE sales_sale
SET employee_discount_piasters = employee_discount_piasters + automatic_offer_discount_piasters;

ALTER TABLE sales_sale
  DROP CONSTRAINT sales_sale_totals,
  DROP CONSTRAINT sales_sale_applied_offer_complete,
  DROP CONSTRAINT sales_sale_automatic_discount_nonnegative,
  DROP COLUMN applied_automatic_offer_allow_coupon,
  DROP COLUMN applied_automatic_offer_fixed_discount_piasters,
  DROP COLUMN applied_automatic_offer_percentage_basis_points,
  DROP COLUMN applied_automatic_offer_type,
  DROP COLUMN applied_automatic_offer_name_ar,
  DROP COLUMN applied_automatic_offer_id,
  DROP COLUMN automatic_offer_discount_piasters,
  ADD CONSTRAINT sales_sale_totals CHECK (
    final_total_piasters = original_total_piasters - employee_discount_piasters
  );

DROP TABLE pricing_automatic_offer_category;
DROP TABLE pricing_automatic_offer_product;
DROP TABLE pricing_automatic_offer;
