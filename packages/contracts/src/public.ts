export type PublicProductPublication = "available" | "coming_soon";

export type PublicProductAvailability = "in_stock" | "out_of_stock" | "coming_soon";

export type PublicCatalogOptionDto = {
  id: string;
  nameAr: string;
};

export type PublicProductVariantDto = {
  id: string;
  size: PublicCatalogOptionDto;
  color: PublicCatalogOptionDto;
  sellingPricePiasters: number;
  availableQuantity: number;
  orderable: boolean;
};

export type PublicProductDto = {
  id: string;
  nameAr: string;
  descriptionAr: string;
  category: PublicCatalogOptionDto;
  publication: PublicProductPublication;
  availability: PublicProductAvailability;
  orderable: boolean;
  imageRefs: string[];
  sizeGuideAr: string | null;
  variants: PublicProductVariantDto[];
};

export type PublicProductSummaryDto = {
  id: string;
  nameAr: string;
  category: PublicCatalogOptionDto;
  availability: PublicProductAvailability;
  previewImageRef: string | null;
  lowestSellingPricePiasters: number | null;
};

export type PublicCatalogBrowseDto = {
  categories: PublicCatalogOptionDto[];
  products: PublicProductSummaryDto[];
};

export type PublicStorefrontContactsDto = {
  whatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
};

export type PublicDeliveryAreaDto = {
  id: string;
  nameAr: string;
  feePiasters: number;
};

export type CheckoutRequestLine = {
  variantId: string;
  quantity: number;
};

export type CheckoutQuoteRequest = {
  lines: CheckoutRequestLine[];
  deliveryAreaId: string;
  couponCode?: string | null;
};

export type CheckoutBasketLineDto = {
  variantId: string;
  productId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  merchandiseTotalPiasters: number;
};

export type CheckoutQuoteDto = {
  quoteId: string;
  area: PublicDeliveryAreaDto;
  lines: CheckoutBasketLineDto[];
  merchandiseOriginalPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  merchandiseTotalPiasters: number;
  deliveryFeePiasters: number;
  finalTotalPiasters: number;
  appliedAutomaticOffer: { id: string; nameAr: string; discountPiasters: number } | null;
  appliedCoupon: { code: string; discountPiasters: number } | null;
};

export type PublicOrderSubmissionDto = {
  orderId: string;
  reference: string;
  status: "pending";
  submittedAt: string;
  quote: CheckoutQuoteDto;
};

export type PublicOrderSubmissionRequest = CheckoutQuoteRequest & {
  operationId: string;
  quoteId: string;
  customerName: string;
  primaryPhone: string;
  detailedAddress: string;
  alternatePhone?: string | null;
  landmark?: string | null;
  notes?: string | null;
};

export type PublicAnalyticsEventType = "visit" | "product_view" | "cart_addition";

export type PublicAnalyticsEventRequest =
  | {
      operationId: string;
      eventType: "visit";
    }
  | {
      operationId: string;
      eventType: "product_view";
      productId: string;
    }
  | {
      operationId: string;
      eventType: "cart_addition";
      productId: string;
      variantId: string;
      quantity: number;
    };

export type PublicAnalyticsEventReceiptDto = {
  operationId: string;
  eventType: PublicAnalyticsEventType;
  recordedAt: string;
};
