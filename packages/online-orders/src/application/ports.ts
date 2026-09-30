import type {
  AppliedAutomaticOfferDto,
  AppliedCouponDto,
  CompletedOnlineOrderDto,
  DeliveryAreaDto,
  OnlineOrderAgreementQuoteDto,
  OnlineOrderDto,
  OnlineOrderFailedReturnInspectionDto,
  OnlineOrderLifecycleEventDto,
  OnlineOrderSettingsDto,
} from "@bravos/contracts";
import type { CheckoutQuoteDto, PublicDeliveryAreaDto, PublicOrderSubmissionDto } from "@bravos/contracts/public";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type DeliveryAreaWrite = {
  id: string;
  nameAr: string;
  feePiasters: number;
  active: boolean;
  actorStaffId: string;
  changedAt: Date;
};

export type CheckoutCatalogLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  listedUnitPricePiasters: number;
  publication: "available" | "coming_soon" | "hidden";
  onlineVisible: boolean;
};

export type CheckoutPricingLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  listedUnitPricePiasters: number;
};

export type CheckoutPricingResult = {
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  automaticOfferDiscountPiasters: number;
  appliedCoupon: AppliedCouponDto | null;
  couponDiscountPiasters: number;
  couponUnitRanges: Array<{
    variantId: string;
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters: number;
  }>;
};

export type ProtectedOrderAllocation = {
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

export type CheckoutDependencies = {
  catalog: { getLines(variantIds: string[]): Promise<CheckoutCatalogLine[]> };
  inventory: {
    lockStockClock(mode: "share" | "update"): Promise<void>;
    quantitiesFor(branchId: string, variantIds: string[]): Promise<Map<string, number>>;
    quantitiesByBranchFor(variantIds: string[]): Promise<Map<string, Map<string, number>>>;
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
      lines: Array<{
        sourceLineId: string;
        variantId: string;
        sellableQuantity: number;
        nonsellableQuantity: number;
      }>;
    }): Promise<{ kind: "created" | "replay"; allocations: Array<{ disposition: string; quantity: number }> }>;
    bumpStockVersion(): Promise<number>;
  };
  pricing: { evaluate(lines: CheckoutPricingLine[], at: Date, couponCode: string | null): Promise<CheckoutPricingResult> };
  couponUsage: {
    claim(input: {
      couponId: string;
      sourceType: "online_order";
      sourceId: string;
      operationId: string;
      payloadFingerprint: string;
      claimedAt: Date;
    }): Promise<"claimed" | "replay">;
    releaseOnlineOrder(input: {
      sourceId: string;
      operationId: string;
      payloadFingerprint: string;
      actorStaffId: string;
      releasedAt: Date;
    }): Promise<"released" | "replay" | "absent">;
  };
};

export type AgreementQuoteWrite = {
  id: string;
  orderId: string;
  orderRevision: number;
  requestFingerprint: string;
  reviewDigest: string;
  request: { lines: Array<{ variantId: string; quantity: number }>; couponCode: string | null };
  quote: OnlineOrderAgreementQuoteDto;
  pricingSnapshot: CheckoutPricingResult;
  actorStaffId: string;
  reviewedAt: Date;
};

export type StoredAgreementQuote = AgreementQuoteWrite;

export type StoredOrderOperation = {
  operationId: string;
  orderId: string;
  operationType:
    | "contact_attempt"
    | "agreed_revision"
    | "confirmation"
    | "unreachable_cancellation"
    | "shipment"
    | "delivery"
    | "delivery_failure"
    | "pre_shipment_cancellation"
    | "failed_return_inspection_draft"
    | "failed_return_inspection_abandon"
    | "failed_return_inspection_post"
    | "failed_delivery_closure";
  payloadFingerprint: string;
  response: OnlineOrderDto;
  actorStaffId: string;
  acceptedAt: Date;
};

export type StoredQuote = {
  id: string;
  requestFingerprint: string;
  request: { lines: Array<{ variantId: string; quantity: number }>; deliveryAreaId: string; couponCode: string | null };
  quote: CheckoutQuoteDto;
  createdAt: Date;
};

