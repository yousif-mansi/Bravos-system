import type { ReturnDto, ReturnSourceDto } from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
  canUseBranch,
} from "@bravos/identity";
import { OperationConflictError, assertQuantity } from "@bravos/inventory";
import { ReturnWindowExpiredError, ReturnsValidationError } from "../domain/errors.ts";
import { fingerprintRefundPayment, fingerprintReturnPayload } from "../domain/fingerprint.ts";
import type {
  RefundEventRecord,
  ReturnLineWrite,
  ReturnRecord,
  ReturnRestorationWrite,
  ReturnServices,
  ReturnSourceRecord,
  ReturnUnitWrite,
  ReturnsActorPort,
  ReturnsStore,
  ReturnsUnitOfWork,
  ReturnVariantReader,
  SourceSearch,
  VerifiedAuth,
} from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_KEYS = new Set(["returnId", "operationId", "sourceSaleId", "handlingBranchId", "authorizedRefundPiasters", "lines"]);
const UPDATE_DRAFT_KEYS = new Set(["expectedRevision", "handlingBranchId", "authorizedRefundPiasters", "lines"]);
const LINE_KEYS = new Set(["sourceSaleLineId", "quantity", "sellableQuantity"]);
const POST_KEYS = new Set(["receivedAndInspected", "expectedRevision"]);
const PAY_KEYS = new Set(["operationId", "status", "amountPiasters"]);

