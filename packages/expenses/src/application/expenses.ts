import type { ExpenseCategoryDto, ExpenseDto } from "@bravos/contracts";
import {
  canUseBranch,
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
} from "@bravos/identity";
import { fingerprintExpensePayload } from "../domain/fingerprint.ts";
import {
  ExpenseOperationConflictError,
  ExpenseRevisionConflictError,
  ExpensesValidationError,
} from "../domain/errors.ts";
import type {
  ChangeExpenseResult,
  CreateExpenseResult,
  ExpenseActorPort,
  ExpenseRecord,
  ExpenseRepository,
  ExpenseScope,
  VerifiedAuth,
} from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CREATE_KEYS = new Set(["operationId", "amountPiasters", "expenseDate", "categoryId", "description"]);
const CHANGE_KEYS = new Set([
  "operationId", "expectedRevision", "type", "reason", "amountPiasters", "expenseDate", "categoryId", "description",
]);
const CATEGORY_CREATE_KEYS = new Set(["nameAr"]);
const CATEGORY_UPDATE_KEYS = new Set(["nameAr", "active"]);

export type ExpenseServices = ReturnType<typeof createExpenseServices>;

export function createExpenseServices(ports: { actors: ExpenseActorPort; expenses: ExpenseRepository }) {
  async function requireActor(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    return { auth, staff };
  }

  async function requireManager(auth: VerifiedAuth | null) {
    const context = await requireActor(auth);
    if (!isManager(context.staff)) throw new ForbiddenError();
    return context;
  }

  async function activeBranchContext(auth: VerifiedAuth | null) {
    const context = await requireActor(auth);
    const branchId = await ports.actors.getSessionBranch(context.auth.sessionId);
    if (!branchId || !canUseBranch(context.staff, branchId)) {
      throw new ExpensesValidationError("يجب اختيار فرع نشط ومصرح به.");
    }
    return { ...context, branchId };
  }

  async function readScope(auth: VerifiedAuth | null): Promise<ExpenseScope> {
    const context = await requireActor(auth);
    if (isManager(context.staff)) return { manager: true };
    const branchId = await ports.actors.getSessionBranch(context.auth.sessionId);
    if (!branchId || !canUseBranch(context.staff, branchId)) {
      throw new ExpensesValidationError("يجب اختيار فرع نشط ومصرح به.");
    }
    return { manager: false, staffId: context.staff.id, branchId };
  }

  return {
    async listCategories(auth: VerifiedAuth | null): Promise<ExpenseCategoryDto[]> {
      const { staff } = await requireActor(auth);
      return ports.expenses.listCategories(isManager(staff));
    },

    async createCategory(auth: VerifiedAuth | null, input: unknown): Promise<ExpenseCategoryDto> {
      const { staff } = await requireManager(auth);
      const body = expectObject(input, "بيانات فئة المصروف غير صالحة.");
      assertAllowedKeys(body, CATEGORY_CREATE_KEYS, "بيانات فئة المصروف غير صالحة.");
      const nameAr = requiredText(body.nameAr, "اسم فئة المصروف مطلوب.");
      const created = await ports.expenses.createCategory({
        id: crypto.randomUUID(),
        nameAr,
        normalizedNameAr: normalizeExpenseCategoryName(nameAr),
        actorStaffId: staff.id,
        at: new Date(),
      });
      if (!created) throw new ExpensesValidationError("اسم فئة المصروف مستخدم بالفعل.");
      return created;
    },

    async updateCategory(auth: VerifiedAuth | null, id: string, input: unknown): Promise<ExpenseCategoryDto> {
      const { staff } = await requireManager(auth);
      const categoryId = assertUuid(id, "فئة المصروف غير موجودة.");
      const body = expectObject(input, "بيانات فئة المصروف غير صالحة.");
      assertAllowedKeys(body, CATEGORY_UPDATE_KEYS, "بيانات فئة المصروف غير صالحة.");
      const nameAr = requiredText(body.nameAr, "اسم فئة المصروف مطلوب.");
      if (typeof body.active !== "boolean") throw new ExpensesValidationError("حالة فئة المصروف غير صالحة.");
      const outcome = await ports.expenses.updateCategory({
        id: categoryId,
        nameAr,
        normalizedNameAr: normalizeExpenseCategoryName(nameAr),
        active: body.active,
        actorStaffId: staff.id,
        at: new Date(),
      });
      if (outcome.kind === "not-found") throw new NotFoundError("فئة المصروف غير موجودة.");
      if (outcome.kind === "conflict") throw new ExpensesValidationError("اسم فئة المصروف مستخدم بالفعل.");
      return outcome.category;
    },

    async create(auth: VerifiedAuth | null, input: unknown): Promise<CreateExpenseResult> {
      const { staff, branchId } = await activeBranchContext(auth);
      const command = parseCreate(input);
      const payloadFingerprint = fingerprintExpensePayload({
        actorStaffId: staff.id,
        branchId,
        amountPiasters: command.amountPiasters,
        expenseDate: command.expenseDate,
        categoryId: command.categoryId,
        description: command.description,
      });
      const outcome = await ports.expenses.createExpense({
        id: crypto.randomUUID(),
        operationId: command.operationId,
        payloadFingerprint,
        branchId,
        createdByStaffId: staff.id,
        value: command,
        recordedAt: new Date(),
      });
      if (outcome.kind === "conflict") throw new ExpenseOperationConflictError();
      if (outcome.kind === "category-unavailable") throw new ExpensesValidationError("فئة المصروف غير متاحة.");
      return { expense: toDto(outcome.record), created: outcome.kind === "created" };
    },

    async change(auth: VerifiedAuth | null, expenseIdValue: string, input: unknown): Promise<ChangeExpenseResult> {
      const { staff } = await requireManager(auth);
      const expenseId = assertUuid(expenseIdValue, "المصروف غير موجود.");
      const command = parseChange(input);
      const payloadFingerprint = fingerprintExpensePayload({
        actorStaffId: staff.id,
        expenseId,
        expectedRevision: command.expectedRevision,
        type: command.type,
        reason: command.reason,
        effective: command.effective,
      });
      const outcome = await ports.expenses.changeExpense({
        id: crypto.randomUUID(),
        operationId: command.operationId,
        payloadFingerprint,
        expenseId,
        expectedRevision: command.expectedRevision,
        type: command.type,
        reason: command.reason,
        actorStaffId: staff.id,
        at: new Date(),
        effective: command.effective,
      });
      if (outcome.kind === "not-found") throw new NotFoundError("المصروف غير موجود.");
      if (outcome.kind === "stale") throw new ExpenseRevisionConflictError();
      if (outcome.kind === "conflict") throw new ExpenseOperationConflictError();
      if (outcome.kind === "category-unavailable") throw new ExpensesValidationError("فئة المصروف غير متاحة.");
      return { expense: toDto(outcome.record), created: outcome.kind === "created" };
    },

    async list(auth: VerifiedAuth | null): Promise<ExpenseDto[]> {
      return (await ports.expenses.list(await readScope(auth))).map(toDto);
    },

    async get(auth: VerifiedAuth | null, id: string): Promise<ExpenseDto> {
      const record = await ports.expenses.getById(assertUuid(id, "المصروف غير موجود."), await readScope(auth));
      if (!record) throw new NotFoundError("المصروف غير موجود.");
      return toDto(record);
    },

    async getByOperation(auth: VerifiedAuth | null, operationId: string): Promise<ExpenseDto> {
      const record = await ports.expenses.getByOperationId(
        assertUuid(operationId, "معرّف العملية غير صالح."),
        await readScope(auth),
      );
      if (!record) throw new NotFoundError("لم تُحفظ عملية المصروف بعد.");
      return toDto(record);
    },

    async totals(auth: VerifiedAuth | null) {
      return ports.expenses.totals(await readScope(auth));
    },
  };
}

