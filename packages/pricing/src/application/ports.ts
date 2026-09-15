import type { AutomaticOfferBundleItemDto, AutomaticOfferDiscountType, AutomaticOfferDto, CouponDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type PricingActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type AutomaticOfferWrite = {
  id: string;
  nameAr: string;
  discountType: AutomaticOfferDiscountType;
  percentageBasisPoints: number | null;
  fixedDiscountPiasters: number | null;
  bundlePricePiasters: number | null;
  bundleItems: AutomaticOfferBundleItemDto[];
  buyQuantity: number | null;
  rewardQuantity: number | null;
  rewardPercentageBasisPoints: number | null;
  buyProductIds: string[];
  buyCategoryIds: string[];
  rewardProductIds: string[];
  rewardCategoryIds: string[];
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowCoupon: boolean;
  productIds: string[];
  categoryIds: string[];
  actorStaffId: string;
  changedAt: Date;
};

export type AutomaticOfferStore = {
  list(): Promise<AutomaticOfferDto[]>;
  getById(id: string): Promise<AutomaticOfferDto | null>;
  insert(input: AutomaticOfferWrite): Promise<AutomaticOfferDto>;
  update(input: AutomaticOfferWrite): Promise<AutomaticOfferDto | null>;
};

export type CouponWrite = {
  id: string;
  code: string;
  normalizedCode: string;
  discountType: "percentage" | "fixed";
  percentageBasisPoints: number | null;
  fixedDiscountPiasters: number | null;
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowAutomaticOffer: boolean;
  usageLimit: number;
  productIds: string[];
  categoryIds: string[];
  actorStaffId: string;
  changedAt: Date;
};

export type CouponStore = {
  list(): Promise<CouponDto[]>;
  getById(id: string): Promise<CouponDto | null>;
  insert(input: CouponWrite): Promise<CouponDto>;
  update(input: CouponWrite): Promise<CouponDto | null>;
};

export type OpeningPricingTransaction = {
  inspectOpeningPricing(input: { offers: Array<{ key: string; nameAr: string; line: number }>; coupons: Array<{ normalizedCode: string; line: number }> }): Promise<{ state: unknown; errors: Array<{ file: "configuration.csv"; line: number; column: string; code: string; messageAr: string }> }>;
  insertOpeningPricing(input: { offers: AutomaticOfferWrite[]; coupons: CouponWrite[] }): Promise<void>;
};

export type CouponUsageClaim = {
  couponId: string;
  sourceType: "physical_sale" | "online_order";
  sourceId: string;
  operationId: string;
  payloadFingerprint: string;
  claimedAt: Date;
};

export type CouponUsageTransaction = {
  claim(input: CouponUsageClaim): Promise<"claimed" | "replay">;
  claimCompletedOffline(input: CouponUsageClaim): Promise<{
    kind: "claimed" | "replay";
    overLimit: boolean;
    usageLimit: number;
    centralUsedCount: number;
  }>;
  releaseOnlineOrder(input: {
    sourceId: string;
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
    releasedAt: Date;
  }): Promise<"released" | "replay" | "absent">;
};
