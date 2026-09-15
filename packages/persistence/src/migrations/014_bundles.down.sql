ALTER TABLE sales_sale
  DROP CONSTRAINT sales_sale_applied_offer_complete,
  DROP COLUMN applied_automatic_offer_details,
  ADD CONSTRAINT sales_sale_applied_offer_complete CHECK (
    (applied_automatic_offer_id IS NULL
      AND applied_automatic_offer_name_ar IS NULL
      AND applied_automatic_offer_type IS NULL
      AND applied_automatic_offer_percentage_basis_points IS NULL
      AND applied_automatic_offer_fixed_discount_piasters IS NULL
      AND applied_automatic_offer_allow_coupon IS NULL
      AND automatic_offer_discount_piasters = 0)
    OR
    (applied_automatic_offer_id IS NOT NULL
      AND applied_automatic_offer_name_ar IS NOT NULL
      AND applied_automatic_offer_allow_coupon IS NOT NULL
      AND automatic_offer_discount_piasters > 0
      AND (
        (applied_automatic_offer_type = 'percentage'
          AND applied_automatic_offer_percentage_basis_points BETWEEN 1 AND 10000
          AND applied_automatic_offer_fixed_discount_piasters IS NULL)
        OR
        (applied_automatic_offer_type = 'fixed'
          AND applied_automatic_offer_percentage_basis_points IS NULL
          AND applied_automatic_offer_fixed_discount_piasters > 0)
      ))
  );

DROP TABLE pricing_automatic_offer_reward_category;
DROP TABLE pricing_automatic_offer_reward_product;
DROP TABLE pricing_automatic_offer_buy_category;
DROP TABLE pricing_automatic_offer_buy_product;
DROP TABLE pricing_automatic_offer_bundle_item;

ALTER TABLE pricing_automatic_offer
  DROP CONSTRAINT pricing_offer_value_matches_type,
  DROP CONSTRAINT pricing_offer_type_known,
  DROP COLUMN reward_percentage_basis_points,
  DROP COLUMN reward_quantity,
  DROP COLUMN buy_quantity,
  DROP COLUMN bundle_price_piasters,
  ADD CONSTRAINT pricing_offer_type_known CHECK (discount_type IN ('percentage', 'fixed')),
  ADD CONSTRAINT pricing_offer_value_matches_type CHECK (
    (discount_type = 'percentage' AND percentage_basis_points BETWEEN 1 AND 10000 AND fixed_discount_piasters IS NULL)
    OR
    (discount_type = 'fixed' AND percentage_basis_points IS NULL AND fixed_discount_piasters > 0)
  );