function parseCreate(input: unknown) {
  const body = expectObject(input, "بيانات المصروف غير صالحة.");
  assertAllowedKeys(body, CREATE_KEYS, "بيانات المصروف غير صالحة.");
  return {
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    amountPiasters: positivePiasters(body.amountPiasters),
    expenseDate: cairoDate(body.expenseDate),
    categoryId: assertUuid(body.categoryId, "فئة المصروف غير صالحة."),
    description: requiredText(body.description, "وصف المصروف مطلوب."),
  };
}

function parseChange(input: unknown): {
  operationId: string;
  expectedRevision: number;
  type: "correction" | "cancellation";
  reason: string;
  effective: { amountPiasters: number; expenseDate: string; categoryId: string; description: string } | null;
} {
  const body = expectObject(input, "بيانات تعديل المصروف غير صالحة.");
  assertAllowedKeys(body, CHANGE_KEYS, "بيانات تعديل المصروف غير صالحة.");
  const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new ExpensesValidationError("نسخة المصروف غير صالحة.");
  }
  if (body.type !== "correction" && body.type !== "cancellation") {
    throw new ExpensesValidationError("نوع تعديل المصروف غير صالح.");
  }
  const reason = requiredText(body.reason, "سبب تعديل المصروف مطلوب.");
  if (body.type === "cancellation") {
    if ([body.amountPiasters, body.expenseDate, body.categoryId, body.description].some((value) => value !== undefined)) {
      throw new ExpensesValidationError("إلغاء المصروف لا يقبل بيانات بديلة.");
    }
    return { operationId, expectedRevision: body.expectedRevision as number, type: body.type, reason, effective: null };
  }
  return {
    operationId,
    expectedRevision: body.expectedRevision as number,
    type: body.type,
    reason,
    effective: {
      amountPiasters: positivePiasters(body.amountPiasters),
      expenseDate: cairoDate(body.expenseDate),
      categoryId: assertUuid(body.categoryId, "فئة المصروف غير صالحة."),
      description: requiredText(body.description, "وصف المصروف مطلوب."),
    },
  };
}

