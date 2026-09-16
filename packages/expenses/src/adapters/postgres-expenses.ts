import type { ExpenseCategoryDto, ExpenseTotalsDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type {
  ExpenseChangeRecord,
  ExpenseRecord,
  ExpenseRepository,
  ExpenseScope,
  ExpenseValueRecord,
} from "../application/ports.ts";
import type { ExpenseReportingReader } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

export function createPostgresExpenseReportingReader(queryable: Queryable): ExpenseReportingReader {
  return {
    async countEffectiveFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count
         FROM expense_record e
         LEFT JOIN LATERAL (
           SELECT c.change_type,c.result_revision
           FROM expense_change c WHERE c.expense_id=e.id ORDER BY c.result_revision DESC LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT c.effective_expense_date FROM expense_change c
           WHERE c.expense_id=e.id AND c.change_type='correction'
           ORDER BY c.result_revision DESC LIMIT 1
         ) value ON true
         WHERE COALESCE(value.effective_expense_date,e.expense_date) >= $1::date
           AND COALESCE(value.effective_expense_date,e.expense_date) <= $2::date
           AND ($3::uuid IS NULL OR e.branch_id=$3)
           AND ($4::text IS NULL OR e.created_by_staff_id=$4)`,
        [input.fromDate, input.toDateInclusive, input.branchId ?? null, input.employeeId ?? null],
      );
      return safeNumber(result.rows[0]?.count ?? 0);
    },
    async listEffectiveFactsPage(input) {
      const result = await queryable.query<{
        expense_id: string;
        branch_id: string;
        created_by_staff_id: string;
        amount_piasters: number | string;
        expense_date: string;
        category_name_ar: string;
        description: string;
        effective_status: "active" | "cancelled";
        result_revision: number | null;
      }>(
        `SELECT e.id AS expense_id,e.branch_id,e.created_by_staff_id,
                CASE WHEN latest.change_type='cancellation' THEN 0
                     ELSE COALESCE(value.effective_amount_piasters,e.amount_piasters) END AS amount_piasters,
                COALESCE(value.effective_expense_date,e.expense_date)::text AS expense_date,
                COALESCE(value.effective_category_name_ar,e.category_name_ar) AS category_name_ar,
                COALESCE(value.effective_description,e.description) AS description,
                CASE WHEN latest.change_type='cancellation' THEN 'cancelled' ELSE 'active' END AS effective_status,
                latest.result_revision
         FROM expense_record e
         LEFT JOIN LATERAL (
           SELECT c.change_type,c.result_revision
           FROM expense_change c WHERE c.expense_id=e.id ORDER BY c.result_revision DESC LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT c.effective_amount_piasters,c.effective_expense_date,
                  c.effective_category_name_ar,c.effective_description
           FROM expense_change c WHERE c.expense_id=e.id AND c.change_type='correction'
           ORDER BY c.result_revision DESC LIMIT 1
         ) value ON true
         WHERE COALESCE(value.effective_expense_date,e.expense_date) >= $1::date
           AND COALESCE(value.effective_expense_date,e.expense_date) <= $2::date
           AND ($3::uuid IS NULL OR e.branch_id=$3)
           AND ($4::text IS NULL OR e.created_by_staff_id=$4)
           AND ($5::date IS NULL OR (COALESCE(value.effective_expense_date,e.expense_date),e.id) < ($5::date,$6::uuid))
         ORDER BY expense_date DESC,e.id DESC LIMIT $7`,
        [input.fromDate, input.toDateInclusive, input.branchId ?? null, input.employeeId ?? null,
          input.after?.expenseDate ?? null, input.after?.id ?? null, input.limit],
      );
      const ids = result.rows.map((row) => row.expense_id);
      const changes = ids.length === 0 ? { rows: [] as Array<{
        id: string; expense_id: string; change_type: "correction" | "cancellation";
        result_revision: number; reason: string; changed_by_staff_id: string; changed_at: Date;
      }> } : await queryable.query<{
        id: string; expense_id: string; change_type: "correction" | "cancellation";
        result_revision: number; reason: string; changed_by_staff_id: string; changed_at: Date;
      }>(
        `SELECT id,expense_id,change_type,result_revision,reason,changed_by_staff_id,changed_at
         FROM expense_change WHERE expense_id=ANY($1::uuid[]) ORDER BY expense_id,result_revision`,
        [ids],
      );
      const changesByExpense = new Map<string, typeof changes.rows>();
      for (const change of changes.rows) {
        const rows = changesByExpense.get(change.expense_id) ?? [];
        rows.push(change);
        changesByExpense.set(change.expense_id, rows);
      }
      return result.rows.map((row) => ({
        expenseId: row.expense_id,
        branchId: row.branch_id,
        createdByStaffId: row.created_by_staff_id,
        expenseDate: row.expense_date,
        amountPiasters: safeNumber(row.amount_piasters),
        categoryNameAr: row.category_name_ar,
        description: row.description,
        effectiveStatus: row.effective_status,
        correctionRevision: row.result_revision ?? 0,
        corrections: (changesByExpense.get(row.expense_id) ?? []).map((change) => ({
          id: change.id,
          type: change.change_type,
          revision: change.result_revision,
          reason: change.reason,
          changedByStaffId: change.changed_by_staff_id,
          changedAt: change.changed_at,
        })),
      }));
    },
  };
}

type BaseRow = {
  id: string;
  operation_id: string;
  branch_id: string;
  branch_code: "abshway" | "fayoum";
  branch_name_ar: string;
  created_by_staff_id: string;
  created_by_display_name: string;
  recorded_at: Date;
  original_amount_piasters: string;
  original_expense_date: string;
  original_category_id: string;
  original_category_name_ar: string;
  original_description: string;
  latest_change_id: string | null;
  revision: number;
  effective_amount_piasters: string | null;
  effective_expense_date: string | null;
  effective_category_id: string | null;
  effective_category_name_ar: string | null;
  effective_description: string | null;
};

type ChangeRow = {
  id: string;
  expense_id: string;
  operation_id: string;
  change_type: "correction" | "cancellation";
  result_revision: number;
  reason: string;
  changed_by_staff_id: string;
  changed_by_display_name: string;
  changed_at: Date;
  previous_amount_piasters: string;
  previous_expense_date: string;
  previous_category_id: string;
  previous_category_name_ar: string;
  previous_description: string;
  effective_amount_piasters: string | null;
  effective_expense_date: string | null;
  effective_category_id: string | null;
  effective_category_name_ar: string | null;
  effective_description: string | null;
};

export function createPostgresExpenseRepository(pool: Pool): ExpenseRepository {
  return {
    async listCategories(includeInactive) {
      const result = await pool.query<{
        id: string; name_ar: string; active: boolean; changed_by_staff_id: string; changed_at: Date;
      }>(
        `SELECT id, name_ar, active, changed_by_staff_id, changed_at
         FROM expense_category
         ${includeInactive ? "" : "WHERE active = true"}
         ORDER BY name_ar, id`,
      );
      return result.rows.map(categoryDto);
    },

    async createCategory(input) {
      const result = await pool.query<{
        id: string; name_ar: string; active: boolean; changed_by_staff_id: string; changed_at: Date;
      }>(
        `INSERT INTO expense_category (id, name_ar, normalized_name_ar, active, changed_by_staff_id, changed_at)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (normalized_name_ar) DO NOTHING
         RETURNING id, name_ar, active, changed_by_staff_id, changed_at`,
        [input.id, input.nameAr, input.normalizedNameAr, input.actorStaffId, input.at],
      );
      return result.rows[0] ? categoryDto(result.rows[0]) : null;
    },

    async updateCategory(input) {
      let result;
      try {
        result = await pool.query<{
          id: string; name_ar: string; active: boolean; changed_by_staff_id: string; changed_at: Date;
        }>(
          `UPDATE expense_category
           SET name_ar = $2, normalized_name_ar = $3, active = $4, changed_by_staff_id = $5, changed_at = $6
           WHERE id = $1 AND NOT EXISTS (
             SELECT 1 FROM expense_category other WHERE other.normalized_name_ar = $3 AND other.id <> $1
           )
           RETURNING id, name_ar, active, changed_by_staff_id, changed_at`,
          [input.id, input.nameAr, input.normalizedNameAr, input.active, input.actorStaffId, input.at],
        );
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "conflict" as const };
        throw error;
      }
      if (result.rows[0]) return { kind: "updated" as const, category: categoryDto(result.rows[0]) };
      const exists = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM expense_category WHERE id = $1) AS exists`, [input.id],
      );
      return exists.rows[0]?.exists ? { kind: "conflict" as const } : { kind: "not-found" as const };
    },

    async createExpense(input) {
      return transaction(pool, async (client) => {
        const claim = await claimOperation(client, {
          operationId: input.operationId,
          payloadFingerprint: input.payloadFingerprint,
          actorStaffId: input.createdByStaffId,
          operationType: "create",
          at: input.recordedAt,
        });
        if (claim.kind === "conflict") return claim;
        if (claim.kind === "replay") {
          if (!claim.expenseId || claim.resultRevision === null) return { kind: "conflict" as const };
          const record = await loadOne(client, claim.expenseId, { manager: true }, claim.resultRevision);
          return record ? { kind: "replay" as const, record } : { kind: "conflict" as const };
        }
        const category = await activeCategory(client, input.value.categoryId);
        if (!category) {
          await releaseOperation(client, input.operationId);
          return { kind: "category-unavailable" as const };
        }
        await client.query(
          `INSERT INTO expense_record (
             id, operation_id, payload_fingerprint, branch_id, created_by_staff_id,
             amount_piasters, expense_date, category_id, category_name_ar, description, recorded_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11)`,
          [input.id, input.operationId, input.payloadFingerprint, input.branchId, input.createdByStaffId,
            input.value.amountPiasters, input.value.expenseDate, input.value.categoryId, category.nameAr,
            input.value.description, input.recordedAt],
        );
        await client.query(
          `UPDATE expense_operation SET expense_id = $2, result_revision = 0 WHERE operation_id = $1`,
          [input.operationId, input.id],
        );
        const record = await loadOne(client, input.id, { manager: true });
        if (!record) throw new Error("Created expense could not be loaded.");
        return { kind: "created" as const, record };
      });
    },

    async changeExpense(input) {
      return transaction(pool, async (client) => {
        const claim = await claimOperation(client, {
          operationId: input.operationId,
          payloadFingerprint: input.payloadFingerprint,
          actorStaffId: input.actorStaffId,
          operationType: "change",
          at: input.at,
        });
        if (claim.kind === "conflict") return claim;
        if (claim.kind === "replay") {
          if (!claim.expenseId || claim.resultRevision === null) return { kind: "conflict" as const };
          const record = await loadOne(client, claim.expenseId, { manager: true }, claim.resultRevision);
          return record ? { kind: "replay" as const, record } : { kind: "conflict" as const };
        }
        const locked = await client.query<{ id: string }>(`SELECT id FROM expense_record WHERE id = $1 FOR UPDATE`, [input.expenseId]);
        if (!locked.rows[0]) {
          await releaseOperation(client, input.operationId);
          return { kind: "not-found" as const };
        }
        const record = await loadOne(client, input.expenseId, { manager: true });
        if (!record) {
          await releaseOperation(client, input.operationId);
          return { kind: "not-found" as const };
        }
        if (record.revision !== input.expectedRevision || !record.effective) {
          await releaseOperation(client, input.operationId);
          return { kind: "stale" as const };
        }
        let effective: ExpenseValueRecord | null = null;
        if (input.effective) {
          const category = await activeCategory(client, input.effective.categoryId);
          if (!category) {
            await releaseOperation(client, input.operationId);
            return { kind: "category-unavailable" as const };
          }
          effective = { ...input.effective, categoryNameAr: category.nameAr };
        }
        const revision = record.revision + 1;
        const previous = record.effective;
        await client.query(
          `INSERT INTO expense_change (
             id, operation_id, payload_fingerprint, expense_id, change_type, result_revision, reason,
             changed_by_staff_id, changed_at,
             previous_amount_piasters, previous_expense_date, previous_category_id, previous_category_name_ar, previous_description,
             effective_amount_piasters, effective_expense_date, effective_category_id, effective_category_name_ar, effective_description
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11::date, $12, $13, $14, $15, $16::date, $17, $18, $19)`,
          [input.id, input.operationId, input.payloadFingerprint, input.expenseId, input.type, revision,
            input.reason, input.actorStaffId, input.at,
            previous.amountPiasters, previous.expenseDate, previous.categoryId, previous.categoryNameAr, previous.description,
            effective?.amountPiasters ?? null, effective?.expenseDate ?? null, effective?.categoryId ?? null,
            effective?.categoryNameAr ?? null, effective?.description ?? null],
        );
        await client.query(
          `UPDATE expense_operation SET expense_id = $2, result_revision = $3 WHERE operation_id = $1`,
          [input.operationId, input.expenseId, revision],
        );
        const updated = await loadOne(client, input.expenseId, { manager: true });
        if (!updated) throw new Error("Changed expense could not be loaded.");
        return { kind: "created" as const, record: updated };
      });
    },

    list: (scope) => readTransaction(pool, (client) => loadMany(client, scope)),
    getById: (id, scope) => readTransaction(pool, (client) => loadOne(client, id, scope)),
    async getByOperationId(operationId, scope) {
      return readTransaction(pool, async (client) => {
        const result = await client.query<{ expense_id: string | null; result_revision: number | null }>(
          `SELECT expense_id, result_revision FROM expense_operation WHERE operation_id = $1`, [operationId],
        );
        const receipt = result.rows[0];
        return receipt?.expense_id && receipt.result_revision !== null
          ? loadOne(client, receipt.expense_id, scope, receipt.result_revision)
          : null;
      });
    },
    totals: (scope) => loadTotals(pool, scope),
  };
}

