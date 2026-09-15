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
