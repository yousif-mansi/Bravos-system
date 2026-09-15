import type { AppliedAutomaticOfferDto, AppliedCouponDto, DeliveryAreaDto, OnlineOrderDto } from "@bravos/contracts";
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
    quantity: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters: number;
  }>;
};

export type CheckoutDependencies = {
  catalog: { getLines(variantIds: string[]): Promise<CheckoutCatalogLine[]> };
  inventory: {
    lockStockClock(mode: "share" | "update"): Promise<void>;
    quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  };
  pricing: { evaluate(lines: CheckoutPricingLine[], at: Date, couponCode: string | null): Promise<CheckoutPricingResult> };
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

export type OnlineOrderStore = {
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
  getOrder(id: string): Promise<OnlineOrderDto | null>;
};

export type OnlineOrderUnitOfWork = {
  run<T>(work: (ports: CheckoutDependencies & { store: OnlineOrderStore }) => Promise<T>, operationId?: string): Promise<T>;
};

export type OnlineOrderActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
};