async function releaseOperation(client: PoolClient, operationId: string): Promise<void> {
  await client.query(`DELETE FROM expense_operation WHERE operation_id = $1 AND expense_id IS NULL`, [operationId]);
}

async function claimOperation(client: PoolClient, input: {
  operationId: string; payloadFingerprint: string; actorStaffId: string; operationType: "create" | "change"; at: Date;
}): Promise<
  | { kind: "created" }
  | { kind: "replay"; expenseId: string | null; resultRevision: number | null }
  | { kind: "conflict" }
> {
  const inserted = await client.query<{ operation_id: string }>(
    `INSERT INTO expense_operation (operation_id, payload_fingerprint, actor_staff_id, operation_type, recorded_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (operation_id) DO NOTHING
     RETURNING operation_id`,
    [input.operationId, input.payloadFingerprint, input.actorStaffId, input.operationType, input.at],
  );
  if (inserted.rows[0]) return { kind: "created" };
  const existing = await client.query<{
    payload_fingerprint: string; actor_staff_id: string; operation_type: string;
    expense_id: string | null; result_revision: number | null;
  }>(
    `SELECT payload_fingerprint, actor_staff_id, operation_type, expense_id, result_revision
     FROM expense_operation WHERE operation_id = $1 FOR UPDATE`,
    [input.operationId],
  );
  const row = existing.rows[0];
  if (!row || row.payload_fingerprint !== input.payloadFingerprint || row.actor_staff_id !== input.actorStaffId
    || row.operation_type !== input.operationType) return { kind: "conflict" };
  return { kind: "replay", expenseId: row.expense_id, resultRevision: row.result_revision };
}

