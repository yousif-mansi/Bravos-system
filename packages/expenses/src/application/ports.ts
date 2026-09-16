import type { ExpenseCategoryDto, ExpenseDto, ExpenseTotalsDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type ExpenseActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
};

export type ExpenseValueRecord = {
  amountPiasters: number;
  expenseDate: string;
  categoryId: string;
  categoryNameAr: string;
  description: string;
};

export type ExpenseChangeRecord = {
  id: string;
  operationId: string;
  type: "correction" | "cancellation";
  revision: number;
  reason: string;
  changedByStaffId: string;
  changedByDisplayName: string;
  changedAt: Date;
  previous: ExpenseValueRecord;
  effective: ExpenseValueRecord | null;
};

export type ExpenseRecord = {
  id: string;
  operationId: string;
  branch: { id: string; code: "abshway" | "fayoum"; nameAr: string };
  createdByStaffId: string;
  createdByDisplayName: string;
  recordedAt: Date;
  original: ExpenseValueRecord;
  effective: ExpenseValueRecord | null;
  revision: number;
  changes: ExpenseChangeRecord[];
};

export type ExpenseScope = { manager: true } | { manager: false; staffId: string; branchId: string };

export type ExpenseReportingFact = {
  expenseId: string;
  branchId: string;
  createdByStaffId: string;
  expenseDate: string;
  amountPiasters: number;
  categoryNameAr: string;
  description: string;
  effectiveStatus: "active" | "cancelled";
  correctionRevision: number;
  corrections: Array<{
    id: string;
    type: "correction" | "cancellation";
    revision: number;
    reason: string;
    changedByStaffId: string;
    changedAt: Date;
  }>;
};

export type ExpenseReportingReader = {
  countEffectiveFacts(input: {
    fromDate: string;
    toDateInclusive: string;
    branchId?: string | null;
    employeeId?: string | null;
  }): Promise<number>;
  listEffectiveFactsPage(input: {
    fromDate: string;
    toDateInclusive: string;
    branchId?: string | null;
    employeeId?: string | null;
    limit: number;
    after?: { expenseDate: string; id: string } | null;
  }): Promise<ExpenseReportingFact[]>;
};

export type ExpenseRepository = {
  listCategories(includeInactive: boolean): Promise<ExpenseCategoryDto[]>;
  createCategory(input: { id: string; nameAr: string; normalizedNameAr: string; actorStaffId: string; at: Date }): Promise<ExpenseCategoryDto | null>;
  updateCategory(input: { id: string; nameAr: string; normalizedNameAr: string; active: boolean; actorStaffId: string; at: Date }): Promise<
    { kind: "updated"; category: ExpenseCategoryDto } | { kind: "not-found" } | { kind: "conflict" }
  >;
  createExpense(input: {
    id: string;
    operationId: string;
    payloadFingerprint: string;
    branchId: string;
    createdByStaffId: string;
    value: Omit<ExpenseValueRecord, "categoryNameAr">;
    recordedAt: Date;
  }): Promise<{ kind: "created" | "replay"; record: ExpenseRecord } | { kind: "conflict" } | { kind: "category-unavailable" }>;
  changeExpense(input: {
    id: string;
    operationId: string;
    payloadFingerprint: string;
    expenseId: string;
    expectedRevision: number;
    type: "correction" | "cancellation";
    reason: string;
    actorStaffId: string;
    at: Date;
    effective: Omit<ExpenseValueRecord, "categoryNameAr"> | null;
  }): Promise<
    | { kind: "created"; record: ExpenseRecord }
    | { kind: "replay"; record: ExpenseRecord }
    | { kind: "conflict" }
    | { kind: "stale" }
    | { kind: "not-found" }
    | { kind: "category-unavailable" }
  >;
  list(scope: ExpenseScope): Promise<ExpenseRecord[]>;
  getById(id: string, scope: ExpenseScope): Promise<ExpenseRecord | null>;
  getByOperationId(operationId: string, scope: ExpenseScope): Promise<ExpenseRecord | null>;
  totals(scope: ExpenseScope): Promise<ExpenseTotalsDto>;
};

export type OpeningExpenseTransaction = {
  inspectOpeningCategories(rows: Array<{ nameAr: string; line: number }>): Promise<{ state: unknown; errors: Array<{ file: "configuration.csv"; line: number; column: string; code: string; messageAr: string }> }>;
  insertOpeningCategories(rows: Array<{ id: string; nameAr: string; active: boolean }>, actorStaffId: string, at: Date): Promise<void>;
};

export type CreateExpenseResult = { expense: ExpenseDto; created: boolean };
export type ChangeExpenseResult = { expense: ExpenseDto; created: boolean };
