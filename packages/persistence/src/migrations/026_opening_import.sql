CREATE TABLE opening_import_preview (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  preview_fingerprint TEXT NOT NULL CHECK (preview_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('invalid', 'ready', 'accepted')),
  plan_json JSONB NOT NULL,
  state_json JSONB NOT NULL,
  response_json JSONB NOT NULL,
  created_by_staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id),
  created_at TIMESTAMPTZ NOT NULL,
  accepted_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  accepted_at TIMESTAMPTZ,
  CONSTRAINT opening_import_acceptance_complete CHECK (
    (status <> 'accepted' AND accepted_by_staff_id IS NULL AND accepted_at IS NULL)
    OR (status = 'accepted' AND accepted_by_staff_id IS NOT NULL AND accepted_at IS NOT NULL)
  )
);

CREATE INDEX opening_import_preview_created ON opening_import_preview (created_at DESC, id DESC);
