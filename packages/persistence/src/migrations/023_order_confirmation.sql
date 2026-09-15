ALTER TABLE online_order DROP CONSTRAINT online_order_status_check;
ALTER TABLE online_order
  ADD CONSTRAINT online_order_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled_unreachable'));

ALTER TABLE online_order
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN confirmed_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancellation_reason TEXT,
  ADD CONSTRAINT online_order_confirmation_shape CHECK (
    (status = 'confirmed' AND confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_by_staff_id IS NULL AND confirmed_at IS NULL)
  ),
  ADD CONSTRAINT online_order_cancellation_shape CHECK (
    (status = 'cancelled_unreachable' AND cancelled_by_staff_id IS NOT NULL
      AND cancelled_at IS NOT NULL AND char_length(btrim(cancellation_reason)) BETWEEN 1 AND 500)
    OR (status <> 'cancelled_unreachable' AND cancelled_by_staff_id IS NULL
      AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  );

CREATE TABLE online_order_agreement_quote (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  order_revision INTEGER NOT NULL CHECK (order_revision > 0),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  review_digest TEXT NOT NULL CHECK (review_digest ~ '^[0-9a-f]{64}$'),
  request_json JSONB NOT NULL,
  quote_json JSONB NOT NULL,
  pricing_snapshot_json JSONB NOT NULL,
  reviewed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  reviewed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX online_order_agreement_quote_order ON online_order_agreement_quote (order_id, reviewed_at DESC, id DESC);

CREATE TABLE online_order_operation (
  operation_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('contact_attempt', 'agreed_revision', 'confirmation', 'unreachable_cancellation')),
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  response_json JSONB NOT NULL,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  accepted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX online_order_operation_order ON online_order_operation (order_id, accepted_at, operation_id);

CREATE TABLE online_order_contact_attempt (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  actor_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('no_answer', 'reached')),
  note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT online_order_contact_note_length CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500)
);

CREATE INDEX online_order_contact_attempt_order ON online_order_contact_attempt (order_id, occurred_at, id);

CREATE TABLE online_order_agreed_revision (
  order_id UUID NOT NULL REFERENCES online_order (id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 1),
  operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL UNIQUE REFERENCES online_order_agreement_quote (id) ON DELETE RESTRICT,
  review_digest TEXT NOT NULL CHECK (review_digest ~ '^[0-9a-f]{64}$'),
  agreed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  agreed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (order_id, version)
);

CREATE TABLE online_order_confirmation (
  order_id UUID PRIMARY KEY REFERENCES online_order (id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  agreed_revision INTEGER NOT NULL,
  quote_id UUID NOT NULL REFERENCES online_order_agreement_quote (id) ON DELETE RESTRICT,
  review_digest TEXT NOT NULL CHECK (review_digest ~ '^[0-9a-f]{64}$'),
  confirmed_quote_json JSONB NOT NULL,
  pricing_snapshot_json JSONB NOT NULL,
  confirmed_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  confirmed_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (order_id, agreed_revision) REFERENCES online_order_agreed_revision (order_id, version) ON DELETE RESTRICT
);

CREATE TABLE online_order_unreachable_cancellation (
  order_id UUID PRIMARY KEY REFERENCES online_order (id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL UNIQUE REFERENCES online_order_operation (operation_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  cancelled_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  cancelled_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE online_order_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  unreachable_wait_hours INTEGER NOT NULL DEFAULT 48 CHECK (unreachable_wait_hours >= 1),
  minimum_contact_attempts INTEGER NOT NULL DEFAULT 2 CHECK (minimum_contact_attempts >= 2),
  changed_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  changed_at TIMESTAMPTZ
);

INSERT INTO online_order_settings (singleton) VALUES (TRUE);
