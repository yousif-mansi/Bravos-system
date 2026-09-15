import type {
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  PublicProductDto,
  SizeDto,
  UploadedProductMediaDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { PublicationStatus } from "../domain/product.ts";

export type { VerifiedAuth };

export type CatalogActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
};

export type AvailabilityReader = {
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
};

export type VariantReferenceReader = {
  idsWithInventory(variantIds: string[]): Promise<string[]>;
};

export type ListedPriceBasis = {
  variantId: string;
  listedUnitPricePiasters: number;
  identity: VariantIdentityDto;
};

export type VariantWrite = {
  sizeId: string;
  colorId: string;
  sellingPricePiastersOverride: number | null;
};

export type ProductWrite = {
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultSellingPricePiasters: number;
  publication: PublicationStatus;
  imageRefs: string[];
  sizeGuideAr: string | null;
  variants: VariantWrite[];
  actorStaffId: string;
};

export type CatalogStore = {
  listCategories(): Promise<CategoryDto[]>;
  createCategory(input: { nameAr: string; parentId: string | null }): Promise<CategoryDto>;
  updateCategory(id: string, nameAr: string): Promise<CategoryDto | null>;
  getCategory(id: string): Promise<CategoryDto | null>;

  listSizes(): Promise<SizeDto[]>;
  createSize(nameAr: string): Promise<SizeDto>;
  updateSize(id: string, nameAr: string): Promise<SizeDto | null>;
  getSize(id: string): Promise<SizeDto | null>;

  listColors(): Promise<ColorDto[]>;
  createColor(nameAr: string): Promise<ColorDto>;
  updateColor(id: string, nameAr: string): Promise<ColorDto | null>;
  getColor(id: string): Promise<ColorDto | null>;

  listProducts(): Promise<ManagerProductDto[]>;
  listPublishedProducts(): Promise<ManagerProductDto[]>;
  getProduct(id: string): Promise<ManagerProductDto | null>;
  getPublishedProduct(id: string): Promise<ManagerProductDto | null>;
  findProductByCodeKey(codeKey: string): Promise<ManagerProductDto | null>;
  isMediaPublic(ref: string): Promise<boolean>;
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
  getListedPrices(ids: string[]): Promise<ListedPriceBasis[]>;
  listVariantIds(): Promise<string[]>;
  createProduct(input: ProductWrite): Promise<ManagerProductDto>;
  updateProduct(id: string, input: ProductWrite): Promise<ManagerProductDto | null>;
};

export type ProductMediaStorage = {
  save(input: {
    bytes: Uint8Array;
    extension: "jpg" | "png" | "webp";
    contentType: UploadedProductMediaDto["contentType"];
  }): Promise<UploadedProductMediaDto>;
  read(ref: string): Promise<{
    bytes: Uint8Array;
    contentType: UploadedProductMediaDto["contentType"];
  } | null>;
};

export type PublicCatalogReader = {
  list(): Promise<PublicProductDto[]>;
  get(id: string): Promise<PublicProductDto | null>;
};
