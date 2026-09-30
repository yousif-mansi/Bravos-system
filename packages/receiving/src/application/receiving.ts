import type { ReceiptDto } from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
} from "@bravos/identity";
import { assertPiasters, assertQuantity, OperationConflictError } from "@bravos/inventory";
import { ReceivingValidationError } from "../domain/errors.ts";
import type {
  CorrectReceiptResult,
  FinalizeReceiptResult,
  ReceiptLineWrite,
  ReceiptRecord,
  ReceivingActorPort,
  ReceivingBatchReader,
  ReceivingUnitOfWork,
  ReceiptCorrectionStore,
  ReceiptStore,
  VariantIdentityReader,
  VerifiedAuth,
} from "./ports.ts";

const RECEIPT_KEYS = new Set(["operationId", "branchId", "receiptDate", "lines"]);
const LINE_KEYS = new Set(["variantId", "quantity", "unitCostPiasters"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ReceivingServices = ReturnType<typeof createReceivingServices>;

export function createReceivingServices(ports: {
  actors: ReceivingActorPort;
  variants: VariantIdentityReader;
  inventory: ReceivingBatchReader;
  receipts: ReceiptStore;
  corrections: ReceiptCorrectionStore;
  uow: ReceivingUnitOfWork;
}) {
  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    if (!isManager(staff)) {
      throw new ForbiddenError();
    }
    return staff;
  }

  async function hydrate(record: ReceiptRecord, acceptedRevision?: number): Promise<ReceiptDto> {
    const [identities, batches, corrections] = await Promise.all([
      ports.variants.getVariants(record.lines.map((line) => line.variantId)),
      ports.inventory.getBatchStates(record.lines.map((line) => line.batchId)),
      ports.corrections.listForReceipt(record.id),
    ]);
    const byId = new Map(identities.map((item) => [item.id, item]));
    const batchById = new Map(batches.map((item) => [item.id, item]));
    const originalByLine = new Map(record.lines.map((line) => [line.id, line]));
    const visibleCorrections = acceptedRevision === undefined
      ? corrections
      : corrections.filter((item) => item.revision <= acceptedRevision);
    const acceptedCorrection = acceptedRevision === undefined || acceptedRevision === 0
      ? null
      : corrections.find((item) => item.revision === acceptedRevision);
    if (acceptedRevision !== undefined && acceptedRevision > 0 && !acceptedCorrection) {
      throw new ReceivingValidationError("تعذر العثور على نتيجة تصحيح الاستلام المحفوظة.");
    }
    const acceptedLineById = new Map(acceptedCorrection?.lines.map((line) => [line.lineId, line]) ?? []);
    const actorEntries = await Promise.all(
      [...new Set(visibleCorrections.map((item) => item.changedByStaffId))]
        .map(async (id) => [id, await ports.actors.getStaff(id)] as const),
    );
    const actorById = new Map(actorEntries);
    return {
      id: record.id,
      branchId: record.branchId,
      operationId: record.operationId,
      receiptDate: record.receiptDate,
      receivedByStaffId: record.receivedByStaffId,
      recordedAt: record.recordedAt.toISOString(),
      correctionRevision: acceptedRevision ?? corrections.at(-1)?.revision ?? 0,
      corrections: visibleCorrections.map((correction) => ({
        id: correction.id,
        operationId: correction.operationId,
        revision: correction.revision,
        reason: correction.reason,
        changedByStaffId: correction.changedByStaffId,
        changedByDisplayName: actorById.get(correction.changedByStaffId)?.displayName ?? correction.changedByStaffId,
        changedAt: correction.changedAt.toISOString(),
        lines: correction.lines.map((line) => {
          const original = originalByLine.get(line.lineId);
          if (!original) throw new ReceivingValidationError("صنف التصحيح غير موجود في إذن الاستلام.");
          return {
            lineId: line.lineId,
            originalQuantity: original.quantity,
            originalUnitCostPiasters: original.unitCostPiasters,
            previousQuantity: line.previousQuantity,
            previousUnitCostPiasters: line.previousUnitCostPiasters,
            effectiveQuantity: line.effectiveQuantity,
            effectiveUnitCostPiasters: line.effectiveUnitCostPiasters,
            quantityDelta: line.quantityDelta,
            unitCostDeltaPiasters: line.unitCostDeltaPiasters,
          };
        }),
      })),
      lines: record.lines.map((line) => {
        const variant = byId.get(line.variantId);
        const batch = batchById.get(line.batchId);
        if (!variant) {
          throw new ReceivingValidationError("المتغير المحدد غير موجود.");
        }
        if (!batch) throw new ReceivingValidationError("تعذر العثور على دفعة التكلفة الأصلية.");
        const acceptedLine = acceptedLineById.get(line.id);
        if (acceptedRevision !== undefined && acceptedRevision > 0 && !acceptedLine) {
          throw new ReceivingValidationError("تعذر العثور على نتيجة صنف التصحيح المحفوظة.");
        }
        const effectiveQuantity = acceptedRevision === 0
          ? line.quantity
          : acceptedLine?.effectiveQuantity ?? batch.effectiveReceivedQuantity;
        const effectiveUnitCostPiasters = acceptedRevision === 0
          ? line.unitCostPiasters
          : acceptedLine?.effectiveUnitCostPiasters ?? batch.effectiveUnitCostPiasters;
        const remainingQuantity = acceptedRevision === 0
          ? line.quantity
          : acceptedLine?.remainingQuantity ?? batch.remainingQuantity;
        const allocatedQuantity = acceptedRevision === 0
          ? 0
          : acceptedLine?.allocatedQuantity ?? batch.effectiveReceivedQuantity - batch.remainingQuantity;
        return {
          id: line.id,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostPiasters: line.unitCostPiasters,
          effectiveQuantity,
          effectiveUnitCostPiasters,
          remainingQuantity,
          allocatedQuantity,
          batchId: line.batchId,
          variant,
        };
      }),
    };
  }

  return {
    async finalize(auth: VerifiedAuth | null, input: unknown): Promise<FinalizeReceiptResult> {
      const staff = await requireManager(auth);
      const command = parseReceiptWrite(input);

      const outcome = await ports.uow.run(async (tx) => {
        await tx.inventory.lockStockClock("update");
        const claimed = await tx.inventory.claimReceiveOperation({
          operationId: command.operationId,
          payload: { branchId: command.branchId, receiptDate: command.receiptDate, lines: command.lines },
          actorStaffId: staff.id,
        });
        if (claimed.kind === "replay") {
          const existing = await tx.receipts.getByOperationId(command.operationId);
          if (!existing) {
            throw new ReceivingValidationError("تعذر العثور على إذن الاستلام الأصلي.");
          }
          return { record: existing, created: false };
        }
        await tx.inventory.assertStockMutationAllowed();

        const receiptId = crypto.randomUUID();
        const prepared = command.lines.map((line) => ({
          ...line,
          id: crypto.randomUUID(),
        }));
        const batches = await tx.inventory.receiveBatches({
          branchId: command.branchId,
          operationId: command.operationId,
          receiptId,
          receiptDate: command.receiptDate,
          recordedAt: claimed.recordedAt,
          lines: prepared.map((line) => ({
            lineId: line.id,
            variantId: line.variantId,
            quantity: line.quantity,
            unitCostPiasters: line.unitCostPiasters,
          })),
        });
        const batchByLine = new Map(batches.map((batch) => [batch.sourceLineId, batch]));
        const lines: ReceiptLineWrite[] = prepared.map((line) => {
          const batch = batchByLine.get(line.id);
          if (!batch) {
            throw new ReceivingValidationError("تعذر حفظ دفعات التكلفة.");
          }
          return {
            id: line.id,
            variantId: line.variantId,
            quantity: line.quantity,
            unitCostPiasters: line.unitCostPiasters,
            batchId: batch.id,
          };
        });
        const record = await tx.receipts.insert({
          id: receiptId,
          branchId: command.branchId,
          operationId: command.operationId,
          receiptDate: command.receiptDate,
          receivedByStaffId: staff.id,
          recordedAt: claimed.recordedAt,
          lines,
        });
        await tx.inventory.bumpStockVersion();
        return { record, created: true };
      });
      return { receipt: await hydrate(outcome.record, 0), created: outcome.created };
    },

    async correct(
      auth: VerifiedAuth | null,
      receiptIdValue: string,
      input: unknown,
    ): Promise<CorrectReceiptResult> {
      const staff = await requireManager(auth);
      const receiptId = assertUuid(receiptIdValue, "إذن الاستلام غير موجود.");
      const command = parseReceiptCorrection(input);
      const payloadFingerprint = await sha256(JSON.stringify({
        target: "receiving-correction",
        actorStaffId: staff.id,
        receiptId,
        expectedRevision: command.expectedRevision,
        reason: command.reason,
        lines: [...command.lines].sort((left, right) => left.lineId.localeCompare(right.lineId)),
      }));
      const outcome = await ports.uow.run(async (tx) => {
        await tx.inventory.lockStockClock("update");
        const record = await tx.receipts.getById(receiptId, true);
        if (!record) throw new NotFoundError("إذن الاستلام غير موجود.");
        const claimed = await tx.inventory.claimCorrectionOperation({
          operationId: command.operationId,
          payloadFingerprint,
          actorStaffId: staff.id,
        });
        if (claimed.kind === "replay") {
          const existing = await tx.corrections.getByOperationId(command.operationId);
          if (!existing || existing.receiptId !== receiptId) {
            throw new OperationConflictError();
          }
          return { record, created: false, acceptedRevision: existing.revision };
        }
        await tx.inventory.assertStockMutationAllowed();
        const history = await tx.corrections.listForReceipt(receiptId);
        const revision = history.at(-1)?.revision ?? 0;
        if (revision !== command.expectedRevision) {
          throw new OperationConflictError("تم تعديل إذن الاستلام. حدّث البيانات ثم أعد المحاولة.");
        }
        assertExactCorrectionLines(record, command.lines);
        const requestedByLine = new Map(command.lines.map((line) => [line.lineId, line]));
        const applied = await tx.inventory.applyReceivingCorrection({
          branchId: record.branchId,
          operationId: command.operationId,
          recordedAt: claimed.recordedAt,
          lines: record.lines.map((line) => {
            const requested = requestedByLine.get(line.id)!;
            return {
              batchId: line.batchId,
              variantId: line.variantId,
              effectiveQuantity: requested.quantity,
              effectiveUnitCostPiasters: requested.unitCostPiasters,
            };
          }),
        });
        if (applied.every((line) => line.quantityDelta === 0 && line.unitCostDeltaPiasters === 0)) {
          throw new ReceivingValidationError("لا توجد تغييرات لتسجيلها في إذن الاستلام.");
        }
        const receiptLineByBatch = new Map(record.lines.map((line) => [line.batchId, line]));
        await tx.corrections.insert({
          id: crypto.randomUUID(),
          operationId: command.operationId,
          receiptId,
          revision: revision + 1,
          reason: command.reason,
          changedByStaffId: staff.id,
          changedAt: claimed.recordedAt,
          lines: applied.map((line) => {
            const receiptLine = receiptLineByBatch.get(line.batchId)!;
            return {
              lineId: receiptLine.id,
              previousQuantity: line.previousQuantity,
              previousUnitCostPiasters: line.previousUnitCostPiasters,
              effectiveQuantity: line.effectiveQuantity,
              effectiveUnitCostPiasters: line.effectiveUnitCostPiasters,
              remainingQuantity: line.remainingQuantity,
              allocatedQuantity: line.allocatedQuantity,
              quantityDelta: line.quantityDelta,
              unitCostDeltaPiasters: line.unitCostDeltaPiasters,
            };
          }),
        });
        await tx.inventory.bumpStockVersion();
        return { record, created: true, acceptedRevision: revision + 1 };
      });
      return {
        receipt: await hydrate(outcome.record, outcome.acceptedRevision),
        created: outcome.created,
      };
    },

    async list(auth: VerifiedAuth | null): Promise<ReceiptDto[]> {
      await requireManager(auth);
      const rows = await ports.receipts.list();
      return Promise.all(rows.map((row) => hydrate(row)));
    },

    async get(auth: VerifiedAuth | null, id: string): Promise<ReceiptDto> {
      await requireManager(auth);
      const receiptId = assertUuid(id, "إذن الاستلام غير موجود.");
      const record = await ports.receipts.getById(receiptId);
      if (!record) {
        throw new NotFoundError("إذن الاستلام غير موجود.");
      }
      return hydrate(record);
    },

    async getByOperation(auth: VerifiedAuth | null, operationId: string): Promise<ReceiptDto> {
      await requireManager(auth);
      const id = assertUuid(operationId, "معرّف العملية غير صالح.");
      const record = await ports.receipts.getByOperationId(id);
      if (!record) {
        throw new NotFoundError("لم يُحفظ إذن الاستلام بعد.");
      }
      return hydrate(record, 0);
    },
  };
}

function parseReceiptCorrection(input: unknown): {
  operationId: string;
  expectedRevision: number;
  reason: string;
  lines: Array<{ lineId: string; quantity: number; unitCostPiasters: number }>;
} {
  const body = expectObject(input, "بيانات تصحيح الاستلام غير صالحة.");
  assertAllowedKeys(body, new Set(["operationId", "expectedRevision", "reason", "lines"]), "بيانات تصحيح الاستلام غير صالحة.");
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new ReceivingValidationError("نسخة إذن الاستلام غير صالحة.");
  }
  if (typeof body.reason !== "string" || body.reason.trim().length === 0 || body.reason.trim().length > 500) {
    throw new ReceivingValidationError("سبب تصحيح الاستلام مطلوب.");
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new ReceivingValidationError("يجب إدخال كل أصناف إذن الاستلام.");
  }
  return {
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    expectedRevision: body.expectedRevision as number,
    reason: body.reason.trim(),
    lines: body.lines.map((item) => {
      const line = expectObject(item, "بيانات صنف التصحيح غير صالحة.");
      assertAllowedKeys(line, new Set(["lineId", "quantity", "unitCostPiasters"]), "بيانات صنف التصحيح غير صالحة.");
      return {
        lineId: assertUuid(line.lineId, "صنف التصحيح غير موجود."),
        quantity: assertEffectiveQuantity(line.quantity),
        unitCostPiasters: assertPiasters(line.unitCostPiasters, "تكلفة الشراء الفعالة غير صالحة."),
      };
    }),
  };
}