export function createReturnServices(ports: {
  actors: ReturnsActorPort;
  variants: ReturnVariantReader;
  returns: ReturnsStore;
  uow: ReturnsUnitOfWork;
  clock?: { now(): Date };
}): ReturnServices {
  const clock = ports.clock ?? { now: () => new Date() };

  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }

  async function sourceDto(source: ReturnSourceRecord): Promise<ReturnSourceDto> {
    const [branches, identities] = await Promise.all([
      ports.actors.listBranches(),
      ports.variants.getVariants(source.lines.map((line) => line.variantId)),
    ]);
    const branch = branches.find((item) => item.id === source.branchId);
    if (!branch) throw new ReturnsValidationError("فرع البيع الأصلي غير موجود.");
    const byId = new Map(identities.map((item) => [item.id, item]));
    return {
      saleId: source.saleId,
      reference: source.saleId,
      channel: "physical",
      originalBranch: branch,
      soldByStaffId: source.soldByStaffId,
      soldByDisplayName: source.soldByDisplayName,
      receivedAt: source.occurredAt.toISOString(),
      returnDeadlineAt: source.returnDeadlineAt.toISOString(),
      finalTotalPiasters: source.finalTotalPiasters,
      customerName: source.customerName,
      customerPhone: source.customerPhone,
      lines: source.lines.map((line) => {
        const variant = byId.get(line.variantId);
        if (!variant) throw new ReturnsValidationError("المتغير المحدد غير موجود.");
        const returnedQuantity = line.units.reduce((sum, unit) => sum + unit.alreadyReturnedQuantity, 0);
        const remainingSuggestedPiasters = line.units.reduce(
          (sum, unit) => sum + (unit.quantity - unit.alreadyReturnedQuantity) * unit.paidPiasters,
          0,
        );
        return {
          saleLineId: line.id,
          variantId: line.variantId,
          variant,
          purchasedQuantity: line.quantity,
          returnedQuantity,
          remainingQuantity: line.quantity - returnedQuantity,
          paidPiasters: line.paidPiasters,
          remainingSuggestedPiasters,
          availablePaidRanges: line.units
            .map((unit) => ({
              quantity: unit.quantity - unit.alreadyReturnedQuantity,
              paidUnitPiasters: unit.paidPiasters,
            }))
            .filter((range) => range.quantity > 0),
        };
      }),
    };
  }

  async function hydrate(record: ReturnRecord): Promise<ReturnDto> {
    const source = await ports.returns.getSource(record.sourceSaleId);
    if (!source) throw new ReturnsValidationError("تعذر العثور على البيع الأصلي.");
    const [sourceValue, branches, identities] = await Promise.all([
      sourceDto(source),
      ports.actors.listBranches(),
      ports.variants.getVariants(record.lines.map((line) => line.variantId)),
    ]);
    const handlingBranch = branches.find((item) => item.id === record.handlingBranchId);
    if (!handlingBranch) throw new ReturnsValidationError("فرع معالجة الإرجاع غير موجود.");
    const byId = new Map(identities.map((item) => [item.id, item]));
    return {
      id: record.id,
      operationId: record.operationId,
      status: record.status,
      revision: record.revision,
      source: sourceValue,
      handlingBranch,
      suggestedRefundPiasters: record.suggestedRefundPiasters,
      authorizedRefundPiasters: record.authorizedRefundPiasters,
      createdByStaffId: record.createdByStaffId,
      createdAt: record.createdAt.toISOString(),
      updatedByStaffId: record.updatedByStaffId,
      updatedAt: record.updatedAt.toISOString(),
      postedByStaffId: record.postedByStaffId,
      postedAt: record.postedAt?.toISOString() ?? null,
      lines: record.lines.map((line) => {
        const variant = byId.get(line.variantId);
        if (!variant) throw new ReturnsValidationError("المتغير المحدد غير موجود.");
        return {
          id: line.id,
          sourceSaleLineId: line.sourceSaleLineId,
          variantId: line.variantId,
          variant,
          quantity: line.quantity,
          sellableQuantity: line.sellableQuantity,
          unsellableQuantity: line.quantity - line.sellableQuantity,
          suggestedRefundPiasters: line.suggestedRefundPiasters,
        };
      }),
      restorations: record.restorations.map((item) => ({
        batchId: item.batchId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitCostPiasters: item.unitCostPiasters,
      })),
      refund: {
        status: record.refundStatus,
        owedPiasters: record.status === "posted" && record.refundStatus === "owed" ? record.authorizedRefundPiasters : 0,
        paidPiasters: record.refundPaidPiasters,
        recordedByStaffId: record.refundRecordedByStaffId,
        recordedAt: record.refundRecordedAt?.toISOString() ?? null,
        events: record.refundEvents.map(toEventDto),
      },
    };
  }

  return {
    async listSources(auth, input) {
      await requireManager(auth);
      const search = parseSearch(input);
      const rows = await ports.returns.listSources(search);
      return Promise.all(rows.map(sourceDto));
    },

    async createDraft(auth, input) {
      const manager = await requireManager(auth);
      const command = parseDraft(input);
      if (!canUseBranch(manager, command.handlingBranchId)) throw new ForbiddenError();
      const source = await ports.returns.getSource(command.sourceSaleId);
      if (!source) throw new NotFoundError("تعذر العثور على البيع الأصلي.");
      const plan = planReturn(source, command.lines);
      const fingerprint = fingerprintReturnPayload({
        sourceSaleId: command.sourceSaleId,
        handlingBranchId: command.handlingBranchId,
        authorizedRefundPiasters: command.authorizedRefundPiasters,
        lines: command.lines,
      });
      const lines: ReturnLineWrite[] = plan.lines.map((line, lineIndex) => ({
        id: crypto.randomUUID(),
        sourceSaleLineId: line.sourceSaleLineId,
        variantId: line.variantId,
        quantity: line.quantity,
        sellableQuantity: line.sellableQuantity,
        suggestedRefundPiasters: line.suggestedRefundPiasters,
        lineIndex,
      }));
      const outcome = await ports.uow.run(async (tx) => {
        await tx.returns.lockIdentities(command.returnId, command.operationId);
        const byId = await tx.returns.getById(command.returnId);
        const byOperation = await tx.returns.getByOperationId(command.operationId);
        const existing = byId ?? byOperation;
        if (existing) {
          if (existing.id !== command.returnId || existing.operationId !== command.operationId || existing.payloadFingerprint !== fingerprint) {
            throw new OperationConflictError();
          }
          return { record: existing, created: false };
        }
        const inserted = await tx.returns.insertDraft({
          id: command.returnId,
          operationId: command.operationId,
          sourceSaleId: command.sourceSaleId,
          handlingBranchId: command.handlingBranchId,
          status: "draft",
          revision: 1,
          payloadFingerprint: fingerprint,
          draftPayloadFingerprint: fingerprint,
          suggestedRefundPiasters: plan.suggestedRefundPiasters,
          authorizedRefundPiasters: command.authorizedRefundPiasters,
          createdByStaffId: manager.id,
          updatedByStaffId: manager.id,
          lines,
        });
        return { record: inserted.record, created: inserted.kind === "created" };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async updateDraft(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const command = parseDraftUpdate(input);
      const record = await ports.uow.run(async (tx) => {
        const existing = await tx.returns.getById(returnId, true);
        if (!existing) throw new NotFoundError("الإرجاع غير موجود.");
        if (!canUseBranch(manager, command.handlingBranchId)) throw new ForbiddenError();
        const fingerprint = fingerprintReturnPayload({
          sourceSaleId: existing.sourceSaleId,
          handlingBranchId: command.handlingBranchId,
          authorizedRefundPiasters: command.authorizedRefundPiasters,
          lines: command.lines,
        });
        if (
          existing.status === "draft"
          && existing.revision === command.expectedRevision + 1
          && existing.draftPayloadFingerprint === fingerprint
        ) {
          return existing;
        }
        if (existing.status !== "draft") {
          throw new OperationConflictError("لا يمكن تعديل الإرجاع بعد ترحيله.");
        }
        if (existing.revision !== command.expectedRevision) {
          throw new OperationConflictError("تغيرت المسودة. أعد تحميلها قبل حفظ التعديل.");
        }
        const source = await tx.returns.getSource(existing.sourceSaleId, true);
        if (!source) throw new NotFoundError("تعذر العثور على البيع الأصلي.");
        const plan = planReturn(source, command.lines);
        return tx.returns.updateDraft({
          returnId,
          expectedRevision: command.expectedRevision,
          handlingBranchId: command.handlingBranchId,
          draftPayloadFingerprint: fingerprint,
          suggestedRefundPiasters: plan.suggestedRefundPiasters,
          authorizedRefundPiasters: command.authorizedRefundPiasters,
          updatedByStaffId: manager.id,
          updatedAt: clock.now(),
          lines: plan.lines.map((line, lineIndex) => ({
            id: crypto.randomUUID(),
            sourceSaleLineId: line.sourceSaleLineId,
            variantId: line.variantId,
            quantity: line.quantity,
            sellableQuantity: line.sellableQuantity,
            suggestedRefundPiasters: line.suggestedRefundPiasters,
            lineIndex,
          })),
        });
      });
      return hydrate(record);
    },

    async post(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const body = expectObject(input, "بيانات استلام الإرجاع غير صالحة.");
      assertAllowedKeys(body, POST_KEYS, "بيانات استلام الإرجاع غير صالحة.");
      if (body.receivedAndInspected !== true) {
        throw new ReturnsValidationError("يجب تأكيد استلام الأصناف وفحصها.");
      }
      const expectedRevision = positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة.");
      const outcome = await ports.uow.run(async (tx) => {
        const record = await tx.returns.getById(returnId, true);
        if (!record) throw new NotFoundError("الإرجاع غير موجود.");
        if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
        if (record.revision !== expectedRevision) {
          throw new OperationConflictError("تغيرت المسودة. أعد تحميلها قبل ترحيل الإرجاع.");
        }
        if (record.status === "posted") return { record, created: false };
        await tx.inventory.lockStockClock("update");
        const source = await tx.returns.getSource(record.sourceSaleId, true);
        if (!source) throw new ReturnsValidationError("تعذر العثور على البيع الأصلي.");
        const now = clock.now();
        if (now.getTime() > source.returnDeadlineAt.getTime()) throw new ReturnWindowExpiredError();
        const plan = planReturn(source, record.lines.map((line) => ({
          sourceSaleLineId: line.sourceSaleLineId,
          quantity: line.quantity,
          sellableQuantity: line.sellableQuantity,
        })));
        if (plan.suggestedRefundPiasters !== record.suggestedRefundPiasters) {
          throw new OperationConflictError("تغيرت الكميات المتاحة للإرجاع. أنشئ مسودة جديدة.");
        }
        const claimed = await tx.inventory.claimReturnOperation({
          operationId: record.operationId,
          payloadFingerprint: record.draftPayloadFingerprint,
          actorStaffId: manager.id,
        });
        if (claimed.kind === "replay") {
          const replay = await tx.returns.getByOperationId(record.operationId);
          if (!replay?.postedAt) throw new OperationConflictError();
          return { record: replay, created: false };
        }
        const lineIdBySource = new Map(record.lines.map((line) => [line.sourceSaleLineId, line.id]));
        const units: ReturnUnitWrite[] = plan.units.map((unit) => ({
          id: crypto.randomUUID(),
          returnLineId: lineIdBySource.get(unit.sourceSaleLineId) ?? "",
          sourceSaleUnitId: unit.sourceSaleUnitId,
          startOffset: unit.startOffset,
          quantity: unit.quantity,
          paidUnitPiasters: unit.paidUnitPiasters,
        }));
        if (units.some((unit) => !unit.returnLineId)) throw new ReturnsValidationError("بيانات أصناف الإرجاع غير متطابقة.");
        const restorations: ReturnRestorationWrite[] = plan.restorations.map((item) => ({
          id: crypto.randomUUID(),
          ...item,
        }));
        for (const item of restorations) {
          await tx.inventory.restoreToOriginalBatch({
            operationId: record.operationId,
            batchId: item.batchId,
            variantId: item.variantId,
            quantity: item.quantity,
            recordedAt: claimed.recordedAt,
          });
        }
        const posted = await tx.returns.post({
          returnId: record.id,
          postedByStaffId: manager.id,
          postedAt: claimed.recordedAt,
          units,
          restorations,
        });
        if (restorations.length > 0) await tx.inventory.bumpStockVersion();
        return { record: posted, created: true };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async markPaid(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const body = expectObject(input, "بيانات دفع الاسترداد غير صالحة.");
      assertAllowedKeys(body, PAY_KEYS, "بيانات دفع الاسترداد غير صالحة.");
      if (body.status !== "paid") throw new ReturnsValidationError("حالة دفع الاسترداد غير صالحة.");
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const amountPiasters = nonnegativeMoney(body.amountPiasters, "قيمة الاسترداد المدفوعة غير صالحة.");
      const fingerprint = fingerprintRefundPayment(returnId, amountPiasters);
      const outcome = await ports.uow.run(async (tx) => {
        const record = await tx.returns.getById(returnId, true);
        if (!record) throw new NotFoundError("الإرجاع غير موجود.");
        if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
        if (record.status !== "posted") throw new ReturnsValidationError("يجب ترحيل الإرجاع قبل تسجيل الدفع.");
        const existingEvent = await tx.returns.getRefundEventByOperation(operationId);
        if (existingEvent) {
          if (existingEvent.returnId !== returnId || existingEvent.payloadFingerprint !== fingerprint) {
            throw new OperationConflictError();
          }
          return { record, created: false };
        }
        if (record.refundStatus === "paid") {
          throw new OperationConflictError("تم تسجيل دفع هذا الاسترداد بمعرّف عملية آخر.");
        }
        if (amountPiasters !== record.authorizedRefundPiasters) {
          throw new ReturnsValidationError("يجب أن يساوي المبلغ المدفوع قيمة الاسترداد المعتمدة.");
        }
        const result = await tx.returns.markPaid({
          returnId,
          operationId,
          amountPiasters,
          payloadFingerprint: fingerprint,
          actorStaffId: manager.id,
          recordedAt: clock.now(),
        });
        return { record: result.record, created: result.kind === "created" };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async list(auth, input) {
      await requireManager(auth);
      const page = parseReturnList(input);
      const result = await ports.returns.listPage(page);
      return {
        items: result.items.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          postedAt: row.postedAt?.toISOString() ?? null,
        })),
        nextCursor: result.nextCursor,
      };
    },

    async get(auth, id) {
      await requireManager(auth);
      const record = await ports.returns.getById(assertUuid(id, "الإرجاع غير موجود."));
      if (!record) throw new NotFoundError("الإرجاع غير موجود.");
      return hydrate(record);
    },
  };
}

type RequestedLine = { sourceSaleLineId: string; quantity: number; sellableQuantity: number };

function planReturn(source: ReturnSourceRecord, requested: RequestedLine[]) {
  const sourceByLine = new Map(source.lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const selected: Array<{
    sourceSaleLineId: string;
    sourceSaleUnitId: string;
    variantId: string;
    startOffset: number;
    quantity: number;
    paidUnitPiasters: number;
    variantOrdinal: number;
    sellableQuantity: number;
  }> = [];
  const linePlans: Array<{
    sourceSaleLineId: string;
    variantId: string;
    quantity: number;
    sellableQuantity: number;
    suggestedRefundPiasters: number;
  }> = [];
  const variantPrefixes = unitVariantPrefixes(source);

  for (const request of requested) {
    if (seen.has(request.sourceSaleLineId)) throw new ReturnsValidationError("لا تكرر صنف البيع في الإرجاع.");
    seen.add(request.sourceSaleLineId);
    const line = sourceByLine.get(request.sourceSaleLineId);
    if (!line) throw new ReturnsValidationError("صنف البيع الأصلي غير موجود.");
    let needed = request.quantity;
    let sellableNeeded = request.sellableQuantity;
    let suggestion = 0;
    for (const unit of line.units) {
      if (needed <= 0) break;
      const available = unit.quantity - unit.alreadyReturnedQuantity;
      if (available <= 0) continue;
      const take = Math.min(needed, available);
      const sellableTake = Math.min(sellableNeeded, take);
      suggestion += take * unit.paidPiasters;
      selected.push({
        sourceSaleLineId: line.id,
        sourceSaleUnitId: unit.id,
        variantId: line.variantId,
        startOffset: unit.alreadyReturnedQuantity,
        quantity: take,
        paidUnitPiasters: unit.paidPiasters,
        variantOrdinal: (variantPrefixes.get(unit.id) ?? 0) + unit.alreadyReturnedQuantity,
        sellableQuantity: sellableTake,
      });
      needed -= take;
      sellableNeeded -= sellableTake;
    }
    if (needed > 0) throw new ReturnsValidationError("الكمية المطلوبة تتجاوز الكمية غير المرتجعة.");
    linePlans.push({
      sourceSaleLineId: line.id,
      variantId: line.variantId,
      quantity: request.quantity,
      sellableQuantity: request.sellableQuantity,
      suggestedRefundPiasters: suggestion,
    });
  }

  const restorations = restorationPlan(source, selected);
  return {
    lines: linePlans,
    units: selected,
    restorations,
    suggestedRefundPiasters: linePlans.reduce((sum, line) => sum + line.suggestedRefundPiasters, 0),
  };
}

function unitVariantPrefixes(source: ReturnSourceRecord) {
  const result = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const line of [...source.lines].sort((a, b) => a.lineIndex - b.lineIndex)) {
    for (const unit of [...line.units].sort((a, b) => a.unitIndex - b.unitIndex)) {
      const current = counters.get(line.variantId) ?? 0;
      result.set(unit.id, current);
      counters.set(line.variantId, current + unit.quantity);
    }
  }
  return result;
}

function restorationPlan(
  source: ReturnSourceRecord,
  selected: Array<{ variantId: string; variantOrdinal: number; quantity: number; sellableQuantity: number }>,
) {
  const allocationsByVariant = new Map<string, Array<{ start: number; end: number; batchId: string; unitCostPiasters: number }>>();
  const offsets = new Map<string, number>();
  for (const allocation of source.allocations) {
    const start = offsets.get(allocation.variantId) ?? 0;
    const list = allocationsByVariant.get(allocation.variantId) ?? [];
    list.push({ start, end: start + allocation.quantity, batchId: allocation.batchId, unitCostPiasters: allocation.unitCostPiasters });
    allocationsByVariant.set(allocation.variantId, list);
    offsets.set(allocation.variantId, start + allocation.quantity);
  }
  const totals = new Map<string, { batchId: string; variantId: string; quantity: number; unitCostPiasters: number }>();
  for (const segment of selected) {
    let remaining = segment.sellableQuantity;
    let cursor = segment.variantOrdinal;
    for (const allocation of allocationsByVariant.get(segment.variantId) ?? []) {
      if (remaining <= 0) break;
      if (cursor >= allocation.end || cursor < allocation.start) continue;
      const take = Math.min(remaining, allocation.end - cursor);
      const key = `${allocation.batchId}:${segment.variantId}`;
      const existing = totals.get(key);
      totals.set(key, {
        batchId: allocation.batchId,
        variantId: segment.variantId,
        quantity: (existing?.quantity ?? 0) + take,
        unitCostPiasters: allocation.unitCostPiasters,
      });
      cursor += take;
      remaining -= take;
    }
    if (remaining > 0) {
      throw new ReturnsValidationError("لا يمكن استعادة صنف قابل للبيع دون دفعة تكلفة أصلية مخصصة.");
    }
  }
  return [...totals.values()];
}

function parseDraft(input: unknown) {
  const body = expectObject(input, "بيانات الإرجاع غير صالحة.");
  assertAllowedKeys(body, DRAFT_KEYS, "بيانات الإرجاع غير صالحة.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ReturnsValidationError("اختر صنفاً واحداً على الأقل.");
  return {
    returnId: assertUuid(body.returnId, "معرّف الإرجاع غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    sourceSaleId: assertUuid(body.sourceSaleId, "البيع الأصلي غير صالح."),
    handlingBranchId: assertUuid(body.handlingBranchId, "فرع معالجة الإرجاع غير صالح."),
    authorizedRefundPiasters: nonnegativeMoney(body.authorizedRefundPiasters, "قيمة الاسترداد المعتمدة غير صالحة."),
    lines: body.lines.map((raw) => {
      const line = expectObject(raw, "بيانات صنف الإرجاع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف الإرجاع غير صالحة.");
      const quantity = positiveQuantity(line.quantity, "كمية الإرجاع غير صالحة.");
      const sellableQuantity = nonnegativeQuantity(line.sellableQuantity, "الكمية القابلة للبيع غير صالحة.");
      if (sellableQuantity > quantity) throw new ReturnsValidationError("الكمية القابلة للبيع تتجاوز كمية الإرجاع.");
      return { sourceSaleLineId: assertUuid(line.sourceSaleLineId, "صنف البيع الأصلي غير صالح."), quantity, sellableQuantity };
    }),
  };
}

function parseDraftUpdate(input: unknown) {
  const body = expectObject(input, "بيانات تعديل مسودة الإرجاع غير صالحة.");
  assertAllowedKeys(body, UPDATE_DRAFT_KEYS, "بيانات تعديل مسودة الإرجاع غير صالحة.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new ReturnsValidationError("اختر صنفاً واحداً على الأقل.");
  }
  return {
    expectedRevision: positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة."),
    handlingBranchId: assertUuid(body.handlingBranchId, "فرع معالجة الإرجاع غير صالح."),
    authorizedRefundPiasters: nonnegativeMoney(body.authorizedRefundPiasters, "قيمة الاسترداد المعتمدة غير صالحة."),
    lines: body.lines.map((raw) => {
      const line = expectObject(raw, "بيانات صنف الإرجاع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف الإرجاع غير صالحة.");
      const quantity = positiveQuantity(line.quantity, "كمية الإرجاع غير صالحة.");
      const sellableQuantity = nonnegativeQuantity(line.sellableQuantity, "الكمية القابلة للبيع غير صالحة.");
      if (sellableQuantity > quantity) throw new ReturnsValidationError("الكمية القابلة للبيع تتجاوز كمية الإرجاع.");
      return { sourceSaleLineId: assertUuid(line.sourceSaleLineId, "صنف البيع الأصلي غير صالح."), quantity, sellableQuantity };
    }),
  };
}

function parseReturnList(input: unknown): { limit: number; cursor: string | null } {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawLimit = body.limit === undefined || body.limit === "" ? 50 : Number(body.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new ReturnsValidationError("حجم صفحة المرتجعات غير صالح.");
  }
  const cursor = body.cursor === undefined || body.cursor === ""
    ? null
    : assertUuid(body.cursor, "مؤشر صفحة المرتجعات غير صالح.");
  return { limit: rawLimit, cursor };
}

function parseSearch(input: unknown): SourceSearch {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const search: SourceSearch = {};
  if (typeof body.reference === "string" && body.reference.trim()) search.reference = body.reference.trim().slice(0, 100);
  if (typeof body.date === "string" && body.date) {
    const match = DATE_PATTERN.exec(body.date);
    const parts = body.date.split("-").map(Number);
    const parsed = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 0) - 1, parts[2] ?? 0));
    if (!match || parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== (parts[1] ?? 0) - 1 || parsed.getUTCDate() !== parts[2]) {
      throw new ReturnsValidationError("تاريخ البحث غير صالح.");
    }
    search.date = body.date;
  }
  if (typeof body.branchId === "string" && body.branchId) search.branchId = assertUuid(body.branchId, "فرع البحث غير صالح.");
  if (typeof body.item === "string" && body.item.trim()) search.item = body.item.trim().slice(0, 120);
  if (body.amountPiasters !== undefined && body.amountPiasters !== "") search.amountPiasters = nonnegativeMoney(Number(body.amountPiasters), "قيمة البحث غير صالحة.");
  return search;
}

function positiveQuantity(value: unknown, message: string) {
  try { return assertQuantity(value, message); } catch { throw new ReturnsValidationError(message); }
}

function nonnegativeQuantity(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ReturnsValidationError(message);
  return value;
}

function nonnegativeMoney(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new ReturnsValidationError(message);
  }
  return value;
}

function assertUuid(value: unknown, message: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ReturnsValidationError(message);
  return value;
}

function expectObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReturnsValidationError(message);
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, message: string) {
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new ReturnsValidationError(message);
}

function toEventDto(event: RefundEventRecord) {
  return {
    operationId: event.operationId,
    status: event.status,
    amountPiasters: event.amountPiasters,
    actorStaffId: event.actorStaffId,
    recordedAt: event.recordedAt.toISOString(),
  };
}
