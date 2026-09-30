import type {
  CountCoordinationDto,
  CountCoordinationAcknowledgementDto,
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  StockCorrectionDto,
  StockPauseDto,
  StockReconciliationDto,
  StockReconciliationCaseDto,
  VariantIdentityDto,
  VariantLowStockDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { ReceivePayload } from "../domain/fingerprint.ts";

export type { VerifiedAuth, ReceivePayload };

export type InventoryActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type VariantIdentityReader = {
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
  listIds(): Promise<string[]>;
};

export type ClaimedOperation =
  | { kind: "created"; operationId: string; recordedAt: Date }
  | { kind: "replay"; operationId: string; recordedAt: Date };

export type ReceiveBatchLine = {
  lineId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
};

export type ReceivedBatchRecord = {
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
  sourceLineId: string;
};

export type BatchRecord = {
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
};

export type SettingsRecord = {
  lowStockThreshold: number;
};

export type AllocationRecord = {
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
  recordedAt: Date;
};

export type ReceivingBatchCorrection = {
  batchId: string;
  variantId: string;
  effectiveQuantity: number;
  effectiveUnitCostPiasters: number;
};

export type ReceivingBatchCorrectionResult = {
  batchId: string;
  variantId: string;
  originalQuantity: number;
  originalUnitCostPiasters: number;
  previousQuantity: number;
  previousUnitCostPiasters: number;
  effectiveQuantity: number;
  effectiveUnitCostPiasters: number;
  remainingQuantity: number;
  allocatedQuantity: number;
  quantityDelta: number;
  unitCostDeltaPiasters: number;
};

export type DiscrepancyRecord = {
  branchId: string;
  variantId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
};

export type AllocateResult = {
  allocations: AllocationRecord[];
  allocatedQuantity: number;
  unallocatedQuantity: number;
};

export type ProtectedOrderAllocation = {
  branchId: string;
  allocationId: string;
  variantId: string;
  quantity: number;
  protectedAt: Date;
};

export type ProtectOnlineOrderResult = {
  kind: "created" | "replay";
  operationId: string;
  orderId: string;
  recordedAt: Date;
  allocations: ProtectedOrderAllocation[];
};

export type OnlineOrderDispositionLine = {
  sourceLineId: string;
  variantId: string;
  sellableQuantity: number;
  nonsellableQuantity: number;
};

export type OnlineOrderDispositionResult = {
  kind: "created" | "replay";
  operationId: string;
  orderId: string;
  recordedAt: Date;
  allocations: Array<{
    allocationId: string;
    sourceLineId: string;
    variantId: string;
    disposition: "sellable_restored" | "nonsellable_removed";
    quantity: number;
  }>;
};

export type ProtectedOrderAllocationProvenance = {
  branchId: string;
  protectedOrderId: string;
  allocationId: string;
  sourceLineId: string;
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
  allocatedAt: Date;
  sellableRestoredQuantity: number;
  nonsellableRemovedQuantity: number;
  customerReturnedQuantity: number;
  undisposedQuantity: number;
};

export type ReportingAllocationRecord = AllocationRecord & { operationId: string };
export type ReportingDiscrepancyRecord = DiscrepancyRecord & { operationId: string };

export type DeliveredReturnAllocationEffect = {
  allocationId: string;
  quantityDelta: number;
};

export type RecordedDeliveredReturnAllocationEffect = DeliveredReturnAllocationEffect & {
  operationId: string;
};

/**
 * Public inventory transaction contract used by receiving and cash-sale
 * allocation. FIFO is recorded_at then batch id. releaseAllocation and
 * restoreToOriginalBatches remain for later tickets.
 */
export type InventoryTransaction = {
  openingImportState(variantIds: string[]): Promise<{
    stockVersion: number;
    defaultThreshold: number;
    variantThresholds: Array<{ variantId: string; threshold: number | null }>;
  }>;
  claimOpeningImportOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimReceiveOperation(input: {
    operationId: string;
    payload: ReceivePayload;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimSaleOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimReturnOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimCorrectionOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimStockCorrectionOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    kind?: "stock_correction" | "stock_reconciliation";
  }): Promise<ClaimedOperation>;
  receiveBatches(input: {
    branchId: string;
    operationId: string;
    receiptId: string;
    receiptDate: string;
    recordedAt: Date;
    lines: ReceiveBatchLine[];
  }): Promise<ReceivedBatchRecord[]>;
  importOpeningBatches(input: {
    operationId: string;
    lines: Array<ReceiveBatchLine & {
      branchId: string;
      receiptId: string;
      batchId: string;
      movementId: string;
      receiptDate: string;
      recordedAt: Date;
    }>;
  }): Promise<ReceivedBatchRecord[]>;
  applyOpeningSettings(input: {
    actorStaffId: string;
    at: Date;
    defaultThreshold: number | null;
    variantThresholds: Array<{ variantId: string; threshold: number }>;
  }): Promise<void>;
  applyReceivingCorrection(input: {
    branchId: string;
    operationId: string;
    recordedAt: Date;
    lines: ReceivingBatchCorrection[];
  }): Promise<ReceivingBatchCorrectionResult[]>;
  protectOnlineOrder(input: {
    branchId: string;
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    lines: Array<{ lineId: string; variantId: string; quantity: number }>;
  }): Promise<ProtectOnlineOrderResult>;
  disposeProtectedOnlineOrder(input: {
    branchId: string;
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    dispositionType: "pre_shipment_cancellation" | "failed_delivery_inspection";
    lines: OnlineOrderDispositionLine[];
  }): Promise<OnlineOrderDispositionResult>;
  /** Call only after lockStockClock("update") when a caller will mutate these source allocations. */
  lockProtectedOrderAllocations(orderId: string): Promise<ProtectedOrderAllocationProvenance[]>;
  listDeliveredReturnAllocationEffects(operationIds: string[]): Promise<RecordedDeliveredReturnAllocationEffect[]>;
  adjustDeliveredReturnProtection(input: {
    branchId: string;
    orderId: string;
    operationId: string;
    recordedAt: Date;
    effects: DeliveredReturnAllocationEffect[];
  }): Promise<void>;
  allocateFromOldestAvailable(input: {
    branchId: string;
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
    allowPartial: boolean;
  }): Promise<AllocateResult>;
  allocateHeldFromOldestAvailable(input: {
    branchId: string;
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<AllocateResult>;
  attributeHeldAllocation(input: {
    branchId: string;
    operationId: string;
    batchId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<AllocationRecord>;
  removeAllocation(input: {
    branchId: string;
    operationId: string;
    batchId: string;
    variantId: string;
    quantity: number;
  }): Promise<void>;
  allocateCorrectionFromOldestAvailable(input: {
    branchId: string;
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<AllocateResult>;
  restoreToOriginalBatch(input: {
    branchId: string;
    operationId: string;
    batchId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<void>;
  adjustCorrectionBatch(input: {
    branchId: string;
    operationId: string;
    batchId: string;
    variantId: string;
    direction: "restore" | "deduct";
    quantity: number;
    recordedAt: Date;
  }): Promise<{ unitCostPiasters: number; effectiveUnitCostPiasters: number }>;
  recordDiscrepancy(input: {
    branchId: string;
    operationId: string;
    variantId: string;
    requestedQuantity: number;
    allocatedQuantity: number;
    recordedAt: Date;
  }): Promise<DiscrepancyRecord>;
  resolveDiscrepancy(input: {
    branchId: string;
    operationId: string;
    variantId: string;
    allocatedQuantity: number;
  }): Promise<DiscrepancyRecord | null>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
  listAllocationsForOperations(operationIds: string[]): Promise<ReportingAllocationRecord[]>;
  listDiscrepancies(operationId: string): Promise<DiscrepancyRecord[]>;
  listDiscrepanciesForOperations(operationIds: string[]): Promise<ReportingDiscrepancyRecord[]>;
  unresolvedDiscrepancyQuantity(): Promise<number>;
  quantitiesFor(branchId: string, variantIds: string[]): Promise<Map<string, number>>;
  quantitiesByBranchFor(variantIds: string[]): Promise<Map<string, Map<string, number>>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listAvailableBatchesFifo(branchId: string, variantId: string): Promise<ReceivedBatchRecord[]>;
  getBatchStates(batchIds: string[]): Promise<BatchRecord[]>;
  lockStockClock(mode: "share" | "update"): Promise<void>;
  bumpStockVersion(): Promise<number>;
  currentStockVersion(): Promise<number>;
  assertStockMutationAllowed(): Promise<void>;
  recordTillSnapshot(input: {
    deviceId: string;
    staffId: string;
    snapshotId: string;
    issuedAt: Date;
    stockVersion: number;
    restoreGeneration: number;
    pendingOperationIds: string[];
    includedOperationIds: string[];
  }): Promise<StockPauseDto | null>;
};

export type InventoryReadStore = {
  quantitiesFor(branchId: string, variantIds: string[]): Promise<Map<string, number>>;
  quantitiesByBranchFor(variantIds: string[]): Promise<Map<string, Map<string, number>>>;
  listBranchIds(): Promise<string[]>;
  currentStockVersion(): Promise<number>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listBatches(): Promise<BatchRecord[]>;
  getBatchStates(batchIds: string[]): Promise<BatchRecord[]>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
  listAllocationsForOperations(operationIds: string[]): Promise<ReportingAllocationRecord[]>;
  listProtectedOrderAllocations(orderId: string): Promise<ProtectedOrderAllocationProvenance[]>;
  listDiscrepancies(operationId: string): Promise<DiscrepancyRecord[]>;
  listDiscrepanciesForOperations(operationIds: string[]): Promise<ReportingDiscrepancyRecord[]>;
  unresolvedDiscrepancyQuantity(): Promise<number>;
  listProtectedOrderAllocationProvenance(orderIds: string[]): Promise<ProtectedOrderAllocationProvenance[]>;
  summarizeAuthoritativeAvailableInventory(): Promise<{ quantity: number; valuePiasters: number }>;
  summarizeProtectedOrderInventory(orderIds: string[]): Promise<{ quantity: number; valuePiasters: number }>;
  listOrderRestoredCostByOperations(operationIds: string[]): Promise<Map<string, number>>;
  getSettings(): Promise<SettingsRecord>;
  updateSettings(lowStockThreshold: number, actorStaffId: string): Promise<SettingsRecord>;
  upsertVariantThreshold(
    variantId: string,
    lowStockThreshold: number,
    actorStaffId: string,
  ): Promise<VariantLowStockDto>;
  clearVariantThreshold(variantId: string, actorStaffId: string): Promise<VariantLowStockDto>;
  listVariantThresholds(): Promise<Map<string, number | null>>;
};

export type InventoryServices = {
  quantitiesFor(branchId: string, variantIds: string[]): Promise<Map<string, number>>;
  quantitiesByBranchFor(variantIds: string[]): Promise<Map<string, Map<string, number>>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listBatches(auth: VerifiedAuth | null): Promise<InventoryBatchDto[]>;
  listLowStock(auth: VerifiedAuth | null): Promise<LowStockVariantDto[]>;
  getSettings(auth: VerifiedAuth | null): Promise<InventorySettingsDto>;
  updateSettings(auth: VerifiedAuth | null, input: unknown): Promise<InventorySettingsDto>;
  setVariantThreshold(
    auth: VerifiedAuth | null,
    variantId: string,
    input: unknown,
  ): Promise<VariantLowStockDto>;
  currentCoordination(auth: VerifiedAuth | null): Promise<CountCoordinationDto | null>;
  currentStockPause(auth: VerifiedAuth | null): Promise<StockPauseDto | null>;
  acknowledgeCoordination(
    auth: VerifiedAuth | null,
    input: unknown,
  ): Promise<CountCoordinationAcknowledgementDto>;
  startCoordination(
    auth: VerifiedAuth | null,
    input: unknown,
  ): Promise<{ value: CountCoordinationDto; created: boolean }>;
  cancelCoordination(auth: VerifiedAuth | null, input: unknown): Promise<CountCoordinationDto>;
  finalizeStockCorrection(
    auth: VerifiedAuth | null,
    input: unknown,
  ): Promise<{ value: StockCorrectionDto; created: boolean }>;
  listStockCorrections(auth: VerifiedAuth | null): Promise<StockCorrectionDto[]>;
  listStockReconciliations(auth: VerifiedAuth | null): Promise<StockReconciliationDto[]>;
  listStockReconciliationCases(auth: VerifiedAuth | null): Promise<StockReconciliationCaseDto[]>;
  reconcileLateSale(
    auth: VerifiedAuth | null,
    input: unknown,
  ): Promise<{ value: StockReconciliationDto; created: boolean }>;
};

export type CountCoordinationRecord = Omit<CountCoordinationDto, "startedBy" | "finishedBy"> & {
  startedByStaffId: string;
  finishedByStaffId: string | null;
};

export type StockCorrectionRecord = Omit<StockCorrectionDto, "variant" | "changedBy"> & {
  changedByStaffId: string;
};

export type StockCoordinationStore = {
  current(): Promise<CountCoordinationRecord | null>;
  start(input: {
    id: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    expiresAt: Date;
  }): Promise<{ value: CountCoordinationRecord; created: boolean }>;
  acknowledge(input: {
    coordinationId: string;
    deviceId: string;
    snapshotId: string;
    actorStaffId: string;
  }): Promise<CountCoordinationAcknowledgementDto>;
  cancel(input: {
    operationId: string;
    coordinationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<CountCoordinationRecord>;
  finalize(input: {
    branchId: string;
    id: string;
    operationId: string;
    payloadFingerprint: string;
    coordinationId: string;
    variantId: string;
    previousAvailableQuantity: number;
    correctedAvailableQuantity: number;
    reason: string;
    positiveSourceBatchId: string | null;
    actorStaffId: string;
  }): Promise<{ value: StockCorrectionRecord; created: boolean }>;
  listCorrections(): Promise<StockCorrectionRecord[]>;
  listReconciliations(): Promise<Array<Omit<StockReconciliationDto, "resolvedBy"> & { resolvedByStaffId: string }>>;
  listReconciliationCases(): Promise<StockReconciliationCaseDto[]>;
  reconcile(input: {
    branchId: string;
    id: string;
    operationId: string;
    payloadFingerprint: string;
    correctionId: string;
    saleId: string;
    variantId: string;
    resolution: "included_in_count" | "allocate_missing_source";
    quantity: number;
    actorStaffId: string;
  }): Promise<{
    value: Omit<StockReconciliationDto, "resolvedBy"> & { resolvedByStaffId: string };
    created: boolean;
  }>;
};

export type StockReconciliationSale = {
  id: string;
  branchId: string;
  operationId: string;
  sourceDeviceId: string | null;
  sourceSnapshotId: string | null;
  sourceSnapshotIssuedAt: Date | null;
  occurredAt: Date;
  recordedAt: Date;
  costsIncomplete: boolean;
  lines: Array<{
    id: string;
    variantId: string;
    quantity: number;
    allocatedQuantity: number;
    unallocatedQuantity: number;
  }>;
};

export type StockReconciliationSalesPort = {
  getById(id: string, lock?: boolean): Promise<StockReconciliationSale | null>;
  listRecordedAfter(at: Date): Promise<StockReconciliationSale[]>;
  applyAllocatedRemainder(input: {
    saleId: string;
    variantId: string;
    quantity: number;
  }): Promise<{ costsIncomplete: boolean }>;
};

export type StockReconciliationDownstreamFactsPort = {
  hasDownstreamFacts(saleId: string, saleLineIds: string[]): Promise<boolean>;
};
