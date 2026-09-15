DROP TABLE IF EXISTS expense_change;
ALTER TABLE IF EXISTS expense_operation DROP CONSTRAINT IF EXISTS expense_operation_expense_fk;
DROP TABLE IF EXISTS expense_record;
DROP TABLE IF EXISTS expense_operation;
DROP TABLE IF EXISTS expense_category;