export type AcceptedOrderWrite = {
  id: string;
  operationId: string;
  payloadFingerprint: string;
  quoteId: string;
  customerName: string;
  primaryPhone: string;
  alternatePhone: string | null;
  detailedAddress: string;
  landmark: string | null;
  notes: string | null;
  deliveryAreaId: string;
  couponCode: string | null;
  quote: CheckoutQuoteDto;
  submittedAt: Date;
};

export type DeliveredOnlineOrderSource = {
  orderId: string;
  reference: string;
  fulfillmentBranchId: string | null;
  customerName: string;
  primaryPhone: string;
  customerReceivedAt: Date;
  receivedAtKey: string;
  returnDeadlineAt: Date;
  confirmedQuote: OnlineOrderAgreementQuoteDto;
};

export type DeliveredOnlineOrderSourceSearch = {
  limit?: number;
  after?: { receivedAt: string; id: string; channel: "physical" | "online" };
  branchId?: string;
  reference?: string;
  phone?: string;
  date?: string;
  amountPiasters?: number;
};

export type DeliveredOnlineOrderSourceReader = {
  listDeliveredSources(search: DeliveredOnlineOrderSourceSearch): Promise<DeliveredOnlineOrderSource[]>;
  /** When lock=true, callers must already hold the inventory stock-clock lock. */
  getDeliveredSource(orderId: string, lock?: boolean): Promise<DeliveredOnlineOrderSource | null>;
};

export type OnlineOrderReportingReader = {
  countConfirmedFacts(input: { from: Date; to: Date; branchId?: string | null }): Promise<number>;
  countDeliveredFacts(input: { from: Date; to: Date }): Promise<number>;
  countAcceptedSubmissions(input: { from: Date; to: Date }): Promise<number>;
  listConfirmedFactsPage(input: {
    from: Date; to: Date; branchId?: string | null; limit: number; after?: { occurredAt: Date; id: string } | null;
  }): Promise<Array<{ orderId: string; reference: string; occurredAt: Date; fulfillmentBranchId: string | null;
    confirmedQuote: OnlineOrderAgreementQuoteDto }>>;
  listRevenueReversalsPage(input: {
    from: Date; to: Date; branchId?: string | null; limit: number; after?: { occurredAt: Date; id: string } | null;
  }): Promise<Array<{ eventId: string; operationId: string; eventType: "cancelled_before_shipment" | "delivery_failed";
    orderId: string; occurredAt: Date; fulfillmentBranchId: string | null;
    confirmedQuote: OnlineOrderAgreementQuoteDto }>>;
  listRestorationFactsPage(input: {
    from: Date; to: Date; branchId?: string | null; limit: number; after?: { occurredAt: Date; id: string } | null;
  }): Promise<Array<{ eventId: string; operationId: string; orderId: string; occurredAt: Date;
    fulfillmentBranchId: string | null }>>;
  getFulfillmentBranchesByOrderIds(orderIds: string[]): Promise<Map<string, string>>;
  currentStatusCounts(): Promise<{
    pendingCount: number;
    confirmedCount: number;
    shippedCount: number;
    deliveryFailedCount: number;
  }>;
  currentProtectedOrderIdsPage(input: { limit: number; afterId?: string | null }): Promise<string[]>;
};