function toDto(record: ExpenseRecord): ExpenseDto {
  const value = (item: ExpenseRecord["original"]) => ({
    amountPiasters: item.amountPiasters,
    expenseDate: item.expenseDate,
    category: { id: item.categoryId, nameAr: item.categoryNameAr },
    description: item.description,
  });
  return {
    id: record.id,
    operationId: record.operationId,
    branch: record.branch,
    createdByStaffId: record.createdByStaffId,
    createdByDisplayName: record.createdByDisplayName,
    recordedAt: record.recordedAt.toISOString(),
    revision: record.revision,
    status: record.effective ? "active" : "cancelled",
    original: value(record.original),
    effective: record.effective ? value(record.effective) : null,
    changes: record.changes.map((change) => ({
      id: change.id,
      operationId: change.operationId,
      type: change.type,
      revision: change.revision,
      reason: change.reason,
      changedByStaffId: change.changedByStaffId,
      changedByDisplayName: change.changedByDisplayName,
      changedAt: change.changedAt.toISOString(),
      previous: value(change.previous),
      effective: change.effective ? value(change.effective) : null,
    })),
  };
}

function expectObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExpensesValidationError(message);
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, message: string) {
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new ExpensesValidationError(message);
}

function assertUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ExpensesValidationError(message);
  return value;
}

function positivePiasters(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new ExpensesValidationError("قيمة المصروف غير صالحة.");
  return value as number;
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ExpensesValidationError(message);
  return value.trim();
}

function cairoDate(value: unknown): string {
  if (typeof value !== "string") throw new ExpensesValidationError("تاريخ المصروف غير صالح.");
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new ExpensesValidationError("تاريخ المصروف غير صالح.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ExpensesValidationError("تاريخ المصروف غير صالح.");
  }
  return value;
}

export function normalizeExpenseCategoryName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}
