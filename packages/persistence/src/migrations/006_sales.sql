CREATE TABLE sales_sale (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES branch (id),
  sold_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  sold_by_display_name TEXT NOT NULL,
  discounted_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_phone TEXT,
  original_total_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_original_nonnegative CHECK (original_total_piasters >= 0),
  employee_discount_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_discount_nonnegative CHECK (employee_discount_piasters >= 0),
  discount_reason TEXT,
  final_total_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_final_nonnegative CHECK (final_total_piasters >= 0),
  payload_fingerprint TEXT NOT NULL,
  physically_completed BOOLEAN NOT NULL DEFAULT false,
  costs_incomplete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_sale_totals CHECK (
    final_total_piasters = original_total_piasters - employee_discount_piasters
  )
);

CREATE INDEX sales_sale_recorded ON sales_sale (recorded_at DESC NULLS LAST, id DESC);
CREATE INDEX sales_sale_staff ON sales_sale (sold_by_staff_id, recorded_at DESC NULLS LAST);
CREATE INDEX sales_sale_branch ON sales_sale (branch_id, recorded_at DESC NULLS LAST);

CREATE TABLE sales_sale_line (
  id UUID PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales_sale (id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL,
  quantity INTEGER NOT NULL
    CONSTRAINT sales_sale_line_quantity_positive CHECK (quantity > 0),
  listed_unit_price_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_line_listed_nonnegative CHECK (listed_unit_price_piasters >= 0),
  original_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_line_original_nonnegative CHECK (original_piasters >= 0),
  discount_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_line_discount_nonnegative CHECK (discount_piasters >= 0),
  paid_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_line_paid_nonnegative CHECK (paid_piasters >= 0),
  allocated_quantity INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sales_sale_line_allocated_nonnegative CHECK (allocated_quantity >= 0),
  unallocated_quantity INTEGER NOT NULL DEFAULT 0
    CONSTRAINT sales_sale_line_unallocated_nonnegative CHECK (unallocated_quantity >= 0),
  line_index INTEGER NOT NULL,
  CONSTRAINT sales_sale_line_variant_fk
    FOREIGN KEY (variant_id) REFERENCES catalog_product_variant (id) ON DELETE RESTRICT,
  CONSTRAINT sales_sale_line_unique UNIQUE (sale_id, line_index),
  CONSTRAINT sales_sale_line_qty_parts CHECK (
    allocated_quantity + unallocated_quantity <= quantity
  )
);

CREATE INDEX sales_sale_line_sale ON sales_sale_line (sale_id);

CREATE TABLE sales_sale_unit (
  id UUID PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales_sale (id) ON DELETE RESTRICT,
  line_id UUID NOT NULL REFERENCES sales_sale_line (id) ON DELETE RESTRICT,
  unit_index INTEGER NOT NULL,
  listed_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_unit_listed_nonnegative CHECK (listed_piasters >= 0),
  discount_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_unit_discount_nonnegative CHECK (discount_piasters >= 0),
  paid_piasters INTEGER NOT NULL
    CONSTRAINT sales_sale_unit_paid_nonnegative CHECK (paid_piasters >= 0),
  CONSTRAINT sales_sale_unit_unique UNIQUE (line_id, unit_index),
  CONSTRAINT sales_sale_unit_paid CHECK (paid_piasters = listed_piasters - discount_piasters)
);

CREATE INDEX sales_sale_unit_sale ON sales_sale_unit (sale_id);
