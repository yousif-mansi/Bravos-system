import type {
  CashierProductLookupDto,
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  PublicCatalogBrowseDto,
  PublicProductDto,
  SizeDto,
  UploadedProductMediaDto,
} from "@bravos/contracts";
import {
  capabilitiesFor,
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
} from "@bravos/identity";
import { CatalogValidationError, DuplicateProductCodeError, ReferencedVariantError } from "../domain/errors.ts";
import { assertPiasters, resolvedSellingPricePiasters } from "../domain/money.ts";
import { validateProductImage } from "../domain/media.ts";
import {
  assertDescription,
  assertImageRefs,
  assertOptionalUuid,
  assertProductCode,
  assertProductName,
  assertPublication,
  assertProductMediaRef,
  assertSizeGuide,
  assertTaxonomyName,
  assertUuid,
  normalizedProductCodeKey,
} from "../domain/product.ts";
import type {
  AvailabilityReader,
  CatalogActorPort,
  CatalogStore,
  ProductMediaStorage,
  ProductWrite,
  VariantReferenceReader,
  VariantWrite,
  VerifiedAuth,
} from "./ports.ts";

export type CatalogServices = ReturnType<typeof createCatalogServices>;

const CATEGORY_CREATE_KEYS = new Set(["nameAr", "parentId"]);
const CATEGORY_UPDATE_KEYS = new Set(["nameAr"]);
const NAME_ONLY_KEYS = new Set(["nameAr"]);
const PRODUCT_KEYS = new Set([
  "code",
  "nameAr",
  "descriptionAr",
  "categoryId",
  "defaultSellingPricePiasters",
  "publication",
  "imageRefs",
  "sizeGuideAr",
  "variants",
]);
const VARIANT_KEYS = new Set(["sizeId", "colorId", "sellingPricePiastersOverride"]);

export function unstockedAvailability(): AvailabilityReader {
  return {
    async quantitiesFor(variantIds) {
      return new Map(variantIds.map((id) => [id, 0]));
    },
  };
}

export function unreferencedVariants(): VariantReferenceReader {
  return {
    async idsWithInventory() {
      return [];
    },
  };
}

