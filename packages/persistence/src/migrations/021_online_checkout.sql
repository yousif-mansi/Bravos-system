CREATE TABLE delivery_area (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  fee_piasters BIGINT NOT NULL CHECK (fee_piasters >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  changed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT delivery_area_name_length CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX delivery_area_name_unique ON delivery_area (lower(btrim(name_ar)));
CREATE INDEX delivery_area_public_order ON delivery_area (active, name_ar, id);

CREATE TABLE online_checkout_quote (
  id UUID PRIMARY KEY,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_json JSONB NOT NULL,
  quote_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE SEQUENCE online_order_reference_number_seq;

CREATE TABLE online_order (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  quote_id UUID NOT NULL UNIQUE REFERENCES online_checkout_quote (id) ON DELETE RESTRICT,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status = 'pending'),
  customer_name TEXT NOT NULL,
  primary_phone TEXT NOT NULL,
  alternate_phone TEXT,
  detailed_address TEXT NOT NULL,
  landmark TEXT,
  notes TEXT,
  delivery_area_id UUID NOT NULL REFERENCES delivery_area (id) ON DELETE RESTRICT,
  requested_delivery_area_name_ar TEXT NOT NULL,
  requested_coupon_code TEXT,
  requested_merchandise_original_piasters BIGINT NOT NULL CHECK (requested_merchandise_original_piasters >= 0),
  requested_automatic_offer_discount_piasters BIGINT NOT NULL CHECK (requested_automatic_offer_discount_piasters >= 0),
  requested_coupon_discount_piasters BIGINT NOT NULL CHECK (requested_coupon_discount_piasters >= 0),
  requested_merchandise_total_piasters BIGINT NOT NULL CHECK (requested_merchandise_total_piasters >= 0),
  requested_delivery_fee_piasters BIGINT NOT NULL CHECK (requested_delivery_fee_piasters >= 0),
  requested_final_total_piasters BIGINT NOT NULL CHECK (requested_final_total_piasters >= 0),
  requested_applied_automatic_offer JSONB,
  requested_applied_coupon JSONB,
  submitted_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT online_order_customer_name_length CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 160),
  CONSTRAINT online_order_primary_phone_length CHECK (char_length(btrim(primary_phone)) BETWEEN 6 AND 32),
  CONSTRAINT online_order_alternate_phone_length CHECK (alternate_phone IS NULL OR char_length(alternate_phone) BETWEEN 6 AND 32),
  CONSTRAINT online_order_address_length CHECK (char_length(btrim(detailed_address)) BETWEEN 1 AND 500),
  CONSTRAINT online_order_totals CHECK (
    requested_merchandise_total_piasters = requested_merchandise_original_piasters
      - requested_automatic_offer_discount_piasters - requested_coupon_discount_piasters
    AND requested_final_total_piasters = requested_merchandise_total_piasters + requested_delivery_fee_piasters
  )
);

CREATE INDEX online_order_submitted_order ON online_order (submitted_at DESC, id DESC);

CREATE TABLE online_order_line (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE RESTRICT,
  product_name_ar TEXT NOT NULL,
  size_name_ar TEXT NOT NULL,
  color_name_ar TEXT NOT NULL,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  requested_listed_unit_price_piasters BIGINT NOT NULL CHECK (requested_listed_unit_price_piasters >= 0),
  requested_original_piasters BIGINT NOT NULL CHECK (requested_original_piasters >= 0),
  requested_automatic_offer_discount_piasters BIGINT NOT NULL CHECK (requested_automatic_offer_discount_piasters >= 0),
  requested_coupon_discount_piasters BIGINT NOT NULL CHECK (requested_coupon_discount_piasters >= 0),
  requested_merchandise_total_piasters BIGINT NOT NULL CHECK (requested_merchandise_total_piasters >= 0),
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  UNIQUE (order_id, variant_id),
  UNIQUE (order_id, line_index),
  CONSTRAINT online_order_line_totals CHECK (
    requested_original_piasters = requested_listed_unit_price_piasters * requested_quantity
    AND requested_merchandise_total_piasters = requested_original_piasters
      - requested_automatic_offer_discount_piasters - requested_coupon_discount_piasters
  )
);
