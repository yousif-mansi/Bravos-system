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
    employeeDiscountPiasters: record.employeeDiscountPiasters,
    discountReason: record.discountReason,
    discountedByStaffId: record.discountedByStaffId,
    finalTotalPiasters: record.finalTotalPiasters,
    physicallyCompleted: true,
    discrepancy: null,
    lines: record.lines,
  };
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
    employeeDiscountPiasters: input.quote.employeeDiscountPiasters,
    discountReason: input.quote.discountReason,
    discountedByStaffId: input.quote.discountedByStaffId,
    finalTotalPiasters: input.quote.finalTotalPiasters,
    physicallyCompleted: true,
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

export async function retryUnsyncedSales(
  staffId: string,
  sync: {
    accept: (sale: OfflineCompletedSale) => Promise<SaleDto>;
    complete: (sale: OfflineCompletedSale) => Promise<SaleDto>;
  },
  stillCurrent?: () => boolean,
): Promise<void> {
  if (stillCurrent && !stillCurrent()) {
    return;
  }
  const rows = await pos.listUnsynced(staffId);
  for (const local of rows) {
    if (stillCurrent && !stillCurrent()) {
      return;
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
        return;
      }
      if (synced.id === local.id && synced.finalTotalPiasters === local.finalTotalPiasters && synced.soldByStaffId === local.soldByStaffId) {
        await pos.markAcknowledged(staffId, local.id);
      }
    } catch {
      /* retain unacknowledged */
    }
  }
}

export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION };
export type { OfflineCompletedSale, OfflinePendingSale, OfflineSaleKind, PosPriceSnapshotDto };
