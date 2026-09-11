CREATE TABLE catalog_category (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  parent_id UUID REFERENCES catalog_category (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_category_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX catalog_category_root_name
  ON catalog_category (lower(btrim(name_ar)))
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX catalog_category_sibling_name
  ON catalog_category (parent_id, lower(btrim(name_ar)))
  WHERE parent_id IS NOT NULL;

CREATE TABLE catalog_size (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_size_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX catalog_size_name ON catalog_size (lower(btrim(name_ar)));

CREATE TABLE catalog_color (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_color_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX catalog_color_name ON catalog_color (lower(btrim(name_ar)));

CREATE TABLE catalog_product (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  category_id UUID NOT NULL REFERENCES catalog_category (id),
  default_selling_price_piasters INTEGER NOT NULL
    CONSTRAINT catalog_product_price_nonnegative CHECK (default_selling_price_piasters >= 0),
  publication TEXT NOT NULL DEFAULT 'hidden'
    CONSTRAINT catalog_product_publication_known CHECK (publication IN ('available', 'coming_soon', 'hidden')),
  image_refs JSONB NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT catalog_product_image_refs_array CHECK (jsonb_typeof(image_refs) = 'array'),
  size_guide_ar TEXT,
  created_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE SET NULL,
  last_changed_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE SET NULL,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_code_len CHECK (char_length(btrim(code)) BETWEEN 1 AND 40),
  CONSTRAINT catalog_product_name_len CHECK (char_length(btrim(name_ar)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX catalog_product_code ON catalog_product (lower(btrim(code)));

CREATE TABLE catalog_product_variant (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES catalog_product (id) ON DELETE CASCADE,
  size_id UUID NOT NULL REFERENCES catalog_size (id),
  color_id UUID NOT NULL REFERENCES catalog_color (id),
  selling_price_piasters_override INTEGER
    CONSTRAINT catalog_variant_price_nonnegative CHECK (
      selling_price_piasters_override IS NULL OR selling_price_piasters_override >= 0
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_variant_unique UNIQUE (product_id, size_id, color_id)
);

CREATE INDEX catalog_product_variant_product ON catalog_product_variant (product_id);
