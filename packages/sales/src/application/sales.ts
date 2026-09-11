import type { BranchDto, ManagerSaleDto, SaleDto, SaleLineDto } from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
  capabilitiesFor,
} from "@bravos/identity";
import {
  OperationConflictError,
  assertPiasters,
  assertQuantity,
  type AllocateResult,
  type AllocationRecord,
} from "@bravos/inventory";
import { mergeVariantQuantities, priceSaleLines } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import { fingerprintSalePayload, type SalePayload } from "../domain/fingerprint.ts";
import type {
  CompleteSaleResult,
  ListedPriceReader,
  PrepareSaleResult,
  SaleInsert,
  SaleLineWrite,
  SaleRecord,
  SalesActorPort,
  SalesUnitOfWork,
  SaleStore,
  VerifiedAuth,
} from "./ports.ts";

const PREPARE_KEYS = new Set([
  "saleId",
  "operationId",
  "customerName",
  "customerPhone",
  "employeeDiscountPiasters",
  "discountReason",
  "occurredAt",
  "lines",
]);
const COMPLETE_KEYS = new Set([...PREPARE_KEYS, "physicallyCompleted"]);
const LINE_KEYS = new Set(["variantId", "quantity"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCREPANCY_MESSAGE = "لم تُخصص كل الكمية من المخزون المسجّل.";

export type SalesServices = ReturnType<typeof createSalesServices>;

export function createSalesServices(ports: {
  actors: SalesActorPort;
  prices: ListedPriceReader;
  sales: SaleStore;
  uow: SalesUnitOfWork;
  allocations: { listAllocations(operationId: string): Promise<AllocationRecord[]> };
}) {
  async function requireCashier(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    const branchId = await ports.actors.getSessionBranch(auth.sessionId);
    if (!branchId || !capabilitiesFor(staff, branchId).cashier) {
      throw new ForbiddenError();
    }
    const branches = await ports.actors.listBranches();
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) {
      throw new ForbiddenError();
    }
    return { staff, branch };
  }

  async function requireStaff(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    return staff;
  }

  async function hydrate(record: SaleRecord, viewerIsManager: boolean): Promise<SaleDto | ManagerSaleDto> {
    const branches = await ports.actors.listBranches();
    const branch = branches.find((item) => item.id === record.branchId);
    if (!branch) {
      throw new SalesValidationError("فرع البيع غير موجود.");
    }
    const identities = await ports.prices.getListedPrices(record.lines.map((line) => line.variantId));
    const byId = new Map(identities.map((item) => [item.variantId, item.identity]));
    const unallocatedQuantity = record.lines.reduce((sum, line) => sum + line.unallocatedQuantity, 0);
    const sale: SaleDto = {
      id: record.id,
      operationId: record.operationId,
      branch,
      soldByStaffId: record.soldByStaffId,
      soldByDisplayName: record.soldByDisplayName,
      occurredAt: record.occurredAt.toISOString(),
      recordedAt: record.recordedAt ? record.recordedAt.toISOString() : null,
      customerName: record.customerName,
      customerPhone: record.customerPhone,
      originalTotalPiasters: record.originalTotalPiasters,
      employeeDiscountPiasters: record.employeeDiscountPiasters,
      discountReason: record.discountReason,
      discountedByStaffId: record.discountedByStaffId,
      finalTotalPiasters: record.finalTotalPiasters,
      physicallyCompleted: record.physicallyCompleted,
      discrepancy:
        unallocatedQuantity > 0
          ? { unallocatedQuantity, messageAr: DISCREPANCY_MESSAGE }
          : null,
      lines: record.lines.map((line) => toLineDto(line, byId.get(line.variantId))),
    };
    if (!viewerIsManager) {
      return sale;
    }
    const allocations = record.physicallyCompleted
      ? (await ports.allocations.listAllocations(record.operationId)).map((item) => ({
          batchId: item.batchId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitCostPiasters: item.unitCostPiasters,
        }))
      : [];
    return { ...sale, allocations, costsIncomplete: record.costsIncomplete };
  }

  function canRead(staff: Awaited<ReturnType<typeof requireStaff>>, record: SaleRecord): boolean {
    if (isManager(staff)) {
      return true;
    }
    const authorized = staff.grants
      .filter((grant) => grant.cashier || grant.orderRepresentative)
      .map((grant) => grant.branchId);
    return record.soldByStaffId === staff.id && authorized.includes(record.branchId);
  }

  function canCashierOn(staff: Awaited<ReturnType<typeof requireStaff>>, branchId: string): boolean {
    return capabilitiesFor(staff, branchId).cashier;
  }

  function assertCanRead(staff: Awaited<ReturnType<typeof requireStaff>>, record: SaleRecord) {
    if (!canRead(staff, record)) {
      throw new ForbiddenError();
    }
  }

  function replayOrConflict(record: SaleRecord, fingerprint: string, operationId: string) {
    if (record.payloadFingerprint !== fingerprint || record.operationId !== operationId) {
      throw new OperationConflictError();
    }
  }

  return {
    async prepare(auth: VerifiedAuth | null, input: unknown): Promise<PrepareSaleResult> {
      const current = await requireCashier(auth);
      const command = parseSaleWrite(input, false);
      const fingerprint = fingerprintSalePayload(toPayload(command));
      const quantities = mergeVariantQuantities(command.lines);
      const listed = await ports.prices.getListedPrices(quantities.map((item) => item.variantId));
      const outcome = await ports.uow.run(async (tx) => {
        const existing = await loadLockedIdentity(tx.sales, command.saleId, command.operationId);
        if (existing) {
          replayOrConflict(existing, fingerprint, command.operationId);
          assertCanRead(current.staff, existing);
          return { record: existing, created: false };
        }
        const available = await tx.inventory.quantitiesFor(quantities.map((item) => item.variantId));
        for (const item of quantities) {
          if ((available.get(item.variantId) ?? 0) < item.quantity) {
            throw new SalesValidationError("الكمية المتاحة غير كافية.");
          }
        }
        const priced = priceFromListed(listed, quantities, command.employeeDiscountPiasters);
        const inserted = await tx.sales.insert(
          toInsert(command, current, priced.lines, fingerprint, {
            physicallyCompleted: false,
            recordedAt: null,
            costsIncomplete: false,
          }),
        );
        if (inserted.kind === "existing") {
          replayOrConflict(inserted.record, fingerprint, command.operationId);
          assertCanRead(current.staff, inserted.record);
          return { record: inserted.record, created: false };
        }
        return { record: inserted.record, created: true };
      });
      return { sale: await hydrate(outcome.record, isManager(current.staff)), created: outcome.created };
    },

    async complete(auth: VerifiedAuth | null, input: unknown): Promise<CompleteSaleResult> {
      const actor = await requireStaff(auth);
      if (!auth) {
        throw new UnauthenticatedError();
      }
      const sessionBranchId = await ports.actors.getSessionBranch(auth.sessionId);
      const branches = await ports.actors.listBranches();
      const command = parseSaleWrite(input, true);
      const fingerprint = fingerprintSalePayload(toPayload(command));
      const quantities = mergeVariantQuantities(command.lines);
      const listed = await ports.prices.getListedPrices(quantities.map((item) => item.variantId));
      const outcome = await ports.uow.run(async (tx) => {
        const existing = await loadLockedIdentity(tx.sales, command.saleId, command.operationId);
        if (existing?.physicallyCompleted) {
          replayOrConflict(existing, fingerprint, command.operationId);
          assertCanRead(actor, existing);
          return { record: existing, created: false };
        }
        if (existing) {
          replayOrConflict(existing, fingerprint, command.operationId);
          assertCanRead(actor, existing);
          if (!canCashierOn(actor, existing.branchId)) {
            throw new ForbiddenError();
          }
        } else {
          if (!sessionBranchId || !canCashierOn(actor, sessionBranchId)) {
            throw new ForbiddenError();
          }
        }
        const prepared = Boolean(existing && !existing.physicallyCompleted);
        const allowPartial = prepared;
        const currentBranch = branches.find((item) => item.id === (existing?.branchId ?? sessionBranchId));
        if (!currentBranch) {
          throw new ForbiddenError();
        }
        const seller = existing
          ? { id: existing.soldByStaffId, displayName: existing.soldByDisplayName }
          : actor;

        const claimed = await tx.inventory.claimSaleOperation({
          operationId: command.operationId,
          payloadFingerprint: fingerprint,
          actorStaffId: seller.id,
        });
        if (claimed.kind === "replay") {
          const replayed = await tx.sales.getByOperationId(command.operationId);
          if (!replayed) {
            throw new SalesValidationError("تعذر العثور على البيع الأصلي.");
          }
          replayOrConflict(replayed, fingerprint, command.operationId);
          assertCanRead(actor, replayed);
          return { record: replayed, created: false };
        }

        if (!prepared) {
          const listedIds = new Set(listed.map((row) => row.variantId));
          if (quantities.some((item) => !listedIds.has(item.variantId))) {
            throw new SalesValidationError("المتغير المحدد غير موجود.");
          }
        }
        const sourceLines =
          prepared && existing
            ? existing.lines.map((line) => ({
                id: line.id,
                variantId: line.variantId,
                quantity: line.quantity,
              }))
            : quantities.map((line) => ({
                id: crypto.randomUUID(),
                variantId: line.variantId,
                quantity: line.quantity,
              }));
        const occurredAt = command.occurredAt ?? claimed.recordedAt;
        let costsIncomplete = false;
        const allocations: AllocateResult[] = [];
        for (const line of sourceLines) {
          const allocated = await tx.inventory.allocateFromOldestAvailable({
            operationId: command.operationId,
            variantId: line.variantId,
            quantity: line.quantity,
            recordedAt: claimed.recordedAt,
            allowPartial,
          });
          if (allocated.unallocatedQuantity > 0) {
            costsIncomplete = true;
            await tx.inventory.recordDiscrepancy({
              operationId: command.operationId,
              variantId: line.variantId,
              requestedQuantity: line.quantity,
              allocatedQuantity: allocated.allocatedQuantity,
              recordedAt: claimed.recordedAt,
            });
          }
          allocations.push(allocated);
        }
        const priced = prepared && existing
          ? {
              lines: existing.lines.map((line) => ({
                variantId: line.variantId,
                quantity: line.quantity,
                listedUnitPricePiasters: line.listedUnitPricePiasters,
                originalPiasters: line.originalPiasters,
                discountPiasters: line.discountPiasters,
                paidPiasters: line.paidPiasters,
                units: line.units.map((unit) => ({
                  listedPiasters: unit.listedPiasters,
                  discountPiasters: unit.discountPiasters,
                  paidPiasters: unit.paidPiasters,
                })),
              })),
            }
          : priceFromListed(listed, quantities, command.employeeDiscountPiasters);
        const completedLines: SaleLineWrite[] = priced.lines.map((line, index) => {
          const allocated = allocations[index];
          return {
            id: sourceLines[index]?.id ?? crypto.randomUUID(),
            variantId: line.variantId,
            quantity: line.quantity,
            listedUnitPricePiasters: line.listedUnitPricePiasters,
            originalPiasters: line.originalPiasters,
            discountPiasters: line.discountPiasters,
            paidPiasters: line.paidPiasters,
            allocatedQuantity: allocated?.allocatedQuantity ?? 0,
            unallocatedQuantity: allocated?.unallocatedQuantity ?? line.quantity,
            lineIndex: index,
            units: line.units.map((unit, unitIndex) => ({
              unitIndex,
              listedPiasters: unit.listedPiasters,
              discountPiasters: unit.discountPiasters,
              paidPiasters: unit.paidPiasters,
            })),
          };
        });

        if (prepared && existing) {
          const record = await tx.sales.updateCompletion({
            id: existing.id,
            occurredAt,
            recordedAt: claimed.recordedAt,
            costsIncomplete,
            lines: completedLines,
          });
          return { record, created: true };
        }
        const inserted = await tx.sales.insert(
          toInsert(
            command,
            { staff: seller, branch: currentBranch },
            priced.lines,
            fingerprint,
            {
              physicallyCompleted: true,
              recordedAt: claimed.recordedAt,
              costsIncomplete,
              completedLines,
              occurredAt,
            },
          ),
        );
        if (inserted.kind === "existing") {
          replayOrConflict(inserted.record, fingerprint, command.operationId);
          assertCanRead(actor, inserted.record);
          return { record: inserted.record, created: false };
        }
        return { record: inserted.record, created: true };
      });
      return { sale: await hydrate(outcome.record, isManager(actor)), created: outcome.created };
    },

    async list(auth: VerifiedAuth | null): Promise<Array<SaleDto | ManagerSaleDto>> {
      const staff = await requireStaff(auth);
      const rows = isManager(staff)
        ? await ports.sales.listCompleted()
        : await ports.sales.listCompletedForStaff(
            staff.id,
            staff.grants.filter((grant) => grant.cashier || grant.orderRepresentative).map((grant) => grant.branchId),
          );
      return Promise.all(rows.map((row) => hydrate(row, isManager(staff))));
    },

    async get(auth: VerifiedAuth | null, id: string): Promise<SaleDto | ManagerSaleDto> {
      const staff = await requireStaff(auth);
      const saleId = assertUuid(id, "البيع غير موجود.");
      const record = await ports.sales.getById(saleId);
      if (!record?.physicallyCompleted) {
        throw new NotFoundError("البيع غير موجود.");
      }
      if (!canRead(staff, record)) {
        throw new ForbiddenError();
      }
      return hydrate(record, isManager(staff));
    },

    async getByOperation(auth: VerifiedAuth | null, operationId: string): Promise<SaleDto | ManagerSaleDto> {
      const staff = await requireStaff(auth);
      const id = assertUuid(operationId, "معرّف العملية غير صالح.");
      const record = await ports.sales.getByOperationId(id);
      if (!record) {
        throw new NotFoundError("لم يُحفظ البيع بعد.");
      }
      if (!canRead(staff, record)) {
        throw new ForbiddenError();
      }
      return hydrate(record, isManager(staff));
    },

    referencedVariantIds(variantIds: string[]) {
      return ports.sales.referencedVariantIds(variantIds);
    },
  };
}

async function loadLockedIdentity(sales: SaleStore, saleId: string, operationId: string) {
  await sales.lockIdentities(saleId, operationId);
  const existing = await sales.getById(saleId);
  const byOperation = await sales.getByOperationId(operationId);
  if (existing && existing.operationId !== operationId) {
    throw new OperationConflictError();
  }
  if (byOperation && byOperation.id !== saleId) {
    throw new OperationConflictError();
  }
  return existing ?? byOperation;
}

function priceFromListed(
  listed: Awaited<ReturnType<ListedPriceReader["getListedPrices"]>>,
  quantities: Array<{ variantId: string; quantity: number }>,
  employeeDiscountPiasters: number,
) {
  const byId = new Map(listed.map((row) => [row.variantId, row.listedUnitPricePiasters]));
  const missing = quantities.filter((line) => !byId.has(line.variantId));
  if (missing.length > 0) {
    throw new SalesValidationError("المتغير المحدد غير موجود.");
  }
  return priceSaleLines(
    quantities.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: byId.get(line.variantId) ?? 0,
    })),
    employeeDiscountPiasters,
  );
}

