import { createHash } from "node:crypto";
import { ForbiddenError, isManager, NotFoundError, UnauthenticatedError } from "@bravos/identity";
import { OperationConflictError } from "@bravos/inventory";
import { CorrectionsValidationError } from "../domain/errors.ts";
import type {
  CashFactWrite, CorrectionServices, CorrectionsActorPort, CorrectionsRepository,
  MerchandiseAdjustmentWrite, ReturnCorrectionWrite, ReturnValueWrite,
  SaleCorrectionWrite, SaleValueWrite, VerifiedAuth,
} from "./ports.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT_KEYS = new Set(["operationId", "expectedRevision", "type", "reason", "effective", "merchandise", "cash"]);
const SALE_EFFECTIVE_KEYS = new Set(["finalTotalPiasters", "lines"]);
const RETURN_EFFECTIVE_KEYS = new Set(["authorizedRefundPiasters", "lines"]);
const SALE_LINE_KEYS = new Set(["lineId", "quantity", "paidPiasters"]);
const RETURN_LINE_KEYS = new Set(["lineId", "quantity", "sellableQuantity"]);
const MERCHANDISE_KEYS = new Set(["lineId", "quantityDelta"]);
const CASH_KEYS = new Set(["direction", "amountPiasters"]);

export function createCorrectionServices(ports: { actors: CorrectionsActorPort; corrections: CorrectionsRepository; clock?: { now(): Date } }): CorrectionServices {
  const clock = ports.clock ?? { now: () => new Date() };
  async function manager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }
  return {
    async getSale(auth, saleIdValue) {
      await manager(auth);
      const saleId = uuid(saleIdValue, "البيع غير موجود.");
      const value = await ports.corrections.getSale(saleId);
      if (!value) throw new NotFoundError("البيع غير موجود.");
      return value;
    },
    async changeSale(auth, saleIdValue, input) {
      const staff = await manager(auth);
      const saleId = uuid(saleIdValue, "البيع غير موجود.");
      const command = parse(input, "sale");
      const payloadFingerprint = fingerprint({ actorStaffId: staff.id, saleId, ...command });
      const result = await ports.corrections.changeSale({
        correctionId: crypto.randomUUID(), saleId, actorStaffId: staff.id, at: clock.now(), payloadFingerprint, ...command,
      });
      if (result.kind === "not-found") throw new NotFoundError("البيع غير موجود.");
      if (result.kind === "stale") throw new OperationConflictError("تغيرت بيانات البيع الفعالة. أعد تحميلها قبل التصحيح.");
      return { value: result.value, created: result.kind === "created" };
    },
    async getReturn(auth, returnIdValue) {
      await manager(auth);
      const returnId = uuid(returnIdValue, "الإرجاع غير موجود.");
      const value = await ports.corrections.getReturn(returnId);
      if (!value) throw new NotFoundError("الإرجاع غير موجود.");
      return value;
    },
    async changeReturn(auth, returnIdValue, input) {
      const staff = await manager(auth);
      const returnId = uuid(returnIdValue, "الإرجاع غير موجود.");
      const command = parse(input, "return");
      const payloadFingerprint = fingerprint({ actorStaffId: staff.id, returnId, ...command });
      const result = await ports.corrections.changeReturn({
        correctionId: crypto.randomUUID(), returnId, actorStaffId: staff.id, at: clock.now(), payloadFingerprint, ...command,
      });
      if (result.kind === "not-found") throw new NotFoundError("الإرجاع غير موجود.");
      if (result.kind === "stale") throw new OperationConflictError("تغيرت بيانات الإرجاع الفعالة. أعد تحميلها قبل التصحيح.");
      return { value: result.value, created: result.kind === "created" };
    },
  };
}

type ParsedCommon = Pick<SaleCorrectionWrite, "operationId" | "expectedRevision" | "type" | "reason" | "merchandise" | "cash">;
type ParsedSale = ParsedCommon & { effective: SaleValueWrite };
type ParsedReturn = ParsedCommon & { effective: ReturnValueWrite };

