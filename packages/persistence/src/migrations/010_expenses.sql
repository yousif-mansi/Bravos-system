CREATE TABLE expense_category (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  normalized_name_ar TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  changed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE expense_operation (
  operation_id UUID PRIMARY KEY,
  payload_fingerprint TEXT NOT NULL,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  operation_type TEXT NOT NULL CONSTRAINT expense_operation_type CHECK (operation_type IN ('create', 'change')),
  expense_id UUID,
  result_revision INTEGER CONSTRAINT expense_operation_result_revision_nonnegative CHECK (result_revision >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT expense_operation_result_shape CHECK ((expense_id IS NULL) = (result_revision IS NULL))
);

CREATE TABLE expense_record (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES expense_operation (operation_id) ON DELETE RESTRICT,
  payload_fingerprint TEXT NOT NULL,
  branch_id UUID NOT NULL REFERENCES branch (id),
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  amount_piasters BIGINT NOT NULL CONSTRAINT expense_amount_positive CHECK (amount_piasters > 0),
  expense_date DATE NOT NULL,
  category_id UUID NOT NULL REFERENCES expense_category (id) ON DELETE RESTRICT,
  category_name_ar TEXT NOT NULL,
  description TEXT NOT NULL CONSTRAINT expense_description_present CHECK (length(btrim(description)) > 0),
  recorded_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX expense_record_scope
  ON expense_record (branch_id, created_by_staff_id, expense_date DESC, recorded_at DESC);

CREATE TABLE expense_change (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES expense_operation (operation_id) ON DELETE RESTRICT,
  payload_fingerprint TEXT NOT NULL,
  expense_id UUID NOT NULL REFERENCES expense_record (id) ON DELETE RESTRICT,
  change_type TEXT NOT NULL CONSTRAINT expense_change_type CHECK (change_type IN ('correction', 'cancellation')),
  result_revision INTEGER NOT NULL CONSTRAINT expense_change_revision_positive CHECK (result_revision > 0),
  reason TEXT NOT NULL CONSTRAINT expense_change_reason_present CHECK (length(btrim(reason)) > 0),
  changed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  changed_at TIMESTAMPTZ NOT NULL,
  previous_amount_piasters BIGINT NOT NULL CONSTRAINT expense_previous_amount_positive CHECK (previous_amount_piasters > 0),
  previous_expense_date DATE NOT NULL,
  previous_category_id UUID NOT NULL REFERENCES expense_category (id) ON DELETE RESTRICT,
  previous_category_name_ar TEXT NOT NULL,
  previous_description TEXT NOT NULL,
  effective_amount_piasters BIGINT CONSTRAINT expense_effective_amount_positive CHECK (effective_amount_piasters > 0),
  effective_expense_date DATE,
  effective_category_id UUID REFERENCES expense_category (id) ON DELETE RESTRICT,
  effective_category_name_ar TEXT,
  effective_description TEXT,
  CONSTRAINT expense_change_revision_unique UNIQUE (expense_id, result_revision),
  CONSTRAINT expense_change_effective_shape CHECK (
    (change_type = 'cancellation' AND effective_amount_piasters IS NULL AND effective_expense_date IS NULL
      AND effective_category_id IS NULL AND effective_category_name_ar IS NULL AND effective_description IS NULL)
    OR
    (change_type = 'correction' AND effective_amount_piasters IS NOT NULL AND effective_expense_date IS NOT NULL
      AND effective_category_id IS NOT NULL AND effective_category_name_ar IS NOT NULL AND effective_description IS NOT NULL)
  )
);

CREATE INDEX expense_change_history ON expense_change (expense_id, result_revision);

ALTER TABLE expense_operation
  ADD CONSTRAINT expense_operation_expense_fk
  FOREIGN KEY (expense_id) REFERENCES expense_record (id) ON DELETE RESTRICT;
