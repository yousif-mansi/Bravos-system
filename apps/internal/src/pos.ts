import type { PosPriceSnapshotDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import {
  createDexiePosStore,
  createOfflinePosServices,
  evaluatePosUpdate,
  isDeclaredSafeMigration,
  POS_SCHEMA_VERSION,
  PosStorageError,
  type OfflineCompletedSale,
  type OfflinePendingSale,
  type OfflinePosServices,
  type OfflineSaleKind,
  type SessionTransition,
} from "@bravos/sales/browser";
import { ApiError, type SyncedSaleDto } from "./api.ts";

const store = createDexiePosStore();
export const pos: OfflinePosServices = createOfflinePosServices(store);
export { PosStorageError };

export function saleFromOffline(record: OfflineCompletedSale): SaleDto {
  return {
    id: record.id,
    operationId: record.operationId,
    branch: record.branch,
    soldByStaffId: record.soldByStaffId,
    soldByDisplayName: record.soldByDisplayName,
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    originalTotalPiasters: record.originalTotalPiasters,
    automaticOfferDiscountPiasters: record.automaticOfferDiscountPiasters ?? 0,
    appliedAutomaticOffer: record.appliedAutomaticOffer ?? null,
    employeeDiscountPiasters: record.employeeDiscountPiasters,
    discountReason: record.discountReason,
    discountedByStaffId: record.discountedByStaffId,
    finalTotalPiasters: record.finalTotalPiasters,
    physicallyCompleted: true,
    discrepancy: discrepancyFromLines(record.lines),
    lines: record.lines,
  };
}

function discrepancyFromLines(lines: OfflineCompletedSale["lines"]): SaleDto["discrepancy"] {
  const unallocatedQuantity = lines.reduce((sum, line) => sum + line.unallocatedQuantity, 0);
  if (unallocatedQuantity <= 0) {
    return null;
  }
  return { unallocatedQuantity, messageAr: "لم تُخصص كل الكمية من المخزون المسجّل." };
}

export function offlineFromQuote(input: {
  staffId: string;
  deviceId: string;
  quote: SaleDto;
  occurredAt: string;
  snapshotId?: string | null;
  kind?: OfflineSaleKind;
}): OfflineCompletedSale {
  return {
    id: input.quote.id,
    staffId: input.staffId,
    operationId: input.quote.operationId,
    deviceId: input.deviceId,
    snapshotId: input.snapshotId ?? null,
    kind: input.kind ?? "connected",
    syncStatus: "pending",
    branch: input.quote.branch,
    soldByStaffId: input.quote.soldByStaffId,
    soldByDisplayName: input.quote.soldByDisplayName,
    occurredAt: input.occurredAt,
    recordedAt: null,
    customerName: input.quote.customerName,
    customerPhone: input.quote.customerPhone,
    originalTotalPiasters: input.quote.originalTotalPiasters,
    automaticOfferDiscountPiasters: input.quote.automaticOfferDiscountPiasters,
    appliedAutomaticOffer: input.quote.appliedAutomaticOffer,
    employeeDiscountPiasters: input.quote.employeeDiscountPiasters,
    discountReason: input.quote.discountReason,
    discountedByStaffId: input.quote.discountedByStaffId,
    finalTotalPiasters: input.quote.finalTotalPiasters,
    physicallyCompleted: true,
    payloadFingerprint: null,
    lines: input.quote.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: line.listedUnitPricePiasters,
      originalPiasters: line.originalPiasters,
      discountPiasters: line.discountPiasters,
      paidPiasters: line.paidPiasters,
      allocatedQuantity: 0,
      unallocatedQuantity: 0,
      units: line.units,
      variant: line.variant,
    })),
  };
}

export async function prepareOfflineWorkspace(
  workspace: WorkspaceDto,
  transition?: SessionTransition,
): Promise<boolean> {
  await pos.migrateLegacyMarkers();
  const accepted = await pos.rememberSession(workspace, transition);
  await pos.requestPersistentStorage();
  return accepted;
}

export type PosReadiness = {
  codeReady: boolean;
  dataReady: boolean;
  persistent: boolean | null;
  unsynced: number;
};

export async function readPosReadiness(staffId: string): Promise<Omit<PosReadiness, "codeReady">> {
  const snapshot = await pos.loadSnapshot(staffId);
  const unsynced = await pos.listUnsynced(staffId);
  const persistent = await pos.requestPersistentStorage();
  return { dataReady: Boolean(snapshot), persistent, unsynced: unsynced.length };
}

export async function cacheIssuedSnapshot(staffId: string, snapshot: PosPriceSnapshotDto): Promise<void> {
  await pos.saveSnapshot(staffId, snapshot);
}

export function syncOutcomeMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "انتهت الجلسة أو أُلغي الدخول. سجّل الدخول مجدداً. المبيعات المكتملة محفوظة.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.";
  }
  if (error instanceof PosStorageError) {
    return error.message;
  }
  if (error instanceof ApiError) {
    return error.messageAr;
  }
  return "تعذر مزامنة المبيعات. أعد المحاولة عند الاتصال.";
}

