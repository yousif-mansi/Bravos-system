import type { ReceiptDto } from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
} from "@bravos/identity";
import { assertPiasters, assertQuantity } from "@bravos/inventory";
import { ReceivingValidationError } from "../domain/errors.ts";
import type {
  FinalizeReceiptResult,
  ReceiptLineWrite,
  ReceiptRecord,
  ReceivingActorPort,
  ReceivingUnitOfWork,
  ReceiptStore,
  VariantIdentityReader,
  VerifiedAuth,
} from "./ports.ts";

const RECEIPT_KEYS = new Set(["operationId", "receiptDate", "lines"]);
const LINE_KEYS = new Set(["variantId", "quantity", "unitCostPiasters"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ReceivingServices = ReturnType<typeof createReceivingServices>;

export function createReceivingServices(ports: {
  actors: ReceivingActorPort;
  variants: VariantIdentityReader;
  receipts: ReceiptStore;
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

  async function hydrate(record: ReceiptRecord): Promise<ReceiptDto> {
    const identities = await ports.variants.getVariants(record.lines.map((line) => line.variantId));
    const byId = new Map(identities.map((item) => [item.id, item]));
    return {
      id: record.id,
      operationId: record.operationId,
      receiptDate: record.receiptDate,
      receivedByStaffId: record.receivedByStaffId,
      recordedAt: record.recordedAt.toISOString(),
      lines: record.lines.map((line) => {
        const variant = byId.get(line.variantId);
        if (!variant) {
          throw new ReceivingValidationError("المتغير المحدد غير موجود.");
        }
        return {
          id: line.id,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostPiasters: line.unitCostPiasters,
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
        const claimed = await tx.inventory.claimReceiveOperation({
          operationId: command.operationId,
          payload: { receiptDate: command.receiptDate, lines: command.lines },
          actorStaffId: staff.id,
        });
        if (claimed.kind === "replay") {
          const existing = await tx.receipts.getByOperationId(command.operationId);
          if (!existing) {
            throw new ReceivingValidationError("تعذر العثور على إذن الاستلام الأصلي.");
          }
          return { record: existing, created: false };
        }

        const receiptId = crypto.randomUUID();
        const prepared = command.lines.map((line) => ({
          ...line,
          id: crypto.randomUUID(),
        }));
        const batches = await tx.inventory.receiveBatches({
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
          operationId: command.operationId,
          receiptDate: command.receiptDate,
          receivedByStaffId: staff.id,
          recordedAt: claimed.recordedAt,
          lines,
        });
        return { record, created: true };
      });
      return { receipt: await hydrate(outcome.record), created: outcome.created };
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
      return hydrate(record);
    },
  };
}

function parseReceiptWrite(input: unknown): {
  operationId: string;
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
