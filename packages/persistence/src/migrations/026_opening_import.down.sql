DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM opening_import_preview WHERE status = 'accepted') THEN
    RAISE EXCEPTION 'Cannot remove opening import history after an accepted import';
  END IF;
END $$;

DROP TABLE opening_import_preview;
