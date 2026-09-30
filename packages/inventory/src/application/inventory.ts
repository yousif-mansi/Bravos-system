import type {
  CountCoordinationDto,
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  StockCorrectionDto,
  StockReconciliationCaseDto,
  StockReconciliationDto,
  VariantLowStockDto,
} from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  UnauthenticatedError,
} from "@bravos/identity";
import { InventoryValidationError } from "../domain/errors.ts";
import { assertQuantity, assertThreshold } from "../domain/money.ts";
import type {
  InventoryActorPort,
  CountCoordinationRecord,
  InventoryReadStore,
  InventoryServices,
  StockCoordinationStore,
  StockCorrectionRecord,
  VariantIdentityReader,
  VerifiedAuth,
} from "./ports.ts";

const SETTINGS_KEYS = new Set(["lowStockThreshold"]);
const VARIANT_THRESHOLD_KEYS = new Set(["lowStockThreshold"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInventoryServices(ports: {
  store: InventoryReadStore;
  actors: InventoryActorPort;
  variants: VariantIdentityReader;
  coordination: StockCoordinationStore;
}): InventoryServices {
  async function requireStaff(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    return staff;
  }

  async function requireManager(auth: VerifiedAuth | null) {
    const staff = await requireStaff(auth);
    if (!isManager(staff)) {
      throw new ForbiddenError();
    }
    return staff;
  }

  async function hydrateVariants(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await ports.variants.getVariants(unique);
    const byId = new Map(found.map((item) => [item.id, item]));
    return byId;
  }

  async function staffSummary(staffId: string) {
    const staff = await ports.actors.getStaff(staffId);
    if (!staff) throw new InventoryValidationError("المستخدم المسؤول غير موجود.");
    return {
      id: staff.id,
      loginName: staff.loginName,
      displayName: staff.displayName,
      role: staff.role,
      disabled: staff.disabled,
    };
  }

  async function hydrateCoordination(record: CountCoordinationRecord) {
    return {
      id: record.id,
      operationId: record.operationId,
      status: record.status,
      boundaryStockVersion: record.boundaryStockVersion,
      boundaryAt: record.boundaryAt,
      expiresAt: record.expiresAt,
      startedBy: await staffSummary(record.startedByStaffId),
      finishedBy: record.finishedByStaffId ? await staffSummary(record.finishedByStaffId) : null,
      finishedAt: record.finishedAt,
      devices: record.devices,
    } satisfies CountCoordinationDto;
  }

  async function hydrateCorrection(record: StockCorrectionRecord) {
    const variants = await hydrateVariants([record.variantId]);
    const variant = variants.get(record.variantId);
    if (!variant) throw new InventoryValidationError("المتغير المحدد غير موجود.");
    return {
      id: record.id,
      branchId: record.branchId,
      operationId: record.operationId,
      coordinationId: record.coordinationId,
      variantId: record.variantId,
      variant,
      previousAvailableQuantity: record.previousAvailableQuantity,
      correctedAvailableQuantity: record.correctedAvailableQuantity,
      quantityDelta: record.quantityDelta,
      reason: record.reason,
      positiveSourceBatchId: record.positiveSourceBatchId,
      changedBy: await staffSummary(record.changedByStaffId),
      changedAt: record.changedAt,
      boundaryStockVersion: record.boundaryStockVersion,
      coordinationBoundaryAt: record.coordinationBoundaryAt,
      boundaryAt: record.boundaryAt,
      devices: record.devices,
      batches: record.batches,
    } satisfies StockCorrectionDto;
  }

  return {
    quantitiesFor(branchId, variantIds) {
      return ports.store.quantitiesFor(branchId, variantIds);
    },

    quantitiesByBranchFor(variantIds) {
      return ports.store.quantitiesByBranchFor(variantIds);
    },

    referencedVariantIds(variantIds) {
      return ports.store.referencedVariantIds(variantIds);
    },

    async listBatches(auth) {
      await requireManager(auth);
      const rows = await ports.store.listBatches();
      const variants = await hydrateVariants(rows.map((row) => row.variantId));
      return rows.map((row) => toBatchDto(row, variants.get(row.variantId)));
    },

    async listLowStock(auth) {
      await requireManager(auth);
      const [ids, branchIds, settings, overrides] = await Promise.all([
        ports.variants.listIds(),
        ports.store.listBranchIds(),
        ports.store.getSettings(),
        ports.store.listVariantThresholds(),
      ]);
      const quantities = await ports.store.quantitiesByBranchFor(ids);
      const low: Array<Omit<LowStockVariantDto, "variant">> = [];
      for (const branchId of branchIds) for (const variantId of ids) {
        const availableQuantity = quantities.get(branchId)?.get(variantId) ?? 0;
        const override = overrides.get(variantId);
        const threshold = override ?? settings.lowStockThreshold;
        if (availableQuantity > threshold) {
          continue;
        }
        low.push({
          branchId,
          variantId,
          availableQuantity,
          threshold,
          thresholdSource: override === undefined || override === null ? "global" : "variant",
        });
      }
      const variants = await hydrateVariants(low.map((row) => row.variantId));
      return low.map((row) => {
        const variant = variants.get(row.variantId);
        if (!variant) {
          throw new InventoryValidationError("المتغير المحدد غير موجود.");
        }
        return { ...row, variant };
      });
    },

    async getSettings(auth) {
      await requireManager(auth);
      const settings = await ports.store.getSettings();
      return { lowStockThreshold: settings.lowStockThreshold };
    },

    async updateSettings(auth, input) {
      const staff = await requireManager(auth);
      const body = expectObject(input, "بيانات إعداد المخزون غير صالحة.");
      assertAllowedKeys(body, SETTINGS_KEYS, "بيانات إعداد المخزون غير صالحة.");
      const lowStockThreshold = assertThreshold(body.lowStockThreshold, "حد التنبيه غير صالح.");
      const settings = await ports.store.updateSettings(lowStockThreshold, staff.id);
      return { lowStockThreshold: settings.lowStockThreshold };
    },

    async setVariantThreshold(auth, variantId, input) {
      const staff = await requireManager(auth);
      const id = assertUuid(variantId, "المتغير المحدد غير موجود.");
      const identities = await ports.variants.getVariants([id]);
      if (!identities[0]) {
        throw new InventoryValidationError("المتغير المحدد غير موجود.");
      }
      const body = expectObject(input, "بيانات حد التنبيه غير صالحة.");
      assertAllowedKeys(body, VARIANT_THRESHOLD_KEYS, "بيانات حد التنبيه غير صالحة.");
      if (body.lowStockThreshold === null) {
        return ports.store.clearVariantThreshold(id, staff.id);
      }
      const threshold = assertThreshold(body.lowStockThreshold, "حد التنبيه غير صالح.");
      return ports.store.upsertVariantThreshold(id, threshold, staff.id);
    },

    async currentCoordination(auth) {
      await requireManager(auth);
      const record = await ports.coordination.current();
      return record ? hydrateCoordination(record) : null;
    },

    async currentStockPause(auth) {
      await requireStaff(auth);
      const record = await ports.coordination.current();
      if (!record || record.status !== "active" || new Date(record.expiresAt).getTime() <= Date.now()) return null;
      return {
        coordinationId: record.id,
        boundaryStockVersion: record.boundaryStockVersion,
        boundaryAt: record.boundaryAt,
        expiresAt: record.expiresAt,
      };
    },

    async acknowledgeCoordination(auth, input) {
      const staff = await requireStaff(auth);
      const body = expectObject(input, "بيانات تأكيد نقطة البيع غير صالحة.");
      assertAllowedKeys(body, new Set(["coordinationId", "deviceId", "snapshotId"]), "بيانات تأكيد نقطة البيع غير صالحة.");
      return ports.coordination.acknowledge({
        coordinationId: assertUuid(body.coordinationId, "تنسيق العد غير موجود."),
        deviceId: assertUuid(body.deviceId, "معرّف الجهاز غير صالح."),
        snapshotId: assertUuid(body.snapshotId, "لقطة المزامنة غير موجودة."),
        actorStaffId: staff.id,
      });
    },

    async startCoordination(auth, input) {
      const manager = await requireManager(auth);
      const body = expectObject(input, "بيانات تنسيق العد غير صالحة.");
      assertAllowedKeys(body, new Set(["operationId"]), "بيانات تنسيق العد غير صالحة.");
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const payloadFingerprint = await sha256(JSON.stringify({ target: "count-coordination", operationId, actorStaffId: manager.id }));
      const result = await ports.coordination.start({
        id: crypto.randomUUID(),
        operationId,
        payloadFingerprint,
        actorStaffId: manager.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      return { value: await hydrateCoordination(result.value), created: result.created };
    },

    async cancelCoordination(auth, input) {
      const manager = await requireManager(auth);
      const body = expectObject(input, "بيانات إلغاء التنسيق غير صالحة.");
      assertAllowedKeys(body, new Set(["operationId", "coordinationId"]), "بيانات إلغاء التنسيق غير صالحة.");
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const coordinationId = assertUuid(body.coordinationId, "تنسيق العد غير موجود.");
      const payloadFingerprint = await sha256(JSON.stringify({ target: "cancel-count-coordination", operationId, coordinationId, actorStaffId: manager.id }));
      return hydrateCoordination(await ports.coordination.cancel({
        operationId,
        coordinationId,
        payloadFingerprint,
        actorStaffId: manager.id,
      }));
    },

    async finalizeStockCorrection(auth, input) {
      const manager = await requireManager(auth);
      const body = expectObject(input, "بيانات تصحيح الكمية غير صالحة.");
      assertAllowedKeys(
        body,
        new Set(["operationId", "coordinationId", "branchId", "variantId", "previousAvailableQuantity", "correctedAvailableQuantity", "reason", "positiveSourceBatchId"]),
        "بيانات تصحيح الكمية غير صالحة.",
      );
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const coordinationId = assertUuid(body.coordinationId, "تنسيق العد غير موجود.");
      const branchId = assertUuid(body.branchId, "فرع التصحيح غير صالح.");
      const variantId = assertUuid(body.variantId, "المتغير المحدد غير موجود.");
      const previousAvailableQuantity = assertThreshold(body.previousAvailableQuantity, "الكمية السابقة غير صالحة.");
      const correctedAvailableQuantity = assertThreshold(body.correctedAvailableQuantity, "الكمية المصححة غير صالحة.");
      const reason = assertReason(body.reason);
      const positiveSourceBatchId = body.positiveSourceBatchId === undefined || body.positiveSourceBatchId === null
        ? null
        : assertUuid(body.positiveSourceBatchId, "دفعة التكلفة المحددة غير موجودة.");
      if (!(await ports.variants.getVariants([variantId]))[0]) throw new InventoryValidationError("المتغير المحدد غير موجود.");
      const payloadFingerprint = await sha256(JSON.stringify({
        target: "stock-correction",
        operationId,
        coordinationId,
        branchId,
        variantId,
        previousAvailableQuantity,
        correctedAvailableQuantity,
        reason,
        positiveSourceBatchId,
        actorStaffId: manager.id,
      }));
      const result = await ports.coordination.finalize({
        id: crypto.randomUUID(),
        operationId,
        payloadFingerprint,
        coordinationId,
        branchId,
        variantId,
        previousAvailableQuantity,
        correctedAvailableQuantity,
        reason,
        positiveSourceBatchId,
        actorStaffId: manager.id,
      });
      return { value: await hydrateCorrection(result.value), created: result.created };
    },

    async listStockCorrections(auth) {
      await requireManager(auth);
      return Promise.all((await ports.coordination.listCorrections()).map(hydrateCorrection));
    },

    async listStockReconciliations(auth) {
      await requireManager(auth);
      const rows = await ports.coordination.listReconciliations();
      return Promise.all(rows.map(async ({ resolvedByStaffId, ...row }) => ({
        ...row,
        resolvedBy: await staffSummary(resolvedByStaffId),
      } satisfies StockReconciliationDto)));
    },

    async listStockReconciliationCases(auth) {
      await requireManager(auth);
      return ports.coordination.listReconciliationCases() as Promise<StockReconciliationCaseDto[]>;
    },

    async reconcileLateSale(auth, input) {
      const manager = await requireManager(auth);
      const body = expectObject(input, "بيانات مصالحة البيع المتأخر غير صالحة.");
      assertAllowedKeys(
        body,
        new Set(["operationId", "correctionId", "saleId", "branchId", "variantId", "resolution", "quantity"]),
        "بيانات مصالحة البيع المتأخر غير صالحة.",
      );
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const correctionId = assertUuid(body.correctionId, "تصحيح الكمية المحدد غير موجود.");
      const saleId = assertUuid(body.saleId, "البيع المحدد غير موجود.");
      const branchId = assertUuid(body.branchId, "فرع المصالحة غير صالح.");
      const variantId = assertUuid(body.variantId, "المتغير المحدد غير موجود.");
      const resolution = assertReconciliationResolution(body.resolution);
      const quantity = assertQuantity(body.quantity, "كمية المصالحة غير صالحة.");
      const payloadFingerprint = await sha256(JSON.stringify({
        target: "stock-reconciliation",
        operationId,
        correctionId,
        saleId,
        branchId,
        variantId,
        resolution,
        quantity,
        actorStaffId: manager.id,
      }));
      const result = await ports.coordination.reconcile({
        id: crypto.randomUUID(),
        operationId,
        payloadFingerprint,
        correctionId,
        saleId,
        branchId,
        variantId,
        resolution,
        quantity,
        actorStaffId: manager.id,
      });
      const { resolvedByStaffId, ...row } = result.value;
      return {
        value: {
          ...row,
          resolvedBy: await staffSummary(resolvedByStaffId),
        },
        created: result.created,
      };
    },
  };
}

export function createInventoryAvailabilityReader(store: Pick<InventoryReadStore, "quantitiesFor" | "quantitiesByBranchFor">) {
  return {
    quantitiesFor(branchId: string, variantIds: string[]) {
      return store.quantitiesFor(branchId, variantIds);
    },
    quantitiesByBranchFor(variantIds: string[]) {
      return store.quantitiesByBranchFor(variantIds);
    },
  };
}

export function createInventoryReferenceReader(store: Pick<InventoryReadStore, "referencedVariantIds">) {
  return {
    idsWithInventory(variantIds: string[]) {
      return store.referencedVariantIds(variantIds);
    },
  };
}

function toBatchDto(
  row: {
    id: string;
    variantId: string;
    branchBalances: Array<{ branchId: string; availableQuantity: number }>;
    receivedQuantity: number;
    effectiveReceivedQuantity: number;
    remainingQuantity: number;
    unitCostPiasters: number;
    effectiveUnitCostPiasters: number;
    recordedAt: Date;
    receiptId: string;
    receiptDate: string;
  },
  variant: InventoryBatchDto["variant"] | undefined,
): InventoryBatchDto {
  if (!variant) {
    throw new InventoryValidationError("المتغير المحدد غير موجود.");
  }
  return {
    id: row.id,
    variantId: row.variantId,
    branchBalances: row.branchBalances,
    receivedQuantity: row.receivedQuantity,
    effectiveReceivedQuantity: row.effectiveReceivedQuantity,
    remainingQuantity: row.remainingQuantity,
    unitCostPiasters: row.unitCostPiasters,
    effectiveUnitCostPiasters: row.effectiveUnitCostPiasters,
    recordedAt: row.recordedAt.toISOString(),
    receiptId: row.receiptId,
    receiptDate: row.receiptDate,
    variant,
  };
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InventoryValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new InventoryValidationError(messageAr);
    }
  }
}

function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new InventoryValidationError(messageAr);
  }
  return value;
}

function assertReason(value: unknown): string {
  if (typeof value !== "string") throw new InventoryValidationError("سبب التصحيح مطلوب.");
  const reason = value.trim();
  if (!reason || reason.length > 500) throw new InventoryValidationError("سبب التصحيح مطلوب وبحد أقصى 500 حرف.");
  return reason;
}

function assertReconciliationResolution(
  value: unknown,
): "included_in_count" | "allocate_missing_source" {
  if (value !== "included_in_count" && value !== "allocate_missing_source") {
    throw new InventoryValidationError("طريقة مصالحة البيع المتأخر غير صالحة.");
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

export type { InventoryServices, VariantLowStockDto, InventorySettingsDto };
