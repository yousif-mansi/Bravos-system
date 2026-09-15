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