export async function applySyncedSale(local: OfflineCompletedSale, synced: SyncedSaleDto): Promise<void> {
  if (
    synced.id !== local.id ||
    synced.finalTotalPiasters !== local.finalTotalPiasters ||
    synced.soldByStaffId !== local.soldByStaffId
  ) {
    throw new PosStorageError("تعذر مطابقة البيع المزامن مع السجل المحلي.");
  }
  if (!synced.acknowledgement) {
    throw new PosStorageError("تعذر تأكيد المزامنة.");
  }
  await pos.applyAcknowledgement({
    acknowledgedOperationIds: synced.acknowledgement.acknowledgedOperationIds,
    stockVersion: synced.acknowledgement.stockVersion,
    includedOperationIds: synced.acknowledgement.includedOperationIds,
    includedOperations: synced.acknowledgement.includedOperations ?? [],
    availability: synced.acknowledgement.availability,
    sales: [
      {
        id: synced.id,
        operationId: synced.operationId,
        recordedAt: synced.recordedAt,
        soldByStaffId: synced.soldByStaffId,
        finalTotalPiasters: synced.finalTotalPiasters,
        discrepancy: synced.discrepancy,
        lines: synced.lines,
      },
    ],
  });
}

export async function pendingOperationIds(): Promise<string[]> {
  return pos.listPendingOperationIds();
}

export async function retryUnsyncedSales(
  staffId: string,
  sync: {
    accept: (sale: OfflineCompletedSale) => Promise<SyncedSaleDto>;
    complete: (sale: OfflineCompletedSale) => Promise<SyncedSaleDto>;
  },
  stillCurrent?: () => boolean,
): Promise<{ synced: number; remaining: number; error: string }> {
  if (stillCurrent && !stillCurrent()) {
    return { synced: 0, remaining: 0, error: "" };
  }
  const rows = await pos.listUnsynced(staffId);
  let syncedCount = 0;
  let error = "";
  for (const local of rows) {
    if (stillCurrent && !stillCurrent()) {
      break;
    }
    if (local.staffId !== staffId) {
      continue;
    }
    try {
      const synced =
        local.kind === "accepted" && local.snapshotId
          ? await sync.accept(local)
          : await sync.complete(local);
      if (stillCurrent && !stillCurrent()) {
        break;
      }
      await applySyncedSale(local, synced);
      syncedCount += 1;
    } catch (caught) {
      error = syncOutcomeMessage(caught);
      break;
    }
  }
  const remaining = stillCurrent && !stillCurrent() ? rows.length - syncedCount : (await pos.listUnsynced(staffId)).length;
  return { synced: syncedCount, remaining, error };
}

export async function recoverPreservedQueues(
  managerStaffId: string,
  recover: (sale: OfflineCompletedSale) => Promise<SyncedSaleDto>,
  stillCurrent?: () => boolean,
): Promise<{ recovered: number; remaining: number; error: string }> {
  if (stillCurrent && !stillCurrent()) {
    return { recovered: 0, remaining: 0, error: "" };
  }
  try {
    const result = await pos.recoverPreservedQueues(managerStaffId, async (sale) => {
      if (stillCurrent && !stillCurrent()) {
        throw new Error("stale-account");
      }
      const synced = await recover(sale);
      if (stillCurrent && !stillCurrent()) {
        throw new Error("stale-account");
      }
      if (
        synced.id !== sale.id ||
        synced.finalTotalPiasters !== sale.finalTotalPiasters ||
        synced.soldByStaffId !== sale.soldByStaffId
      ) {
        throw new PosStorageError("تعذر مطابقة البيع المزامن مع السجل المحلي.");
      }
      return {
        id: synced.id,
        operationId: synced.operationId,
        recordedAt: synced.recordedAt,
        soldByStaffId: synced.soldByStaffId,
        finalTotalPiasters: synced.finalTotalPiasters,
        discrepancy: synced.discrepancy,
        lines: synced.lines,
        acknowledgement: synced.acknowledgement,
      };
    }, stillCurrent);
    return { recovered: result.recovered, remaining: result.remaining, error: "" };
  } catch (caught) {
    return {
      recovered: 0,
      remaining: await pos.countOtherPending(managerStaffId),
      error: syncOutcomeMessage(caught),
    };
  }
}

export async function acceptedPayload(sale: OfflineCompletedSale) {
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    deviceId: sale.deviceId,
    snapshotId: sale.snapshotId ?? "",
    occurredAt: sale.occurredAt,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    employeeDiscountPiasters: sale.employeeDiscountPiasters,
    discountReason: sale.discountReason,
    pendingOperationIds: await pendingOperationIds(),
    lines: sale.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: line.listedUnitPricePiasters,
    })),
  };
}

export async function completedPayload(sale: OfflineCompletedSale) {
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    occurredAt: sale.occurredAt,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    employeeDiscountPiasters: sale.employeeDiscountPiasters,
    discountReason: sale.discountReason,
    pendingOperationIds: await pendingOperationIds(),
    lines: sale.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
  };
}

export async function recoveryPayload(sale: OfflineCompletedSale) {
  if (sale.kind === "accepted" && sale.snapshotId) {
    return acceptedPayload(sale);
  }
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    deviceId: sale.deviceId,
    occurredAt: sale.occurredAt,
    pendingOperationIds: await pendingOperationIds(),
  };
}

export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION };
export type { OfflineCompletedSale, OfflinePendingSale, OfflineSaleKind, PosPriceSnapshotDto };