export type OnlineOrderStore = DeliveredOnlineOrderSourceReader & {
  listPublicAreas(): Promise<PublicDeliveryAreaDto[]>;
  listAreas(): Promise<DeliveryAreaDto[]>;
  getArea(id: string): Promise<DeliveryAreaDto | null>;
  insertArea(input: DeliveryAreaWrite): Promise<DeliveryAreaDto>;
  updateArea(input: DeliveryAreaWrite): Promise<DeliveryAreaDto | null>;
  insertQuote(input: StoredQuote): Promise<void>;
  getQuote(id: string, lock?: boolean): Promise<StoredQuote | null>;
  getSubmissionByOperation(operationId: string): Promise<{ payloadFingerprint: string; result: PublicOrderSubmissionDto } | null>;
  insertOrder(input: AcceptedOrderWrite): Promise<PublicOrderSubmissionDto>;
  listOrders(): Promise<OnlineOrderDto[]>;
  listCompletedOrders(): Promise<CompletedOnlineOrderDto[]>;
  getOrder(id: string, lock?: boolean): Promise<OnlineOrderDto | null>;
  insertAgreementQuote(input: AgreementQuoteWrite): Promise<void>;
  getAgreementQuote(id: string, lock?: boolean): Promise<StoredAgreementQuote | null>;
  getOperation(operationId: string): Promise<StoredOrderOperation | null>;
  insertContactAttempt(input: {
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    outcome: "no_answer" | "reached";
    note: string | null;
    occurredAt: Date;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  insertAgreedRevision(input: {
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    quoteId: string;
    reviewDigest: string;
    agreedAt: Date;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  confirm(input: {
    orderId: string;
    fulfillmentBranchId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    agreedRevision: number;
    quoteId: string;
    reviewDigest: string;
    confirmedAt: Date;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  cancelUnreachable(input: {
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    reason: string;
    cancelledAt: Date;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  transition(input: {
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    operationType: Extract<StoredOrderOperation["operationType"],
      "shipment" | "delivery" | "delivery_failure" | "pre_shipment_cancellation" | "failed_delivery_closure">;
    eventType: Extract<OnlineOrderLifecycleEventDto["type"],
      "shipped" | "delivered" | "delivery_failed" | "cancelled_before_shipment" | "cancelled_after_failed_delivery">;
    actorStaffId: string;
    fromStatus: OnlineOrderDto["status"];
    toStatus: OnlineOrderDto["status"];
    preShipmentStockDisposition?: "awaiting_inspection" | "released";
    occurredAt: Date;
    recordedAt: Date;
    reason: string | null;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  insertFailedReturnInspection(input: {
    id: string;
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    recordedAt: Date;
    nextRevision: number;
    sourceStatus: "delivery_failed" | "cancelled_before_shipment";
    lines: Array<{
      confirmedLineId: string;
      variantId: string;
      receivedQuantity: number;
      sellableQuantity: number;
    }>;
  }): Promise<OnlineOrderDto>;
  postFailedReturnInspection(input: {
    inspectionId: string;
    orderId: string;
    receivingBranchId: string;
    allClassified: boolean;
    sourceStatus: "delivery_failed" | "cancelled_before_shipment";
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    postedAt: Date;
    nextRevision: number;
  }): Promise<OnlineOrderDto>;
  abandonFailedReturnInspection(input: {
    inspectionId: string;
    orderId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    reason: string;
    abandonedAt: Date;
    nextRevision: number;
    sourceStatus: "delivery_failed" | "cancelled_before_shipment";
  }): Promise<OnlineOrderDto>;
  getFailedReturnInspection(id: string, lock?: boolean): Promise<OnlineOrderFailedReturnInspectionDto | null>;
  getSettings(): Promise<OnlineOrderSettingsDto>;
  updateSettings(input: {
    expectedRevision: number;
    unreachableWaitHours: number;
    minimumContactAttempts: number;
    actorStaffId: string;
    changedAt: Date;
  }): Promise<OnlineOrderSettingsDto | null>;
};

export type OnlineOrderUnitOfWork = {
  run<T>(work: (ports: CheckoutDependencies & { store: OnlineOrderStore }) => Promise<T>, operationId?: string): Promise<T>;
};

export type OpeningOnlineOrderTransaction = {
  inspectOpeningConfiguration(areas: Array<{ nameAr: string; line: number }>): Promise<{
    state: unknown;
    settings: { unreachableWaitHours: number; minimumContactAttempts: number };
    errors: Array<{ file: "configuration.csv"; line: number; column: string; code: string; messageAr: string }>;
  }>;
  insertOpeningConfiguration(input: {
    areas: Array<{ id: string; nameAr: string; feePiasters: number; active: boolean }>;
    settings: { unreachableWaitHours: number; minimumContactAttempts: number } | null;
    actorStaffId: string;
    at: Date;
  }): Promise<void>;
};

export type OnlineOrderActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
};