function assertExactCorrectionLines(
  receipt: ReceiptRecord,
  lines: Array<{ lineId: string }>,
): void {
  if (lines.length !== receipt.lines.length || new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    throw new ReceivingValidationError("يجب إدخال كل أصناف إذن الاستلام مرة واحدة.");
  }
  const expected = new Set(receipt.lines.map((line) => line.id));
  if (lines.some((line) => !expected.has(line.lineId))) {
    throw new ReceivingValidationError("صنف التصحيح غير موجود في إذن الاستلام.");
  }
}

function assertEffectiveQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0)
    || value < 0 || value > 1_000_000) {
    throw new ReceivingValidationError("كمية الاستلام الفعالة غير صالحة.");
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

function parseReceiptWrite(input: unknown): {
  operationId: string;
  branchId: string;
  receiptDate: string;
  lines: Array<{ variantId: string; quantity: number; unitCostPiasters: number }>;
} {
  const body = expectObject(input, "بيانات الاستلام غير صالحة.");
  assertAllowedKeys(body, RECEIPT_KEYS, "بيانات الاستلام غير صالحة.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new ReceivingValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  return {
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    branchId: assertUuid(body.branchId, "فرع الاستلام غير صالح."),
    receiptDate: assertCairoDate(body.receiptDate),
    lines: body.lines.map((item) => {
      const line = expectObject(item, "بيانات صنف الاستلام غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف الاستلام غير صالحة.");
      return {
        variantId: assertUuid(line.variantId, "المتغير المحدد غير موجود."),
        quantity: assertQuantity(line.quantity, "الكمية غير صالحة."),
        unitCostPiasters: assertPiasters(line.unitCostPiasters, "تكلفة الشراء غير صالحة."),
      };
    }),
  };
}

function assertCairoDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new ReceivingValidationError("تاريخ الاستلام غير صالح.");
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new ReceivingValidationError("تاريخ الاستلام غير صالح.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ReceivingValidationError("تاريخ الاستلام غير صالح.");
  }
  return value;
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReceivingValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ReceivingValidationError(messageAr);
    }
  }
}

function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ReceivingValidationError(messageAr);
  }
  return value;
}
