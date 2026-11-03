import type {
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  PublicCatalogBrowseDto,
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
  quantitiesFor(branchId: string, variantIds: string[]): Promise<Map<string, number>>;
  quantitiesByBranchFor(variantIds: string[]): Promise<Map<string, Map<string, number>>>;
  productQuantitiesFor(branchId: string, productIds: string[]): Promise<Map<string, number>>;
  productQuantitiesByRetailBranch(productIds: string[]): Promise<Map<string, Map<string, number>>>;
};

export type VariantReferenceReader = {
  idsWithInventory(variantIds: string[]): Promise<string[]>;
};

export type ListedPriceBasis = {
  variantId: string;
  productId: string;
  categoryId: string;
  listedUnitPricePiasters: number;
  minimumUnitPricePiasters: number | null;
  identity: VariantIdentityDto;
};

export type VariantWrite = {
  sizeId: string;
  colorId: string;
  onlineVisible?: boolean;
  sellingPricePiastersOverride: number | null;
};

export type ProductWrite = {
  expectedRevision?: number;
  expectedVariantIds?: string[];
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultSellingPricePiasters: number;
  minimumSellingPricePiasters: number | null;
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

export type OpeningCatalogPlan = {
  categories: Array<{ id: string; key: string; nameAr: string; parentId: string | null; line: number }>;
  sizes: Array<{ id: string; key: string; nameAr: string; line: number }>;
  colors: Array<{ id: string; key: string; nameAr: string; line: number }>;
  products: Array<{ id: string; key: string; code: string; nameAr: string; descriptionAr: string; categoryId: string; defaultSellingPricePiasters: number; publication: "available" | "coming_soon" | "hidden"; imageRefs: string[]; sizeGuideAr: string | null; line: number }>;
  variants: Array<{ id: string; key: string; productId: string; sizeId: string; colorId: string; sellingPricePiastersOverride: number | null; line: number }>;
  referencedVariants: OpeningCatalogReference[];
  referencedProducts: OpeningCatalogReference[];
  referencedCategories: OpeningCatalogReference[];
  referencedSizes: OpeningCatalogReference[];
  referencedColors: OpeningCatalogReference[];
};

export type OpeningCatalogReference = {
  id: string;
  file: "catalog.csv" | "opening-stock.csv" | "configuration.csv";
  line: number;
  column: string;
};

export type OpeningCatalogTransaction = {
  inspect(plan: OpeningCatalogPlan): Promise<{ state: unknown; errors: Array<{ file: "catalog.csv" | "opening-stock.csv" | "configuration.csv"; line: number; column: string | null; code: string; messageAr: string }> }>;
  insert(plan: OpeningCatalogPlan, actorStaffId: string, at: Date): Promise<void>;
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
  browse(input: { categoryId?: string }): Promise<PublicCatalogBrowseDto>;
  get(id: string): Promise<PublicProductDto | null>;
};
