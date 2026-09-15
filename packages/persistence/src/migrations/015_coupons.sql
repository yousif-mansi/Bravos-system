CREATE TABLE pricing_coupon (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  normalized_code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  percentage_basis_points INTEGER,
  fixed_discount_piasters BIGINT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  allow_automatic_offer BOOLEAN NOT NULL DEFAULT true,
  usage_limit INTEGER NOT NULL CHECK (usage_limit > 0),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  updated_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT pricing_coupon_code_len CHECK (char_length(btrim(code)) BETWEEN 1 AND 64),
  CONSTRAINT pricing_coupon_dates_ordered CHECK (ends_on >= starts_on),
  CONSTRAINT pricing_coupon_value_matches_type CHECK (
    (discount_type = 'percentage' AND percentage_basis_points BETWEEN 1 AND 10000 AND fixed_discount_piasters IS NULL)
    OR
    (discount_type = 'fixed' AND percentage_basis_points IS NULL AND fixed_discount_piasters > 0)
  )
);

CREATE INDEX pricing_coupon_active_dates ON pricing_coupon (active, starts_on, ends_on);

CREATE TABLE pricing_coupon_product (
  coupon_id UUID NOT NULL REFERENCES pricing_coupon (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  PRIMARY KEY (coupon_id, product_id)
);

CREATE TABLE pricing_coupon_category (
  coupon_id UUID NOT NULL REFERENCES pricing_coupon (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES catalog_category (id) ON DELETE RESTRICT,
  PRIMARY KEY (coupon_id, category_id)
);

CREATE TABLE pricing_coupon_usage (
  id UUID PRIMARY KEY,
  coupon_id UUID NOT NULL REFERENCES pricing_coupon (id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('physical_sale', 'online_order')),
  source_id UUID NOT NULL,
  operation_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  claimed_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  UNIQUE (source_type, source_id)
);

CREATE INDEX pricing_coupon_usage_active ON pricing_coupon_usage (coupon_id) WHERE released_at IS NULL;

ALTER TABLE sales_sale DROP CONSTRAINT sales_sale_totals;
ALTER TABLE sales_sale
  ADD COLUMN coupon_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN applied_coupon_id UUID,
  ADD COLUMN applied_coupon_code TEXT,
  ADD COLUMN applied_coupon_type TEXT,
  ADD COLUMN applied_coupon_percentage_basis_points INTEGER,
  ADD COLUMN applied_coupon_fixed_discount_piasters BIGINT,
  ADD COLUMN applied_coupon_allow_automatic_offer BOOLEAN,
  ADD CONSTRAINT sales_sale_coupon_discount_nonnegative CHECK (coupon_discount_piasters >= 0),
  ADD CONSTRAINT sales_sale_applied_coupon_complete CHECK (
    (applied_coupon_id IS NULL
      AND applied_coupon_code IS NULL
      AND applied_coupon_type IS NULL
      AND applied_coupon_percentage_basis_points IS NULL
      AND applied_coupon_fixed_discount_piasters IS NULL
      AND applied_coupon_allow_automatic_offer IS NULL
      AND coupon_discount_piasters = 0)
    OR
    (applied_coupon_id IS NOT NULL
      AND applied_coupon_code IS NOT NULL
      AND applied_coupon_allow_automatic_offer IS NOT NULL
      AND coupon_discount_piasters > 0
      AND (
        (applied_coupon_type = 'percentage'
          AND applied_coupon_percentage_basis_points BETWEEN 1 AND 10000
          AND applied_coupon_fixed_discount_piasters IS NULL)
        OR
        (applied_coupon_type = 'fixed'
          AND applied_coupon_percentage_basis_points IS NULL
          AND applied_coupon_fixed_discount_piasters > 0)
      ))
  ),
  ADD CONSTRAINT sales_sale_totals CHECK (
    final_total_piasters = original_total_piasters - automatic_offer_discount_piasters
      - coupon_discount_piasters - employee_discount_piasters
  );

ALTER TABLE sales_sale_line DROP CONSTRAINT sales_sale_line_effects_total;
ALTER TABLE sales_sale_line
  ADD COLUMN coupon_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT sales_sale_line_effects_total CHECK (
    discount_piasters = automatic_offer_discount_piasters + coupon_discount_piasters + employee_discount_piasters
  );

ALTER TABLE sales_sale_unit DROP CONSTRAINT sales_sale_unit_effects_total;
ALTER TABLE sales_sale_unit
  ADD COLUMN coupon_discount_piasters BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT sales_sale_unit_effects_total CHECK (
    discount_piasters = automatic_offer_discount_piasters + coupon_discount_piasters + employee_discount_piasters
  );