function toInsert(
  command: ParsedSale,
  actor: { staff: { id: string; displayName: string }; branch: { id: string } },
  pricedLines: ReturnType<typeof priceSaleLines>["lines"],
  fingerprint: string,
  options: {
    physicallyCompleted: boolean;
    recordedAt: Date | null;
    costsIncomplete: boolean;
    completedLines?: SaleLineWrite[];
    occurredAt?: Date;
  },
): SaleInsert {
  const originalTotalPiasters = pricedLines.reduce((sum, line) => sum + line.originalPiasters, 0);
  const lines =
    options.completedLines ??
    pricedLines.map((line, index) => ({
      id: crypto.randomUUID(),
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: line.listedUnitPricePiasters,
      originalPiasters: line.originalPiasters,
      discountPiasters: line.discountPiasters,
      paidPiasters: line.paidPiasters,
      allocatedQuantity: 0,
      unallocatedQuantity: 0,
      lineIndex: index,
      units: line.units.map((unit, unitIndex) => ({
        unitIndex,
        listedPiasters: unit.listedPiasters,
        discountPiasters: unit.discountPiasters,
        paidPiasters: unit.paidPiasters,
      })),
    }));
  return {
    id: command.saleId,
    operationId: command.operationId,
    branchId: actor.branch.id,
    soldByStaffId: actor.staff.id,
    soldByDisplayName: actor.staff.displayName,
    discountedByStaffId: command.employeeDiscountPiasters > 0 ? actor.staff.id : null,
    occurredAt: options.occurredAt ?? command.occurredAt ?? options.recordedAt ?? new Date(),
    recordedAt: options.recordedAt,
    customerName: command.customerName,
    customerPhone: command.customerPhone,
    originalTotalPiasters,
    employeeDiscountPiasters: command.employeeDiscountPiasters,
    discountReason: command.discountReason,
    finalTotalPiasters: originalTotalPiasters - command.employeeDiscountPiasters,
    payloadFingerprint: fingerprint,
    physicallyCompleted: options.physicallyCompleted,
    costsIncomplete: options.costsIncomplete,
    lines,
  };
}

