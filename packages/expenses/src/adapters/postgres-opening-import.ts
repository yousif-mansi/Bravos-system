import type { PoolClient } from "pg";
import { normalizeExpenseCategoryName } from "../application/expenses.ts";
import type { OpeningExpenseTransaction } from "../application/ports.ts";

export function createPostgresOpeningExpenseTransaction(client: PoolClient): OpeningExpenseTransaction {
  return {
    async inspectOpeningCategories(rows) {
      const existing = await client.query<{ id: string; normalized_name_ar: string; active: boolean }>("SELECT id,normalized_name_ar,active FROM expense_category ORDER BY id");
      const names = new Set(existing.rows.map((row) => row.normalized_name_ar));
      return {
        state: existing.rows,
        errors: rows.filter((row) => names.has(normalizeExpenseCategoryName(row.nameAr))).map((row) => ({ file: "configuration.csv" as const, line: row.line, column: "name_ar", code: "COLLISION", messageAr: "تصنيف المصروف موجود بالفعل." })),
      };
    },
    async insertOpeningCategories(rows, actorStaffId, at) {
      for (const row of rows) {
        await client.query(
          `INSERT INTO expense_category
             (id,name_ar,normalized_name_ar,active,changed_by_staff_id,changed_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [row.id, row.nameAr, normalizeExpenseCategoryName(row.nameAr), row.active, actorStaffId, at],
        );
      }
    },
  };
}