export function createCatalogServices(ports: {
  store: CatalogStore;
  actors: CatalogActorPort;
  availability?: AvailabilityReader;
  references?: VariantReferenceReader;
  media: ProductMediaStorage;
}) {
  const availability = ports.availability ?? unstockedAvailability();
  const references = ports.references ?? unreferencedVariants();

  async function requireStaff(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    return { staff, sessionId: auth.sessionId };
  }

  async function requireManager(auth: VerifiedAuth | null) {
    const current = await requireStaff(auth);
    if (!isManager(current.staff)) {
      throw new ForbiddenError();
    }
    return current;
  }

  async function requireCashier(auth: VerifiedAuth | null) {
    const current = await requireStaff(auth);
    const branchId = await ports.actors.getSessionBranch(current.sessionId);
    if (!capabilitiesFor(current.staff, branchId).cashier) {
      throw new ForbiddenError();
    }
    return current;
  }

  return {
    async listCategories(auth: VerifiedAuth | null): Promise<CategoryDto[]> {
      await requireManager(auth);
      return ports.store.listCategories();
    },

    async createCategory(auth: VerifiedAuth | null, input: unknown): Promise<CategoryDto> {
      await requireManager(auth);
      const body = expectObject(input, "بيانات التصنيف غير صالحة.");
      assertAllowedKeys(body, CATEGORY_CREATE_KEYS, "بيانات التصنيف غير صالحة.");
      const nameAr = assertTaxonomyName(body.nameAr, "اسم التصنيف غير صالح.");
      const parentId = assertOptionalUuid(body.parentId, "التصنيف الرئيسي غير موجود.");
      if (parentId) {
        const parent = await ports.store.getCategory(parentId);
        if (!parent) {
          throw new CatalogValidationError("التصنيف الرئيسي غير موجود.");
        }
        if (parent.parentId) {
          throw new CatalogValidationError("التصنيف الفرعي يجب أن يتبع تصنيفاً رئيسياً.");
        }
      }
      return ports.store.createCategory({ nameAr, parentId });
    },

    async updateCategory(auth: VerifiedAuth | null, id: string, input: unknown): Promise<CategoryDto> {
      await requireManager(auth);
      const categoryId = assertUuid(id, "التصنيف غير موجود.");
      const body = expectObject(input, "بيانات التصنيف غير صالحة.");
      assertAllowedKeys(body, CATEGORY_UPDATE_KEYS, "بيانات التصنيف غير صالحة.");
      const nameAr = assertTaxonomyName(body.nameAr, "اسم التصنيف غير صالح.");
      const updated = await ports.store.updateCategory(categoryId, nameAr);
      if (!updated) {
        throw new NotFoundError("التصنيف غير موجود.");
      }
      return updated;
    },

    async listSizes(auth: VerifiedAuth | null): Promise<SizeDto[]> {
      await requireManager(auth);
      return ports.store.listSizes();
    },

    async createSize(auth: VerifiedAuth | null, input: unknown): Promise<SizeDto> {
      await requireManager(auth);
      const nameAr = parseNameOnly(input, "اسم المقاس غير صالح.", "بيانات المقاس غير صالحة.");
      return ports.store.createSize(nameAr);
    },

    async updateSize(auth: VerifiedAuth | null, id: string, input: unknown): Promise<SizeDto> {
      await requireManager(auth);
      const sizeId = assertUuid(id, "المقاس غير موجود.");
      const nameAr = parseNameOnly(input, "اسم المقاس غير صالح.", "بيانات المقاس غير صالحة.");
      const updated = await ports.store.updateSize(sizeId, nameAr);
      if (!updated) {
        throw new NotFoundError("المقاس غير موجود.");
      }
      return updated;
    },

    async listColors(auth: VerifiedAuth | null): Promise<ColorDto[]> {
      await requireManager(auth);
      return ports.store.listColors();
    },

    async createColor(auth: VerifiedAuth | null, input: unknown): Promise<ColorDto> {
      await requireManager(auth);
      const nameAr = parseNameOnly(input, "اسم اللون غير صالح.", "بيانات اللون غير صالحة.");
      return ports.store.createColor(nameAr);
    },

    async updateColor(auth: VerifiedAuth | null, id: string, input: unknown): Promise<ColorDto> {
      await requireManager(auth);
      const colorId = assertUuid(id, "اللون غير موجود.");
      const nameAr = parseNameOnly(input, "اسم اللون غير صالح.", "بيانات اللون غير صالحة.");
      const updated = await ports.store.updateColor(colorId, nameAr);
      if (!updated) {
        throw new NotFoundError("اللون غير موجود.");
      }
      return updated;
    },

    async listProducts(auth: VerifiedAuth | null): Promise<ManagerProductDto[]> {
      await requireManager(auth);
      return ports.store.listProducts();
    },

    async uploadProductImage(
      auth: VerifiedAuth | null,
      input: { fileName: unknown; contentType: unknown; bytes: unknown },
    ): Promise<UploadedProductMediaDto> {
      await requireManager(auth);
      const image = validateProductImage(input);
      return ports.media.save(image);
    },

    async getProduct(auth: VerifiedAuth | null, id: string): Promise<ManagerProductDto> {
      await requireManager(auth);
      const productId = assertUuid(id, "المنتج غير موجود.");
      const product = await ports.store.getProduct(productId);
      if (!product) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      return product;
    },

    async createProduct(auth: VerifiedAuth | null, input: unknown): Promise<ManagerProductDto> {
      const { staff } = await requireManager(auth);
      const write = await parseProductWrite(ports.store, input, staff.id);
      const existing = await ports.store.findProductByCodeKey(normalizedProductCodeKey(write.code));
      if (existing) {
        throw new DuplicateProductCodeError();
      }
      return ports.store.createProduct(write);
    },

    async updateProduct(auth: VerifiedAuth | null, id: string, input: unknown): Promise<ManagerProductDto> {
      const { staff } = await requireManager(auth);
      const productId = assertUuid(id, "المنتج غير موجود.");
      const write = await parseProductWrite(ports.store, input, staff.id);
      const existing = await ports.store.getProduct(productId);
      if (!existing) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      const duplicate = await ports.store.findProductByCodeKey(normalizedProductCodeKey(write.code));
      if (duplicate && duplicate.id !== productId) {
        throw new DuplicateProductCodeError();
      }
      const nextKeys = new Set(write.variants.map((variant) => `${variant.sizeId}:${variant.colorId}`));
      const removed = existing.variants.filter(
        (variant) => !nextKeys.has(`${variant.size.id}:${variant.color.id}`),
      );
      if (removed.length > 0) {
        const referenced = await references.idsWithInventory(removed.map((variant) => variant.id));
        if (referenced.length > 0) {
          throw new ReferencedVariantError();
        }
      }
      const updated = await ports.store.updateProduct(productId, write);
      if (!updated) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      return updated;
    },

    async getVariants(ids: string[]) {
      return ports.store.getVariants(ids);
    },

    async lookupByCode(auth: VerifiedAuth | null, code: unknown): Promise<CashierProductLookupDto> {
      await requireCashier(auth);
      const productCode = assertProductCode(code);
      const product = await ports.store.findProductByCodeKey(normalizedProductCodeKey(productCode));
      if (!product) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      const quantities = await availability.quantitiesFor(product.variants.map((variant) => variant.id));
      return toCashierLookup(product, quantities);
    },

    async listCashierCatalog(auth: VerifiedAuth | null): Promise<CashierProductLookupDto[]> {
      await requireCashier(auth);
      const products = await ports.store.listProducts();
      const ids = products.flatMap((product) => product.variants.map((variant) => variant.id));
      const quantities = await availability.quantitiesFor(ids);
      return products.map((product) => toCashierLookup(product, quantities));
    },

    async listPublicProducts(): Promise<PublicProductDto[]> {
      const products = await ports.store.listPublishedProducts();
      const ids = products.flatMap((product) => product.variants.map((variant) => variant.id));
      const quantities = await availability.quantitiesFor(ids);
      return products.map((product) => toPublicProduct(product, quantities));
    },

    async browsePublicProducts(input: { query?: unknown; categoryId?: unknown }): Promise<PublicCatalogBrowseDto> {
      const query = optionalBrowseQuery(input.query);
      const categoryId = optionalBrowseCategory(input.categoryId);
      const products = await ports.store.listPublishedProducts();
      const ids = products.flatMap((product) => product.variants.map((variant) => variant.id));
      const quantities = await availability.quantitiesFor(ids);
      const categories = [...new Map(products.map((product) => [product.category.id, {
        id: product.category.id,
        nameAr: product.category.nameAr,
      }])).values()].sort((left, right) => left.nameAr.localeCompare(right.nameAr, "ar"));
      const normalizedQuery = query.toLocaleLowerCase("ar");
      return {
        categories,
        products: products
          .filter((product) => !categoryId || product.category.id === categoryId)
          .filter((product) => {
            if (!normalizedQuery) return true;
            return `${product.nameAr} ${product.descriptionAr} ${product.category.nameAr}`
              .toLocaleLowerCase("ar")
              .includes(normalizedQuery);
          })
          .map((product) => {
            const detail = toPublicProduct(product, quantities);
            const prices = detail.variants.map((variant) => variant.sellingPricePiasters);
            return {
              id: detail.id,
              nameAr: detail.nameAr,
              category: detail.category,
              availability: detail.availability,
              previewImageRef: detail.imageRefs[0] ?? null,
              lowestSellingPricePiasters: prices.length > 0 ? Math.min(...prices) : null,
            };
          }),
      };
    },

    async getPublicProduct(id: unknown): Promise<PublicProductDto> {
      const productId = assertUuid(id, "المنتج غير موجود.");
      const product = await ports.store.getPublishedProduct(productId);
      if (!product) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      const quantities = await availability.quantitiesFor(product.variants.map((variant) => variant.id));
      return toPublicProduct(product, quantities);
    },

    async getPublicMedia(refValue: unknown) {
      const ref = assertProductMediaRef(refValue);
      if (!(await ports.store.isMediaPublic(ref))) {
        throw new NotFoundError("الصورة غير موجودة.");
      }
      const media = await ports.media.read(ref);
      if (!media) {
        throw new NotFoundError("الصورة غير موجودة.");
      }
      return media;
    },

    async getManagerMedia(auth: VerifiedAuth | null, refValue: unknown) {
      await requireManager(auth);
      const ref = assertProductMediaRef(refValue);
      const media = await ports.media.read(ref);
      if (!media) {
        throw new NotFoundError("الصورة غير موجودة.");
      }
      return media;
    },
  };
}