function toPayload(command: ParsedSale): SalePayload {
  return {
    saleId: command.saleId,
    customerName: command.customerName,
    customerPhone: command.customerPhone,
    employeeDiscountPiasters: command.employeeDiscountPiasters,
    discountReason: command.discountReason,
    lines: command.lines,
  };
}

function toLineDto(line: SaleLineWrite, variant: SaleLineDto["variant"] | undefined): SaleLineDto {
  if (!variant) {
    throw new SalesValidationError("المتغير المحدد غير موجود.");
  }
  return {
    id: line.id,
    variantId: line.variantId,
    quantity: line.quantity,
    listedUnitPricePiasters: line.listedUnitPricePiasters,
    originalPiasters: line.originalPiasters,
    discountPiasters: line.discountPiasters,
    paidPiasters: line.paidPiasters,
    allocatedQuantity: line.allocatedQuantity,
    unallocatedQuantity: line.unallocatedQuantity,
    units: line.units.map((unit) => ({
      listedPiasters: unit.listedPiasters,
      discountPiasters: unit.discountPiasters,
      paidPiasters: unit.paidPiasters,
    })),
    variant,
  };
}

type ParsedSale = {
  saleId: string;
  operationId: string;
  physicallyCompleted: boolean;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  occurredAt: Date | null;
  lines: Array<{ variantId: string; quantity: number }>;
};

