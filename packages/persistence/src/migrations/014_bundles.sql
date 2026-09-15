ALTER TABLE pricing_automatic_offer
  DROP CONSTRAINT pricing_offer_type_known,
  DROP CONSTRAINT pricing_offer_value_matches_type,
  ADD COLUMN bundle_price_piasters BIGINT,
  ADD COLUMN buy_quantity BIGINT,
  ADD COLUMN reward_quantity BIGINT,
  ADD COLUMN reward_percentage_basis_points INTEGER,
  ADD CONSTRAINT pricing_offer_type_known CHECK (
    discount_type IN ('percentage', 'fixed', 'fixed_bundle', 'buy_x_get_y')
  ),
  ADD CONSTRAINT pricing_offer_value_matches_type CHECK (
    (discount_type = 'percentage'
      AND percentage_basis_points BETWEEN 1 AND 10000
      AND fixed_discount_piasters IS NULL
      AND bundle_price_piasters IS NULL
      AND buy_quantity IS NULL
      AND reward_quantity IS NULL
      AND reward_percentage_basis_points IS NULL)
    OR
    (discount_type = 'fixed'
      AND percentage_basis_points IS NULL
      AND fixed_discount_piasters > 0
      AND bundle_price_piasters IS NULL
      AND buy_quantity IS NULL
      AND reward_quantity IS NULL
      AND reward_percentage_basis_points IS NULL)
    OR
    (discount_type = 'fixed_bundle'
      AND percentage_basis_points IS NULL
      AND fixed_discount_piasters IS NULL
      AND bundle_price_piasters >= 0
      AND buy_quantity IS NULL
      AND reward_quantity IS NULL
      AND reward_percentage_basis_points IS NULL)
    OR
    (discount_type = 'buy_x_get_y'
      AND percentage_basis_points IS NULL
      AND fixed_discount_piasters IS NULL
      AND bundle_price_piasters IS NULL
      AND buy_quantity > 0
      AND reward_quantity > 0
      AND reward_percentage_basis_points BETWEEN 1 AND 10000)
  );

CREATE TABLE pricing_automatic_offer_bundle_item (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  required_quantity BIGINT NOT NULL CHECK (required_quantity > 0),
  PRIMARY KEY (offer_id, variant_id)
);

CREATE TABLE pricing_automatic_offer_buy_product (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, product_id)
);

CREATE TABLE pricing_automatic_offer_buy_category (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES catalog_category (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, category_id)
);

CREATE TABLE pricing_automatic_offer_reward_product (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, product_id)
);

CREATE TABLE pricing_automatic_offer_reward_category (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES catalog_category (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, category_id)
);

ALTER TABLE sales_sale
  DROP CONSTRAINT sales_sale_applied_offer_complete,
  ADD COLUMN applied_automatic_offer_details JSONB,
  ADD CONSTRAINT sales_sale_applied_offer_complete CHECK (
    (applied_automatic_offer_id IS NULL
      AND applied_automatic_offer_name_ar IS NULL
      AND applied_automatic_offer_type IS NULL
      AND applied_automatic_offer_percentage_basis_points IS NULL
      AND applied_automatic_offer_fixed_discount_piasters IS NULL
      AND applied_automatic_offer_allow_coupon IS NULL
      AND applied_automatic_offer_details IS NULL
      AND automatic_offer_discount_piasters = 0)
    OR
    (applied_automatic_offer_id IS NOT NULL
      AND applied_automatic_offer_name_ar IS NOT NULL
      AND applied_automatic_offer_allow_coupon IS NOT NULL
      AND automatic_offer_discount_piasters > 0
      AND (
        (applied_automatic_offer_type = 'percentage'
          AND applied_automatic_offer_percentage_basis_points BETWEEN 1 AND 10000
          AND applied_automatic_offer_fixed_discount_piasters IS NULL
          AND applied_automatic_offer_details IS NULL)
        OR
        (applied_automatic_offer_type = 'fixed'
          AND applied_automatic_offer_percentage_basis_points IS NULL
          AND applied_automatic_offer_fixed_discount_piasters > 0
          AND applied_automatic_offer_details IS NULL)
        OR
        (applied_automatic_offer_type IN ('fixed_bundle', 'buy_x_get_y')
          AND applied_automatic_offer_percentage_basis_points IS NULL
          AND applied_automatic_offer_fixed_discount_piasters IS NULL
          AND jsonb_typeof(applied_automatic_offer_details) = 'object')
      ))
  );