async function activeCategory(queryable: Queryable, id: string): Promise<{ id: string; nameAr: string } | null> {
  const result = await queryable.query<{ id: string; name_ar: string }>(
    `SELECT id, name_ar FROM expense_category WHERE id = $1 AND active = true FOR SHARE`, [id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, nameAr: row.name_ar } : null;
}

async function loadMany(queryable: Queryable, scope: ExpenseScope): Promise<ExpenseRecord[]> {
  const { sql, args } = scopeClause(scope, 1);
  const result = await queryable.query<BaseRow>(`${baseSelect()} ${sql} ORDER BY e.recorded_at DESC, e.id DESC`, args);
  return hydrateRows(queryable, result.rows);
}

async function loadOne(
  queryable: Queryable,
  id: string,
  scope: ExpenseScope,
  resultRevision?: number,
): Promise<ExpenseRecord | null> {
  const queryArgs: unknown[] = [id];
  const revisionParameter = resultRevision === undefined ? undefined : queryArgs.push(resultRevision);
  const { sql: scopeSql, args } = scopeClause(scope, queryArgs.length + 1);
  queryArgs.push(...args);
  const result = await queryable.query<BaseRow>(
    `${baseSelect(revisionParameter)} WHERE e.id = $1 ${scopeSql.replace(/^WHERE/, "AND")}`,
    queryArgs,
  );
  return (await hydrateRows(queryable, result.rows, resultRevision))[0] ?? null;
}

function baseSelect(resultRevisionParameter?: number): string {
  const revisionClause = resultRevisionParameter === undefined
    ? ""
    : `AND c.result_revision <= $${resultRevisionParameter}`;
  return `SELECT e.id, e.operation_id, e.branch_id, b.code AS branch_code, b.name_ar AS branch_name_ar,
    e.created_by_staff_id, creator.display_name_ar AS created_by_display_name, e.recorded_at,
    e.amount_piasters::text AS original_amount_piasters, e.expense_date::text AS original_expense_date,
    e.category_id AS original_category_id, e.category_name_ar AS original_category_name_ar,
    e.description AS original_description, latest.id AS latest_change_id,
    COALESCE(latest.result_revision, 0)::int AS revision,
    CASE WHEN latest.id IS NULL THEN e.amount_piasters::text ELSE latest.effective_amount_piasters::text END AS effective_amount_piasters,
    CASE WHEN latest.id IS NULL THEN e.expense_date::text ELSE latest.effective_expense_date::text END AS effective_expense_date,
    CASE WHEN latest.id IS NULL THEN e.category_id ELSE latest.effective_category_id END AS effective_category_id,
    CASE WHEN latest.id IS NULL THEN e.category_name_ar ELSE latest.effective_category_name_ar END AS effective_category_name_ar,
    CASE WHEN latest.id IS NULL THEN e.description ELSE latest.effective_description END AS effective_description
    FROM expense_record e
    JOIN branch b ON b.id = e.branch_id
    JOIN staff_profile creator ON creator.staff_id = e.created_by_staff_id
    LEFT JOIN LATERAL (
      SELECT * FROM expense_change c WHERE c.expense_id = e.id ${revisionClause}
      ORDER BY c.result_revision DESC LIMIT 1
    ) latest ON true`;
}

async function hydrateRows(
  queryable: Queryable,
  rows: BaseRow[],
  resultRevision?: number,
): Promise<ExpenseRecord[]> {
  if (rows.length === 0) return [];
  const revisionClause = resultRevision === undefined ? "" : "AND c.result_revision <= $2";
  const args = resultRevision === undefined ? [rows.map((row) => row.id)] : [rows.map((row) => row.id), resultRevision];
  const changes = await queryable.query<ChangeRow>(
    `SELECT c.id, c.expense_id, c.operation_id, c.change_type, c.result_revision, c.reason,
       c.changed_by_staff_id, actor.display_name_ar AS changed_by_display_name, c.changed_at,
       c.previous_amount_piasters::text, c.previous_expense_date::text, c.previous_category_id,
       c.previous_category_name_ar, c.previous_description,
       c.effective_amount_piasters::text, c.effective_expense_date::text, c.effective_category_id,
       c.effective_category_name_ar, c.effective_description
     FROM expense_change c JOIN staff_profile actor ON actor.staff_id = c.changed_by_staff_id
     WHERE c.expense_id = ANY($1::uuid[]) ${revisionClause}
     ORDER BY c.expense_id, c.result_revision`,
    args,
  );
  const byExpense = new Map<string, ExpenseChangeRecord[]>();
  for (const row of changes.rows) {
    const list = byExpense.get(row.expense_id) ?? [];
    list.push({
      id: row.id, operationId: row.operation_id, type: row.change_type, revision: row.result_revision,
      reason: row.reason, changedByStaffId: row.changed_by_staff_id,
      changedByDisplayName: row.changed_by_display_name, changedAt: row.changed_at,
      previous: rowValue(row, "previous"), effective: nullableRowValue(row, "effective"),
    });
    byExpense.set(row.expense_id, list);
  }
  return rows.map((row) => ({
    id: row.id, operationId: row.operation_id,
    branch: { id: row.branch_id, code: row.branch_code, nameAr: row.branch_name_ar },
    createdByStaffId: row.created_by_staff_id, createdByDisplayName: row.created_by_display_name,
    recordedAt: row.recorded_at, revision: row.revision,
    original: baseValue(row), effective: nullableBaseValue(row), changes: byExpense.get(row.id) ?? [],
  }));
}

async function loadTotals(queryable: Queryable, scope: ExpenseScope): Promise<ExpenseTotalsDto> {
  const { sql, args } = scopeClause(scope, 1);
  const result = await queryable.query<{
    branch_id: string; branch_code: "abshway" | "fayoum"; branch_name_ar: string; total_piasters: string; active_count: string;
  }>(
    `SELECT e.branch_id, b.code AS branch_code, b.name_ar AS branch_name_ar,
       COALESCE(sum(CASE WHEN latest.id IS NULL THEN e.amount_piasters ELSE latest.effective_amount_piasters END), 0)::text AS total_piasters,
       count(*) FILTER (WHERE latest.id IS NULL OR latest.change_type = 'correction')::text AS active_count
     FROM expense_record e JOIN branch b ON b.id = e.branch_id
     LEFT JOIN LATERAL (SELECT c.id, c.change_type, c.effective_amount_piasters FROM expense_change c
       WHERE c.expense_id = e.id ORDER BY c.result_revision DESC LIMIT 1) latest ON true
     ${sql}
     GROUP BY e.branch_id, b.code, b.name_ar ORDER BY b.code`, args,
  );
  const byBranch = result.rows.map((row) => ({
    branch: { id: row.branch_id, code: row.branch_code, nameAr: row.branch_name_ar },
    totalPiasters: safeNumber(row.total_piasters), activeExpenseCount: safeNumber(row.active_count),
  }));
  return {
    totalPiasters: safeSum(byBranch.map((item) => item.totalPiasters)),
    activeExpenseCount: safeSum(byBranch.map((item) => item.activeExpenseCount)),
    byBranch,
  };
}

function scopeClause(scope: ExpenseScope, firstParameter: number): { sql: string; args: unknown[] } {
  if (scope.manager) return { sql: "", args: [] };
  return {
    sql: `WHERE e.created_by_staff_id = $${firstParameter} AND e.branch_id = $${firstParameter + 1}`,
    args: [scope.staffId, scope.branchId],
  };
}

function baseValue(row: BaseRow): ExpenseValueRecord {
  return {
    amountPiasters: safeNumber(row.original_amount_piasters), expenseDate: row.original_expense_date,
    categoryId: row.original_category_id, categoryNameAr: row.original_category_name_ar,
    description: row.original_description,
  };
}

function nullableBaseValue(row: BaseRow): ExpenseValueRecord | null {
  if (row.effective_amount_piasters === null || row.effective_expense_date === null || row.effective_category_id === null
    || row.effective_category_name_ar === null || row.effective_description === null) return null;
  return {
    amountPiasters: safeNumber(row.effective_amount_piasters), expenseDate: row.effective_expense_date,
    categoryId: row.effective_category_id, categoryNameAr: row.effective_category_name_ar,
    description: row.effective_description,
  };
}

function rowValue(row: ChangeRow, prefix: "previous" | "effective"): ExpenseValueRecord {
  const value = nullableRowValue(row, prefix);
  if (!value) throw new Error("Expense change value is incomplete.");
  return value;
}

function nullableRowValue(row: ChangeRow, prefix: "previous" | "effective"): ExpenseValueRecord | null {
  const amount = prefix === "previous" ? row.previous_amount_piasters : row.effective_amount_piasters;
  const date = prefix === "previous" ? row.previous_expense_date : row.effective_expense_date;
  const categoryId = prefix === "previous" ? row.previous_category_id : row.effective_category_id;
  const categoryNameAr = prefix === "previous" ? row.previous_category_name_ar : row.effective_category_name_ar;
  const description = prefix === "previous" ? row.previous_description : row.effective_description;
  if (amount === null || date === null || categoryId === null || categoryNameAr === null || description === null) return null;
  return { amountPiasters: safeNumber(amount), expenseDate: date, categoryId, categoryNameAr, description };
}

function categoryDto(row: { id: string; name_ar: string; active: boolean; changed_by_staff_id: string; changed_at: Date }): ExpenseCategoryDto {
  return { id: row.id, nameAr: row.name_ar, active: row.active, changedByStaffId: row.changed_by_staff_id, changedAt: row.changed_at.toISOString() };
}

function safeNumber(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Expense piaster total exceeds the safe integer range.");
  return parsed;
}

function safeSum(values: number[]): number {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(result)) throw new Error("Expense total exceeds the safe integer range.");
  return result;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
