import type { OpeningImportCountsDto, OpeningImportLineErrorDto } from "@bravos/contracts";

export type CatalogCategoryPlan = { id: string; key: string; nameAr: string; parentKey: string | null; parentId: string | null; line: number };
export type NamedPlan = { id: string; key: string; nameAr: string; line: number };
export type ProductPlan = { id: string; key: string; code: string; nameAr: string; descriptionAr: string; categoryKey: string; categoryId: string; defaultSellingPricePiasters: number; publication: "available" | "coming_soon" | "hidden"; imageRefs: string[]; sizeGuideAr: string | null; line: number };
export type VariantPlan = { id: string; key: string; productKey: string; productId: string; sizeKey: string; sizeId: string; colorKey: string; colorId: string; sellingPricePiastersOverride: number | null; line: number };
export type BatchPlan = { id: string; lineId: string; movementId: string; key: string; variantKey: string; variantId: string; quantity: number; unitCostPiasters: number; receiptDate: string; batchOrder: number; recordedAt: string; line: number };
export type ExpenseCategoryPlan = NamedPlan & { active: boolean };
export type DeliveryAreaPlan = NamedPlan & { feePiasters: number; active: boolean };
export type OfferPlan = { id: string; key: string; nameAr: string; discountType: "percentage" | "fixed" | "fixed_bundle" | "buy_x_get_y"; percentageBasisPoints: number | null; fixedDiscountPiasters: number | null; bundlePricePiasters: number | null; bundleItems: Array<{ variantId: string; requiredQuantity: number; line: number }>; buyQuantity: number | null; rewardQuantity: number | null; rewardPercentageBasisPoints: number | null; buyProductIds: string[]; buyCategoryIds: string[]; rewardProductIds: string[]; rewardCategoryIds: string[]; startsOn: string; endsOn: string; active: boolean; allowCoupon: boolean; productIds: string[]; categoryIds: string[]; line: number };
export type CouponPlan = { id: string; key: string; code: string; normalizedCode: string; discountType: "percentage" | "fixed"; percentageBasisPoints: number | null; fixedDiscountPiasters: number | null; startsOn: string; endsOn: string; active: boolean; allowAutomaticOffer: boolean; usageLimit: number; productIds: string[]; categoryIds: string[]; line: number };

export type OpeningImportPlan = {
  receiptId: string;
  categories: CatalogCategoryPlan[];
  sizes: NamedPlan[];
  colors: NamedPlan[];
  products: ProductPlan[];
  variants: VariantPlan[];
  batches: BatchPlan[];
  expenseCategories: ExpenseCategoryPlan[];
  deliveryAreas: DeliveryAreaPlan[];
  offers: OfferPlan[];
  coupons: CouponPlan[];
  inventoryDefaultThreshold: number | null;
  variantThresholds: Array<{ key: string; variantId: string; variantKey: string; threshold: number; line: number }>;
  contacts: { whatsappUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; tiktokUrl: string | null } | null;
  onlineOrderSettings: { unreachableWaitHours: number; minimumContactAttempts: number } | null;
  counts: OpeningImportCountsDto;
  errors: OpeningImportLineErrorDto[];
};