function parse(input: unknown, target: "sale"): ParsedSale;
function parse(input: unknown, target: "return"): ParsedReturn;
function parse(input: unknown, target: "sale" | "return"): ParsedSale | ParsedReturn {
  const body = object(input, "بيانات تصحيح التسجيل غير صالحة.");
  allowed(body, ROOT_KEYS);
  const operationId = uuid(body.operationId, "مرجع إعادة المحاولة غير صالح.");
  const expectedRevision = integer(body.expectedRevision, 0, "نسخة البيانات غير صالحة.");
  if (body.type !== "correction" && body.type !== "cancellation") throw new CorrectionsValidationError("نوع التصحيح غير صالح.");
  const type: "correction" | "cancellation" = body.type;
  const reason = text(body.reason, "سبب التصحيح مطلوب.");
  const merchandise = parseMerchandise(body.merchandise);
  const cash = parseCash(body.cash);
  let effective: SaleValueWrite | ReturnValueWrite;
  if (type === "cancellation") {
    if (body.effective !== null && body.effective !== undefined) throw new CorrectionsValidationError("الإلغاء لا يحتوي قيماً فعالة جديدة.");
    effective = null;
  } else if (target === "sale") {
    const value = object(body.effective, "القيم الفعالة للبيع مطلوبة."); allowed(value, SALE_EFFECTIVE_KEYS);
    const parsedLines = lines(value.lines, SALE_LINE_KEYS).map((line) => {
      const quantity = integer(line.quantity, 0, "كمية البيع الفعالة غير صالحة.");
      const paidPiasters = money(line.paidPiasters, "قيمة سطر البيع الفعالة غير صالحة.");
      const paidRanges = countedPaidRanges(quantity, paidPiasters);
      return { lineId: uuid(line.lineId, "سطر البيع غير صالح."), quantity, paidPiasters, paidRanges };
    });
    if (parsedLines.some((line) => line.quantity === 0 && line.paidPiasters !== 0)) {
      throw new CorrectionsValidationError("سطر البيع ذي الكمية صفر يجب أن تكون قيمته صفر.");
    }
    const finalTotalPiasters = money(value.finalTotalPiasters, "إجمالي البيع الفعال غير صالح.");
    if (parsedLines.reduce((sum, line) => sum + line.paidPiasters, 0) !== finalTotalPiasters) {
      throw new CorrectionsValidationError("يجب أن يساوي إجمالي البيع مجموع قيم أسطره الفعالة.");
    }
    effective = {
      finalTotalPiasters,
      lines: parsedLines,
    };
  } else {
    const value = object(body.effective, "القيم الفعالة للإرجاع مطلوبة."); allowed(value, RETURN_EFFECTIVE_KEYS);
    effective = {
      authorizedRefundPiasters: money(value.authorizedRefundPiasters, "قيمة الاسترداد الفعالة غير صالحة."),
      lines: lines(value.lines, RETURN_LINE_KEYS).map((line) => {
        const quantity = integer(line.quantity, 0, "كمية الإرجاع الفعالة غير صالحة.");
        const sellableQuantity = integer(line.sellableQuantity, 0, "الكمية القابلة للبيع غير صالحة.");
        if (sellableQuantity > quantity) throw new CorrectionsValidationError("الكمية القابلة للبيع لا تتجاوز الكمية المستلمة.");
        return { lineId: uuid(line.lineId, "سطر الإرجاع غير صالح."), quantity, sellableQuantity };
      }),
    };
  }
  return { operationId, expectedRevision, type, reason, effective, merchandise, cash } as ParsedSale | ParsedReturn;
}

function parseMerchandise(value: unknown): MerchandiseAdjustmentWrite[] {
  if (!Array.isArray(value)) throw new CorrectionsValidationError("يجب تحديد ما حدث فعلياً للبضاعة.");
  const parsed = value.map((entry) => { const row = object(entry, "بيانات حركة البضاعة غير صالحة."); allowed(row, MERCHANDISE_KEYS); return { lineId: uuid(row.lineId, "سطر حركة البضاعة غير صالح."), quantityDelta: integer(row.quantityDelta, -1_000_000, "كمية حركة البضاعة غير صالحة.") }; });
  if (parsed.some((row) => row.quantityDelta === 0) || new Set(parsed.map((row) => row.lineId)).size !== parsed.length) throw new CorrectionsValidationError("استخدم سطر حركة واحداً لكل صنف، واحذف الحركة ذات الكمية صفر.");
  return parsed.sort((a, b) => a.lineId.localeCompare(b.lineId));
}

function parseCash(value: unknown): CashFactWrite {
  if (value === null || value === undefined) return null;
  const row = object(value, "بيانات حركة النقد غير صالحة."); allowed(row, CASH_KEYS);
  if (row.direction !== "paid_out" && row.direction !== "recovered") throw new CorrectionsValidationError("اتجاه حركة النقد غير صالح.");
  return { direction: row.direction, amountPiasters: integer(row.amountPiasters, 1, "قيمة حركة النقد غير صالحة.") };
}
function lines(value: unknown, keys: Set<string>) { if (!Array.isArray(value) || value.length === 0) throw new CorrectionsValidationError("يجب إدخال كل أسطر التسجيل الفعالة."); return value.map((entry) => { const row = object(entry, "بيانات السطر غير صالحة."); allowed(row, keys); return row; }); }
function object(value: unknown, message: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new CorrectionsValidationError(message); return value as Record<string, unknown>; }
function allowed(value: Record<string, unknown>, keys: Set<string>) { if (Object.keys(value).some((key) => !keys.has(key))) throw new CorrectionsValidationError(); }
function uuid(value: unknown, message: string) { if (typeof value !== "string" || !UUID.test(value)) throw new CorrectionsValidationError(message); return value; }
function text(value: unknown, message: string) { if (typeof value !== "string" || !value.trim()) throw new CorrectionsValidationError(message); return value.trim(); }
function integer(value: unknown, min: number, message: string) { if (!Number.isSafeInteger(value) || (value as number) < min) throw new CorrectionsValidationError(message); return value as number; }
function money(value: unknown, message: string) { return integer(value, 0, message); }
function countedPaidRanges(quantity: number, totalPiasters: number) {
  if (quantity === 0) return [];
  const base = Math.floor(totalPiasters / quantity);
  const extra = totalPiasters % quantity;
  return [
    ...(extra > 0 ? [{ quantity: extra, paidUnitPiasters: base + 1 }] : []),
    ...(quantity - extra > 0 ? [{ quantity: quantity - extra, paidUnitPiasters: base }] : []),
  ];
}
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
