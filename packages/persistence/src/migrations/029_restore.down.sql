DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM restore_preview)
     OR EXISTS (SELECT 1 FROM sales_restore_deferred_completion)
     OR EXISTS (SELECT 1 FROM restore_runtime WHERE current_generation <> 0) THEN
    RAISE EXCEPTION 'Cannot remove restore history after a restore preview, activation or retained sale';
  END IF;
END $$;

DO $$
DECLARE
  guarded RECORD;
BEGIN
  FOR guarded IN
    SELECT event_object_table AS table_name, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = current_schema()
      AND trigger_name LIKE 'restore\_write\_guard\_%'
    GROUP BY event_object_table, trigger_name
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', guarded.trigger_name, guarded.table_name);
  END LOOP;
END;
$$;

DROP FUNCTION restore_business_write_guard();
DROP FUNCTION restore_enter_business_write();

ALTER TABLE expense_operation DROP CONSTRAINT expense_operation_expense_fk;
ALTER TABLE expense_operation
  ADD CONSTRAINT expense_operation_expense_fk
  FOREIGN KEY (expense_id) REFERENCES expense_record (id) ON DELETE RESTRICT;

DROP INDEX account_credential_user_unique;

ALTER TABLE inventory_known_till DROP COLUMN restore_generation;
ALTER TABLE sales_sale DROP COLUMN source_restore_generation;
ALTER TABLE sales_pos_snapshot DROP COLUMN restore_generation;

DROP TABLE sales_restore_deferred_completion;
DROP TABLE restore_activation;
DROP TABLE restore_preview_till;
DROP TABLE restore_runtime;
DROP TABLE restore_preview;