function optionalBrowseQuery(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > 80) {
    throw new CatalogValidationError("عبارة البحث غير صالحة.");
  }
  return value.trim();
}

function optionalBrowseCategory(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return assertUuid(value, "التصنيف المحدد غير صالح.");
}

function toPublicProduct(
  product: ManagerProductDto,
  quantities: Map<string, number>,
): PublicProductDto {
  const comingSoon = product.publication === "coming_soon";
  const variants = product.variants.map((variant) => {
    const availableQuantity = Math.max(0, quantities.get(variant.id) ?? 0);
    return {
      id: variant.id,
      size: variant.size,
      color: variant.color,
      sellingPricePiasters: resolvedSellingPricePiasters(
        product.defaultSellingPricePiasters,
        variant.sellingPricePiastersOverride,
      ),
      availableQuantity,
      orderable: !comingSoon && availableQuantity > 0,
    };
  });
  const hasStock = variants.some((variant) => variant.availableQuantity > 0);
  return {
    id: product.id,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    category: { id: product.category.id, nameAr: product.category.nameAr },
    publication: product.publication === "coming_soon" ? "coming_soon" : "available",
    availability: comingSoon ? "coming_soon" : hasStock ? "in_stock" : "out_of_stock",
    orderable: !comingSoon && hasStock,
    imageRefs: [...product.imageRefs],
    sizeGuideAr: product.sizeGuideAr,
    variants,
  };
}

