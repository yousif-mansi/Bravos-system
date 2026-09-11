import type {
  CashierProductLookupDto,
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  SizeDto,
} from "@bravos/contracts";
import {
  capabilitiesFor,
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
} from "@bravos/identity";
import { CatalogValidationError, DuplicateProductCodeError } from "../domain/errors.ts";
import { assertPiasters, resolvedSellingPricePiasters } from "../domain/money.ts";
import {
  assertDescription,
  assertImageRefs,
  assertOptionalUuid,
  assertProductCode,
  assertProductName,
  assertPublication,
  assertTaxonomyName,
  assertUuid,
  normalizedProductCodeKey,
} from "../domain/product.ts";
import type {
  AvailabilityReader,
  CatalogActorPort,
  CatalogStore,
  ProductWrite,
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

export function createCatalogServices(ports: {
  store: CatalogStore;
  actors: CatalogActorPort;
  availability?: AvailabilityReader;
}) {
  const availability = ports.availability ?? unstockedAvailability();

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
      const updated = await ports.store.updateProduct(productId, write);
      if (!updated) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      return updated;
    },

    async lookupByCode(auth: VerifiedAuth | null, code: unknown): Promise<CashierProductLookupDto> {
      await requireCashier(auth);
      const productCode = assertProductCode(code);
      const product = await ports.store.findProductByCodeKey(normalizedProductCodeKey(productCode));
      if (!product) {
        throw new NotFoundError("المنتج غير موجود.");
      }
      const quantities = await availability.quantitiesFor(product.variants.map((variant) => variant.id));
      return {
        id: product.id,
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
    },
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
