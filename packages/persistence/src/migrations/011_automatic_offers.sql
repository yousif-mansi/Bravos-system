CREATE TABLE pricing_automatic_offer (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  discount_type TEXT NOT NULL
    CONSTRAINT pricing_offer_type_known CHECK (discount_type IN ('percentage', 'fixed')),
  percentage_basis_points INTEGER,
  fixed_discount_piasters BIGINT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  allow_coupon BOOLEAN NOT NULL DEFAULT true,
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  updated_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT pricing_offer_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 120),
  CONSTRAINT pricing_offer_dates_ordered CHECK (ends_on >= starts_on),
  CONSTRAINT pricing_offer_value_matches_type CHECK (
    (discount_type = 'percentage' AND percentage_basis_points BETWEEN 1 AND 10000 AND fixed_discount_piasters IS NULL)
    OR
    (discount_type = 'fixed' AND percentage_basis_points IS NULL AND fixed_discount_piasters > 0)
  )
);

CREATE INDEX pricing_offer_active_dates
  ON pricing_automatic_offer (active, starts_on, ends_on);

CREATE TABLE pricing_automatic_offer_product (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, product_id)
);

CREATE TABLE pricing_automatic_offer_category (
  offer_id UUID NOT NULL REFERENCES pricing_automatic_offer (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES catalog_category (id) ON DELETE RESTRICT,
  PRIMARY KEY (offer_id, category_id)
);

ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_totals;
ALTER TABLE sales_sale
  ADD COLUMN automatic_offer_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN applied_automatic_offer_id UUID,
  ADD COLUMN applied_automatic_offer_name_ar TEXT,
  ADD COLUMN applied_automatic_offer_type TEXT,
  ADD COLUMN applied_automatic_offer_percentage_basis_points INTEGER,
  ADD COLUMN applied_automatic_offer_fixed_discount_piasters BIGINT,
  ADD COLUMN applied_automatic_offer_allow_coupon BOOLEAN,
  ADD CONSTRAINT sales_sale_automatic_discount_nonnegative CHECK (automatic_offer_discount_piasters >= 0),
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
  ),
  ADD CONSTRAINT sales_sale_totals CHECK (
    final_total_piasters = original_total_piasters - automatic_offer_discount_piasters - employee_discount_piasters
  );

ALTER TABLE sales_sale_line
  ADD COLUMN automatic_offer_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN employee_discount_piasters BIGINT NOT NULL DEFAULT 0;

UPDATE sales_sale_line SET employee_discount_piasters = discount_piasters;

ALTER TABLE sales_sale_line
  ADD CONSTRAINT sales_sale_line_effects_total CHECK (
    discount_piasters = automatic_offer_discount_piasters + employee_discount_piasters
  );

ALTER TABLE sales_sale_unit
  ADD COLUMN automatic_offer_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN employee_discount_piasters BIGINT NOT NULL DEFAULT 0;

UPDATE sales_sale_unit SET employee_discount_piasters = discount_piasters;

ALTER TABLE sales_sale_unit
  ADD CONSTRAINT sales_sale_unit_effects_total CHECK (
    discount_piasters = automatic_offer_discount_piasters + employee_discount_piasters
  );
