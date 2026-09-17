CREATE TABLE restore_preview (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('staged', 'paused', 'ready', 'activated', 'cancelled')),
  backup_id UUID NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  archive_schema_version TEXT NOT NULL,
  source_generation BIGINT CHECK (source_generation >= 0),
  expected_generation BIGINT NOT NULL CHECK (expected_generation >= 0),
  staging_database_name TEXT NOT NULL UNIQUE CHECK (staging_database_name ~ '^bravos_restore_stage_[0-9a-f]{32}$'),
  manifest_json JSONB NOT NULL,
  differences_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocking_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_fingerprint TEXT CHECK (preview_fingerprint ~ '^[0-9a-f]{64}$'),
  pre_restore_archive BYTEA,
  pre_restore_archive_sha256 TEXT CHECK (pre_restore_archive_sha256 ~ '^[0-9a-f]{64}$'),
  pre_restore_backup_id UUID,
  pre_restore_download_acknowledged_by_staff_id TEXT,
  pre_restore_download_acknowledged_at TIMESTAMPTZ,
  created_by_staff_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  paused_at TIMESTAMPTZ,
  cancelled_by_staff_id TEXT,
  cancelled_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  CHECK ((pre_restore_archive IS NULL) = (pre_restore_archive_sha256 IS NULL)),
  CHECK ((pre_restore_archive IS NULL) = (pre_restore_backup_id IS NULL)),
  CHECK ((pre_restore_download_acknowledged_by_staff_id IS NULL) = (pre_restore_download_acknowledged_at IS NULL))
);

CREATE TABLE restore_runtime (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  current_generation BIGINT NOT NULL DEFAULT 0 CHECK (current_generation >= 0),
  paused_preview_id UUID REFERENCES restore_preview (id) ON DELETE RESTRICT,
  paused_at TIMESTAMPTZ,
  paused_by_staff_id TEXT,
  CHECK ((paused_preview_id IS NULL) = (paused_at IS NULL)),
  CHECK ((paused_preview_id IS NULL) = (paused_by_staff_id IS NULL))
);

INSERT INTO restore_runtime (singleton, current_generation) VALUES (TRUE, 0);

CREATE TABLE restore_preview_till (
  preview_id UUID NOT NULL REFERENCES restore_preview (id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  staff_id TEXT NOT NULL,
  known_snapshot_id UUID NOT NULL,
  known_snapshot_at TIMESTAMPTZ NOT NULL,
  known_stock_version BIGINT CHECK (known_stock_version >= 0),
  known_restore_generation BIGINT NOT NULL CHECK (known_restore_generation >= 0),
  pending_operation_ids UUID[] NOT NULL DEFAULT '{}',
  custodied_operation_ids UUID[] NOT NULL DEFAULT '{}',
  synchronization_complete BOOLEAN NOT NULL,
  acknowledged_snapshot_id UUID,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_stock_version BIGINT CHECK (acknowledged_stock_version >= 0),
  CHECK (
    (acknowledged_snapshot_id IS NULL AND acknowledged_at IS NULL AND acknowledged_stock_version IS NULL)
    OR
    (acknowledged_snapshot_id IS NOT NULL AND acknowledged_at IS NOT NULL)
  ),
  PRIMARY KEY (preview_id, device_id)
);

CREATE TABLE restore_activation (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  preview_id UUID NOT NULL UNIQUE REFERENCES restore_preview (id) ON DELETE RESTRICT,
  previous_generation BIGINT NOT NULL CHECK (previous_generation >= 0),
  activated_generation BIGINT NOT NULL CHECK (activated_generation > previous_generation),
  pre_restore_backup_id UUID NOT NULL,
  pre_restore_archive_sha256 TEXT NOT NULL CHECK (pre_restore_archive_sha256 ~ '^[0-9a-f]{64}$'),
  activated_by_staff_id TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL
);

-- Completed paid sales that reached the server during a restore pause, or from an older
-- restore generation. Sales owns these rows; a manager recovers each one exactly once.
CREATE TABLE sales_restore_deferred_completion (
  operation_id UUID PRIMARY KEY,
  sale_id UUID NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  source_generation BIGINT NOT NULL CHECK (source_generation >= 0),
  source_device_id UUID,
  original_staff_id TEXT NOT NULL,
  branch_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled')),
  retained_at TIMESTAMPTZ NOT NULL,
  reconciled_by_staff_id TEXT,
  reconciled_at TIMESTAMPTZ,
  CHECK (
    (status = 'pending' AND reconciled_by_staff_id IS NULL AND reconciled_at IS NULL)
    OR (status = 'reconciled' AND reconciled_by_staff_id IS NOT NULL AND reconciled_at IS NOT NULL)
  )
);

ALTER TABLE sales_pos_snapshot
  ADD COLUMN restore_generation BIGINT NOT NULL DEFAULT 0 CHECK (restore_generation >= 0);

ALTER TABLE sales_sale
  ADD COLUMN source_restore_generation BIGINT NOT NULL DEFAULT 0 CHECK (source_restore_generation >= 0);

ALTER TABLE inventory_known_till
  ADD COLUMN restore_generation BIGINT NOT NULL DEFAULT 0 CHECK (restore_generation >= 0);

-- Credential reprovisioning after a restore inserts the credential row when it is missing.
CREATE UNIQUE INDEX account_credential_user_unique
  ON account ("userId", "providerId")
  WHERE "providerId" = 'credential';

-- The expense operation/result pair is intentionally cyclic. Restore clears and loads both rows
-- inside one transaction and checks the relationship at commit. RESTRICT is always checked
-- immediately, so the deferrable link uses NO ACTION; outside restore it is still checked at once.
ALTER TABLE expense_operation DROP CONSTRAINT expense_operation_expense_fk;
ALTER TABLE expense_operation
  ADD CONSTRAINT expense_operation_expense_fk
  FOREIGN KEY (expense_id) REFERENCES expense_record (id) ON DELETE NO ACTION
  DEFERRABLE INITIALLY IMMEDIATE;

-- Whole-business write barrier. Business transactions take the shared lock before their first
-- write and fail while a restore pause is active. Entering the pause and activation take the
-- exclusive lock, so they wait for writers that started earlier.
CREATE FUNCTION restore_enter_business_write()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  active_preview UUID;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(1112687187, 27);
  SELECT paused_preview_id INTO active_preview
  FROM restore_runtime
  WHERE singleton = TRUE;
  IF active_preview IS NOT NULL
     AND current_setting('bravos.restore_activation', TRUE) IS DISTINCT FROM active_preview::text THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BRAVOS_RESTORE_PAUSED',
      DETAIL = active_preview::text;
  END IF;
END;
$$;

CREATE FUNCTION restore_business_write_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM restore_enter_business_write();
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  guarded RECORD;
BEGIN
  FOR guarded IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename <> 'schema_migrations'
      AND tablename NOT LIKE 'restore\_%'
      AND tablename <> 'sales_restore_deferred_completion'
      AND tablename NOT IN (
        'session', 'account', 'verification', 'owner_recovery_challenge', 'staff_session_branch',
        'sales_pos_snapshot', 'sales_pos_snapshot_price', 'inventory_known_till',
        'inventory_count_coordination_device'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION restore_business_write_guard()',
      'restore_write_guard_' || guarded.tablename,
      guarded.tablename
    );
  END LOOP;
END;
$$;