function toCashierLookup(
  product: ManagerProductDto,
  quantities: Map<string, number>,
): CashierProductLookupDto {
  return {
    id: product.id,
    categoryId: product.category.id,
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      sellingPricePiasters: resolvedSellingPricePiasters(
        product.defaultSellingPricePiasters,
        variant.sellingPricePiastersOverride,
      ),
      availableQuantity: quantities.get(variant.id) ?? 0,
    })),
  };
}

function parseNameOnly(input: unknown, nameMessage: string, shapeMessage: string): string {
  const body = expectObject(input, shapeMessage);
  assertAllowedKeys(body, NAME_ONLY_KEYS, shapeMessage);
  return assertTaxonomyName(body.nameAr, nameMessage);
}

async function parseProductWrite(
  store: CatalogStore,
  input: unknown,
  actorStaffId: string,
): Promise<ProductWrite> {
  const body = expectObject(input, "بيانات المنتج غير صالحة.");
  assertAllowedKeys(body, PRODUCT_KEYS, "بيانات المنتج غير صالحة.");
  const categoryId = assertUuid(body.categoryId, "التصنيف المحدد غير موجود.");
  const category = await store.getCategory(categoryId);
  if (!category) {
    throw new CatalogValidationError("التصنيف المحدد غير موجود.");
  }
  const variants = await parseVariants(store, body.variants);
  return {
    code: assertProductCode(body.code),
    nameAr: assertProductName(body.nameAr),
    descriptionAr: assertDescription(body.descriptionAr),
    categoryId,
    defaultSellingPricePiasters: assertPiasters(body.defaultSellingPricePiasters, "سعر البيع غير صالح."),
    publication: assertPublication(body.publication),
    imageRefs: assertImageRefs(body.imageRefs),
    sizeGuideAr: assertSizeGuide(body.sizeGuideAr),
    variants,
    actorStaffId,
  };
}

async function parseVariants(store: CatalogStore, value: unknown): Promise<VariantWrite[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CatalogValidationError("يجب تحديد متغير واحد على الأقل.");
  }
  const parsed: VariantWrite[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const body = expectObject(item, "تركيبة المقاس واللون غير صالحة.");
    assertAllowedKeys(body, VARIANT_KEYS, "تركيبة المقاس واللون غير صالحة.");
    const sizeId = assertUuid(body.sizeId, "المقاس المحدد غير موجود.");
    const colorId = assertUuid(body.colorId, "اللون المحدد غير موجود.");
    const key = `${sizeId}:${colorId}`;
    if (seen.has(key)) {
      throw new CatalogValidationError("لا يمكن تكرار نفس المقاس واللون.");
    }
    seen.add(key);
    const size = await store.getSize(sizeId);
    if (!size) {
      throw new CatalogValidationError("المقاس المحدد غير موجود.");
    }
    const color = await store.getColor(colorId);
    if (!color) {
      throw new CatalogValidationError("اللون المحدد غير موجود.");
    }
    const override =
      body.sellingPricePiastersOverride === undefined || body.sellingPricePiastersOverride === null
        ? null
        : assertPiasters(body.sellingPricePiastersOverride, "سعر المتغير غير صالح.");
    parsed.push({
      sizeId,
      colorId,
      sellingPricePiastersOverride: override,
    });
  }
  return parsed;
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new CatalogValidationError(messageAr);
    }
  }
}