function parseSaleWrite(input: unknown, complete: boolean): ParsedSale {
  const body = expectObject(input, "بيانات البيع غير صالحة.");
  assertAllowedKeys(body, complete ? COMPLETE_KEYS : PREPARE_KEYS, "بيانات البيع غير صالحة.");
  if (complete && body.physicallyCompleted !== true) {
    throw new SalesValidationError("يجب تأكيد تسليم البضاعة والدفع.");
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new SalesValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  return {
    saleId: assertUuid(body.saleId, "معرّف البيع غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    physicallyCompleted: complete,
    customerName: parseOptionalText(body.customerName, 120, "اسم الزبون غير صالح."),
    customerPhone: parseOptionalText(body.customerPhone, 40, "هاتف الزبون غير صالح."),
    employeeDiscountPiasters: assertPiasters(body.employeeDiscountPiasters, "قيمة الخصم غير صالحة."),
    discountReason: parseOptionalText(body.discountReason, 200, "سبب الخصم غير صالح."),
    occurredAt: parseOptionalTime(body.occurredAt),
    lines: body.lines.map((item) => {
      const line = expectObject(item, "بيانات صنف البيع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف البيع غير صالحة.");
      return {
        variantId: assertUuid(line.variantId, "المتغير المحدد غير موجود."),
        quantity: assertQuantity(line.quantity, "الكمية غير صالحة."),
      };
    }),
  };
}

function parseOptionalText(value: unknown, max: number, messageAr: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new SalesValidationError(messageAr);
  }
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > max) {
    throw new SalesValidationError(messageAr);
  }
  return trimmed;
}

function parseOptionalTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new SalesValidationError("وقت حدوث البيع غير صالح.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SalesValidationError("وقت حدوث البيع غير صالح.");
  }
  return parsed;
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SalesValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new SalesValidationError(messageAr);
    }
  }
}

function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new SalesValidationError(messageAr);
  }
  return value;
}
