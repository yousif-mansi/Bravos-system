ALTER TABLE catalog_product_variant
  ADD COLUMN online_visible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE catalog_product
  ADD COLUMN edit_revision INTEGER NOT NULL DEFAULT 1
  CONSTRAINT catalog_product_edit_revision_positive CHECK (edit_revision >= 1);
