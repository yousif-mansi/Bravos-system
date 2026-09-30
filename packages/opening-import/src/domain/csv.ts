import { createHash, randomUUID } from "node:crypto";
import type { OpeningImportFilesDto, OpeningImportLineErrorDto } from "@bravos/contracts";
import { normalizeExpenseCategoryName } from "@bravos/expenses";
import { assertDescription, assertImageRefs, assertProductCode, assertProductName, assertSizeGuide, assertTaxonomyName } from "@bravos/catalog";
import { assertPiasters, assertQuantity, assertThreshold } from "@bravos/inventory";
import { validateOpeningDeliveryArea, validateOpeningOnlineOrderSettings } from "@bravos/online-orders";
import { validateAutomaticOfferWrite, validateCouponWrite } from "@bravos/pricing";
import { normalizeStorefrontContactUrl, type StorefrontContactPlatform } from "@bravos/storefront-config";
import type { BatchPlan, CouponPlan, DeliveryAreaPlan, ExpenseCategoryPlan, NamedPlan, OfferPlan, OpeningImportPlan, ProductPlan, VariantPlan } from "./model.ts";

const CATALOG_HEADERS = ["record_type","key","name_ar","parent_key","product_code","description_ar","category_key","default_price_egp","publication","image_refs","size_guide_ar","product_key","size_key","color_key","price_override_egp"];
const STOCK_HEADERS = ["batch_key","branch_code","variant_key","quantity","unit_cost_egp","receipt_date","batch_order"];
const CONFIG_HEADERS = ["record_type","key","name_ar","value","variant_key","fee_egp","active","discount_type","percentage","amount_egp","starts_on","ends_on","allow_combination","usage_limit","product_keys","category_keys","buy_quantity","reward_quantity","reward_percentage","bundle_total_egp","offer_key","required_quantity","buy_product_keys","buy_category_keys","reward_product_keys","reward_category_keys"];
const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_FIELD = 4000;

type Row = { line: number; values: Record<string, string> };
type ParsedRecord = { line: number; fields: string[] };
type OfferDraft = OfferPlan & {
  productKeys: string[];
  categoryKeys: string[];
  buyProductKeys: string[];
  buyCategoryKeys: string[];
  rewardProductKeys: string[];
  rewardCategoryKeys: string[];
};

export function inputFingerprint(files: OpeningImportFilesDto): string {
  return sha(JSON.stringify({ catalog: normalizeText(files.catalog), stock: normalizeText(files.stock), configuration: normalizeText(files.configuration) }));
}

export function planFingerprint(plan: OpeningImportPlan): string {
  return sha(JSON.stringify(plan));
}

export function buildPlan(files: OpeningImportFilesDto, now: Date): OpeningImportPlan {
  const errors: OpeningImportLineErrorDto[] = [];
  const catalogRows = parseFile("catalog.csv", files.catalog, CATALOG_HEADERS, errors);
  const stockRows = parseFile("opening-stock.csv", files.stock, STOCK_HEADERS, errors);
  const configRows = parseFile("configuration.csv", files.configuration, CONFIG_HEADERS, errors);
  if (catalogRows.length + stockRows.length + configRows.length > MAX_ROWS) {
    errors.push(err("catalog.csv", 1, null, "ROW_LIMIT", `إجمالي الصفوف يتجاوز الحد الأقصى ${MAX_ROWS}.`));
  }

  const { categories, sizes, colors, products, variants, categoryByKey, productByKey } = parseCatalogRows(catalogRows, errors);
  const variantByKey = new Map(variants.map((value) => [value.key, value]));
  const batches = parseStockRows(stockRows, variantByKey, errors);

  function parseConfigurationRowsLocal() {
    const expenseCategories: ExpenseCategoryPlan[] = [];
    const deliveryAreas: DeliveryAreaPlan[] = [];
    const offerDrafts: OfferDraft[] = [];
    const coupons: CouponPlan[] = [];
    const bundleRows: Row[] = [];
    const variantThresholds: OpeningImportPlan["variantThresholds"] = [];
    let inventoryDefaultThreshold: number | null = null;
    let contacts: OpeningImportPlan["contacts"] = null;
    let onlineOrderSettings: OpeningImportPlan["onlineOrderSettings"] = null;
    const configurationKeys = new Set<string>();
    for (const row of configRows) {
    const type = row.values.record_type;
    const rawKey = required(row, "key", "configuration.csv", errors);
    const key = rawKey ? localKey(rawKey, "configuration.csv", row.line, errors) : null;
    if (!key) continue;
    const identity = `${type}:${key}`;
    if (configurationKeys.has(identity)) {
      errors.push(err("configuration.csv", row.line, "key", "DUPLICATE_KEY", `مفتاح الإعداد ${key} مكرر لنوع ${type}.`));
      continue;
    }
    configurationKeys.add(identity);
    if (type === "inventory_default_threshold") {
      if (inventoryDefaultThreshold !== null) errors.push(err("configuration.csv", row.line, "record_type", "DUPLICATE_SINGLETON", "يقبل الملف حداً افتراضياً واحداً للمخزون."));
      const parsed = integer(row, "value", "configuration.csv", errors, 0);
      const value = parsed === null ? null : checked(row, "value", "configuration.csv", errors, () => assertThreshold(parsed, "حد التنبيه غير صالح."));
      if (value !== null && value !== undefined) inventoryDefaultThreshold = value;
    } else if (type === "variant_low_stock_threshold") {
      const variantKey = referenceKey(required(row, "variant_key", "configuration.csv", errors));
      const parsed = integer(row, "value", "configuration.csv", errors, 0);
      const value = parsed === null ? null : checked(row, "value", "configuration.csv", errors, () => assertThreshold(parsed, "حد التنبيه غير صالح."));
      const variantId = variantKey ? variantByKey.get(variantKey)?.id ?? explicitId(variantKey) : null;
      if (variantKey && !variantId) errors.push(err("configuration.csv", row.line, "variant_key", "UNKNOWN_REFERENCE", "استخدم مفتاح متغير من الملف أو id:<UUID> لمتغير موجود."));
      if (variantId && value !== null && value !== undefined) variantThresholds.push({ key, variantId, variantKey, threshold: value, line: row.line });
    } else if (type === "expense_category") {
      const nameAr = required(row, "name_ar", "configuration.csv", errors);
      const active = boolean(row, "active", "configuration.csv", errors);
      if (nameAr && active !== null) expenseCategories.push({ id: randomUUID(), key, nameAr, active, line: row.line });
    } else if (type === "delivery_area") {
      const nameAr = required(row, "name_ar", "configuration.csv", errors);
      const fee = money(row, "fee_egp", "configuration.csv", errors, false);
      const active = boolean(row, "active", "configuration.csv", errors);
      if (nameAr && fee !== null && fee !== undefined && active !== null) {
        const validated = checked(row, "name_ar", "configuration.csv", errors, () => validateOpeningDeliveryArea(nameAr, fee));
        if (validated) deliveryAreas.push({ id: randomUUID(), key, ...validated, active, line: row.line });
      }
    } else if (type === "storefront_contact") {
      const platforms = ["whatsapp", "facebook", "instagram", "tiktok"] as const;
      if (!platforms.includes(key as StorefrontContactPlatform)) {
        errors.push(err("configuration.csv", row.line, "key", "UNKNOWN_CONTACT", "مفتاح وسيلة التواصل غير مدعوم."));
      } else {
        const platform = key as StorefrontContactPlatform;
        const labels = { whatsapp: "رابط واتساب", facebook: "رابط فيسبوك", instagram: "رابط إنستجرام", tiktok: "رابط تيك توك" } as const;
        const value = checked(row, "value", "configuration.csv", errors, () => normalizeStorefrontContactUrl(platform, row.values.value, labels[platform]));
        if (value !== undefined) {
          contacts ??= { whatsappUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null };
          const map = { whatsapp: "whatsappUrl", facebook: "facebookUrl", instagram: "instagramUrl", tiktok: "tiktokUrl" } as const;
          contacts[map[platform]] = value;
        }
      }
    } else if (type === "online_order_settings") {
      if (onlineOrderSettings) errors.push(err("configuration.csv", row.line, "record_type", "DUPLICATE_SINGLETON", "يقبل الملف صفاً واحداً لإعدادات الطلبات."));
      const wait = integer(row, "value", "configuration.csv", errors, 1);
      const attempts = integer(row, "usage_limit", "configuration.csv", errors, 2);
      if (wait !== null && attempts !== null) {
        const validated = checked(row, "value", "configuration.csv", errors, () => validateOpeningOnlineOrderSettings(wait, attempts));
        if (validated) onlineOrderSettings = validated;
      }
    } else if (type === "automatic_offer") {
      const offer = parseAutomaticOfferRow(row, key, errors);
      if (offer) offerDrafts.push(offer);
    } else if (type === "bundle_item") bundleRows.push(row);
    else if (type === "coupon") {
      const coupon = parseCouponRow(row, key, productByKey, categoryByKey, errors);
      if (coupon) coupons.push(coupon);
    } else errors.push(err("configuration.csv", row.line, "record_type", "UNKNOWN_RECORD_TYPE", "نوع صف الإعدادات غير مدعوم."));
    }
    const offerByKey = new Map(offerDrafts.map((value) => [value.key, value]));
  for (const offer of offerDrafts) {
    const sourceRow = { line: offer.line, values: {} };
    offer.productIds = resolveRefs(offer.productKeys, productByKey, "product_keys", sourceRow, errors);
    offer.categoryIds = resolveRefs(offer.categoryKeys, categoryByKey, "category_keys", sourceRow, errors);
    offer.buyProductIds = resolveRefs(offer.buyProductKeys, productByKey, "buy_product_keys", sourceRow, errors);
    offer.buyCategoryIds = resolveRefs(offer.buyCategoryKeys, categoryByKey, "buy_category_keys", sourceRow, errors);
    offer.rewardProductIds = resolveRefs(offer.rewardProductKeys, productByKey, "reward_product_keys", sourceRow, errors);
    offer.rewardCategoryIds = resolveRefs(offer.rewardCategoryKeys, categoryByKey, "reward_category_keys", sourceRow, errors);
    validateOffer(offer, errors);
  }
  for (const row of bundleRows) {
    const offer = offerByKey.get(referenceKey(row.values.offer_key ?? ""));
    const variantKey = referenceKey(row.values.variant_key ?? "");
    const variantId = variantByKey.get(variantKey)?.id ?? explicitId(variantKey);
    const requiredQuantity = integer(row, "required_quantity", "configuration.csv", errors, 1);
    if (!offer) errors.push(err("configuration.csv", row.line, "offer_key", "UNKNOWN_REFERENCE", "مرجع العرض غير موجود."));
    if (!variantId) errors.push(err("configuration.csv", row.line, "variant_key", "UNKNOWN_REFERENCE", "مرجع المتغير غير موجود."));
    if (offer && variantId && requiredQuantity !== null) offer.bundleItems.push({ variantId, requiredQuantity, line: row.line });
  }
  const offers: OfferPlan[] = offerDrafts.map(({ productKeys: _p, categoryKeys: _c, buyProductKeys: _bp, buyCategoryKeys: _bc, rewardProductKeys: _rp, rewardCategoryKeys: _rc, ...offer }) => offer);
  for (const offer of offers) {
    try { validateAutomaticOfferWrite(offer.id, "preview", offerWriteBody(offer), now); }
    catch (caught) { errors.push(err("configuration.csv", offer.line, null, "INVALID_OFFER", caught instanceof Error ? caught.message : "بيانات العرض غير صالحة.")); }
  }
  for (const coupon of coupons) {
    try {
      const canonical = validateCouponWrite(coupon.id, "preview", couponWriteBody(coupon), now);
      coupon.code = canonical.code;
      coupon.normalizedCode = canonical.normalizedCode;
    }
    catch (caught) { errors.push(err("configuration.csv", coupon.line, null, "INVALID_COUPON", caught instanceof Error ? caught.message : "بيانات الكوبون غير صالحة.")); }
  }
  duplicateNormalized(expenseCategories, "name_ar", "configuration.csv", errors, (value) => normalizeExpenseCategoryName(value.nameAr));
  duplicateNormalized(deliveryAreas, "name_ar", "configuration.csv", errors, (value) => norm(value.nameAr));
  duplicateNormalized(offers, "key", "configuration.csv", errors, (value) => value.key);
  duplicateNormalized(coupons, "name_ar", "configuration.csv", errors, (value) => value.normalizedCode);
    return { expenseCategories, deliveryAreas, offers, coupons, inventoryDefaultThreshold, variantThresholds, contacts, onlineOrderSettings };
  }
  const { expenseCategories, deliveryAreas, offers, coupons, inventoryDefaultThreshold, variantThresholds, contacts, onlineOrderSettings } = parseConfigurationRowsLocal();
  const counts = { categories: categories.length, sizes: sizes.length, colors: colors.length, products: products.length, variants: variants.length, batches: batches.length, openingQuantity: batches.reduce((sum, batch) => sum + batch.quantity, 0), expenseCategories: expenseCategories.length, deliveryAreas: deliveryAreas.length, automaticOffers: offers.length, coupons: coupons.length };
  return { receiptId: randomUUID(), categories, sizes, colors, products, variants, batches, expenseCategories, deliveryAreas, offers, coupons, inventoryDefaultThreshold, variantThresholds, contacts, onlineOrderSettings, counts, errors };
}

function parseAutomaticOfferRow(row: Row, key: string, errors: OpeningImportLineErrorDto[]): OfferDraft | null {
  const nameAr = required(row, "name_ar", "configuration.csv", errors);
  const discountType = row.values.discount_type ?? "";
  const startsOn = dateOnly(row, "starts_on", "configuration.csv", errors);
  const endsOn = dateOnly(row, "ends_on", "configuration.csv", errors);
  const active = boolean(row, "active", "configuration.csv", errors);
  const allowCoupon = boolean(row, "allow_combination", "configuration.csv", errors);
  if (!nameAr || !startsOn || !endsOn || active === null || allowCoupon === null) return null;
  if (!["percentage", "fixed", "fixed_bundle", "buy_x_get_y"].includes(discountType)) {
    errors.push(err("configuration.csv", row.line, "discount_type", "INVALID_OFFER", "نوع العرض غير مدعوم."));
    return null;
  }
  return {
    id: randomUUID(), key, nameAr, discountType: discountType as OfferPlan["discountType"],
    percentageBasisPoints: percent(row, "percentage", "configuration.csv", errors, true) ?? null,
    fixedDiscountPiasters: money(row, "amount_egp", "configuration.csv", errors, true) ?? null,
    bundlePricePiasters: money(row, "bundle_total_egp", "configuration.csv", errors, true) ?? null,
    bundleItems: [],
    buyQuantity: optionalInteger(row, "buy_quantity", "configuration.csv", errors, 1) ?? null,
    rewardQuantity: optionalInteger(row, "reward_quantity", "configuration.csv", errors, 1) ?? null,
    rewardPercentageBasisPoints: percent(row, "reward_percentage", "configuration.csv", errors, true) ?? null,
    buyProductIds: [], buyCategoryIds: [], rewardProductIds: [], rewardCategoryIds: [],
    startsOn, endsOn, active, allowCoupon, productIds: [], categoryIds: [], line: row.line,
    productKeys: splitIdentityRefs(row.values.product_keys ?? ""),
    categoryKeys: splitIdentityRefs(row.values.category_keys ?? ""),
    buyProductKeys: splitIdentityRefs(row.values.buy_product_keys ?? ""),
    buyCategoryKeys: splitIdentityRefs(row.values.buy_category_keys ?? ""),
    rewardProductKeys: splitIdentityRefs(row.values.reward_product_keys ?? ""),
    rewardCategoryKeys: splitIdentityRefs(row.values.reward_category_keys ?? ""),
  };
}

function parseCouponRow(
  row: Row,
  key: string,
  products: Map<string, { id: string }>,
  categories: Map<string, { id: string }>,
  errors: OpeningImportLineErrorDto[],
): CouponPlan | null {
  const code = required(row, "name_ar", "configuration.csv", errors);
  const discountType = row.values.discount_type ?? "";
  const startsOn = dateOnly(row, "starts_on", "configuration.csv", errors);
  const endsOn = dateOnly(row, "ends_on", "configuration.csv", errors);
  const active = boolean(row, "active", "configuration.csv", errors);
  const allowAutomaticOffer = boolean(row, "allow_combination", "configuration.csv", errors);
  const usageLimit = integer(row, "usage_limit", "configuration.csv", errors, 1);
  if (!code || !startsOn || !endsOn || active === null || allowAutomaticOffer === null || usageLimit === null) return null;
  if (discountType !== "percentage" && discountType !== "fixed") {
    errors.push(err("configuration.csv", row.line, "discount_type", "INVALID_COUPON", "نوع الكوبون يجب أن يكون percentage أو fixed."));
    return null;
  }
  return {
    id: randomUUID(), key, code, normalizedCode: norm(code), discountType,
    percentageBasisPoints: percent(row, "percentage", "configuration.csv", errors, true) ?? null,
    fixedDiscountPiasters: money(row, "amount_egp", "configuration.csv", errors, true) ?? null,
    startsOn, endsOn, active, allowAutomaticOffer, usageLimit,
    productIds: resolveRefs(splitIdentityRefs(row.values.product_keys ?? ""), products, "product_keys", row, errors),
    categoryIds: resolveRefs(splitIdentityRefs(row.values.category_keys ?? ""), categories, "category_keys", row, errors),
    line: row.line,
  };
}

function parseCatalogRows(rows: Row[], errors: OpeningImportLineErrorDto[]) {
  const categories: OpeningImportPlan["categories"] = [];
  const sizes: NamedPlan[] = [];
  const colors: NamedPlan[] = [];
  const productDrafts: Array<Omit<ProductPlan, "categoryId">> = [];
  const variantDrafts: Array<Omit<VariantPlan, "productId" | "sizeId" | "colorId">> = [];
  const keys = new Set<string>();

  for (const row of rows) {
    const type = row.values.record_type;
    const rawKey = required(row, "key", "catalog.csv", errors);
    const key = rawKey ? localKey(rawKey, "catalog.csv", row.line, errors) : null;
    if (!key) continue;
    if (keys.has(key)) {
      errors.push(err("catalog.csv", row.line, "key", "DUPLICATE_KEY", `المفتاح ${key} مكرر.`));
      continue;
    }
    keys.add(key);
    if (type === "category") parseCategoryRow(row, key, categories, errors);
    else if (type === "size" || type === "color") parseTaxonomyRow(row, key, type, sizes, colors, errors);
    else if (type === "product") parseProductRow(row, key, productDrafts, errors);
    else if (type === "variant") parseVariantRow(row, key, variantDrafts, errors);
    else errors.push(err("catalog.csv", row.line, "record_type", "UNKNOWN_RECORD_TYPE", "نوع صف الكتالوج غير مدعوم."));
  }

  const categoryByKey = new Map(categories.map((value) => [value.key, value]));
  const sizeByKey = new Map(sizes.map((value) => [value.key, value]));
  const colorByKey = new Map(colors.map((value) => [value.key, value]));
  for (const category of categories) {
    if (!category.parentKey) continue;
    const parentId = categoryByKey.get(category.parentKey)?.id ?? explicitId(category.parentKey);
    if (!parentId || parentId === category.id) errors.push(err("catalog.csv", category.line, "parent_key", "UNKNOWN_REFERENCE", "استخدم مفتاح تصنيف من الملف أو id:<UUID> لتصنيف موجود."));
    else category.parentId = parentId;
  }
  validateCategoryCycles(categories, errors);

  const products: ProductPlan[] = productDrafts.flatMap((product) => {
    const categoryId = categoryByKey.get(product.categoryKey)?.id ?? explicitId(product.categoryKey);
    if (!categoryId) {
      errors.push(err("catalog.csv", product.line, "category_key", "UNKNOWN_REFERENCE", "استخدم مفتاح تصنيف من الملف أو id:<UUID> لتصنيف موجود."));
      return [];
    }
    return [{ ...product, categoryId }];
  });
  const productByKey = new Map(products.map((value) => [value.key, value]));
  const variants: VariantPlan[] = variantDrafts.flatMap((variant) => {
    const productId = productByKey.get(variant.productKey)?.id ?? explicitId(variant.productKey);
    const sizeId = sizeByKey.get(variant.sizeKey)?.id ?? explicitId(variant.sizeKey);
    const colorId = colorByKey.get(variant.colorKey)?.id ?? explicitId(variant.colorKey);
    if (!productId || !sizeId || !colorId) {
      errors.push(err("catalog.csv", variant.line, "product_key", "UNKNOWN_REFERENCE", "استخدم مفاتيح من الملف أو مراجع id:<UUID> للمنتج والمقاس واللون."));
      return [];
    }
    return [{ ...variant, productId, sizeId, colorId }];
  });

  duplicateNormalized(categories, "name_ar", "catalog.csv", errors, (value) => `${value.parentKey ?? "root"}:${norm(value.nameAr)}`);
  duplicateNormalized(sizes, "name_ar", "catalog.csv", errors, (value) => norm(value.nameAr));
  duplicateNormalized(colors, "name_ar", "catalog.csv", errors, (value) => norm(value.nameAr));
  duplicateNormalized(products, "product_code", "catalog.csv", errors, (value) => norm(value.code));
  duplicateNormalized(variants, "key", "catalog.csv", errors, (value) => `${value.productKey}:${value.sizeKey}:${value.colorKey}`);
  return { categories, sizes, colors, products, variants, categoryByKey, productByKey };
}

function parseCategoryRow(row: Row, key: string, output: OpeningImportPlan["categories"], errors: OpeningImportLineErrorDto[]) {
  const rawName = required(row, "name_ar", "catalog.csv", errors);
  if (!rawName) return;
  const nameAr = checked(row, "name_ar", "catalog.csv", errors, () => assertTaxonomyName(rawName, "اسم التصنيف غير صالح."));
  if (nameAr) output.push({ id: randomUUID(), key, nameAr, parentKey: row.values.parent_key ? referenceKey(row.values.parent_key) : null, parentId: null, line: row.line });
}

function parseTaxonomyRow(row: Row, key: string, type: "size" | "color", sizes: NamedPlan[], colors: NamedPlan[], errors: OpeningImportLineErrorDto[]) {
  const rawName = required(row, "name_ar", "catalog.csv", errors);
  if (!rawName) return;
  const message = type === "size" ? "اسم المقاس غير صالح." : "اسم اللون غير صالح.";
  const nameAr = checked(row, "name_ar", "catalog.csv", errors, () => assertTaxonomyName(rawName, message));
  if (nameAr) (type === "size" ? sizes : colors).push({ id: randomUUID(), key, nameAr, line: row.line });
}

function parseProductRow(row: Row, key: string, output: Array<Omit<ProductPlan, "categoryId">>, errors: OpeningImportLineErrorDto[]) {
  const rawName = required(row, "name_ar", "catalog.csv", errors);
  const rawCode = required(row, "product_code", "catalog.csv", errors);
  const categoryKey = referenceKey(required(row, "category_key", "catalog.csv", errors));
  const price = money(row, "default_price_egp", "catalog.csv", errors, false);
  const publication = row.values.publication ?? "";
  if (!rawName || !rawCode || !categoryKey || price === null || price === undefined) return;
  const nameAr = checked(row, "name_ar", "catalog.csv", errors, () => assertProductName(rawName));
  const code = checked(row, "product_code", "catalog.csv", errors, () => assertProductCode(rawCode));
  const descriptionAr = checked(row, "description_ar", "catalog.csv", errors, () => assertDescription(row.values.description_ar ?? ""));
  const imageRefs = checked(row, "image_refs", "catalog.csv", errors, () => assertImageRefs(splitRefs(row.values.image_refs ?? "")));
  const sizeGuideAr = checked(row, "size_guide_ar", "catalog.csv", errors, () => assertSizeGuide(row.values.size_guide_ar ?? ""));
  if (!nameAr || !code || descriptionAr === undefined || descriptionAr === null || imageRefs === undefined || imageRefs === null || sizeGuideAr === undefined) return;
  if (!["available", "coming_soon", "hidden"].includes(publication)) {
    errors.push(err("catalog.csv", row.line, "publication", "INVALID_PUBLICATION", "حالة النشر يجب أن تكون available أو coming_soon أو hidden."));
    return;
  }
  output.push({ id: randomUUID(), key, code, nameAr, descriptionAr, categoryKey, defaultSellingPricePiasters: price, publication: publication as ProductPlan["publication"], imageRefs, sizeGuideAr, line: row.line });
}

function parseVariantRow(row: Row, key: string, output: Array<Omit<VariantPlan, "productId" | "sizeId" | "colorId">>, errors: OpeningImportLineErrorDto[]) {
  const productKey = referenceKey(required(row, "product_key", "catalog.csv", errors));
  const sizeKey = referenceKey(required(row, "size_key", "catalog.csv", errors));
  const colorKey = referenceKey(required(row, "color_key", "catalog.csv", errors));
  const override = money(row, "price_override_egp", "catalog.csv", errors, true);
  if (productKey && sizeKey && colorKey && override !== undefined) {
    output.push({ id: randomUUID(), key, productKey, sizeKey, colorKey, sellingPricePiastersOverride: override, line: row.line });
  }
}

function parseStockRows(
  rows: Row[],
  variants: Map<string, VariantPlan>,
  errors: OpeningImportLineErrorDto[],
): BatchPlan[] {
  const batches: BatchPlan[] = [];
  const batchKeys = new Set<string>();
  const variantOrders = new Set<string>();
  for (const row of rows) {
    const rawKey = required(row, "batch_key", "opening-stock.csv", errors);
    const branchCode = required(row, "branch_code", "opening-stock.csv", errors).toLowerCase();
    const rawVariantKey = required(row, "variant_key", "opening-stock.csv", errors);
    const key = rawKey ? localKey(rawKey, "opening-stock.csv", row.line, errors) : null;
    const variantKey = referenceKey(rawVariantKey);
    const parsedQuantity = integer(row, "quantity", "opening-stock.csv", errors, 1);
    const parsedCost = money(row, "unit_cost_egp", "opening-stock.csv", errors, false);
    const receiptDate = dateOnly(row, "receipt_date", "opening-stock.csv", errors);
    const batchOrder = integer(row, "batch_order", "opening-stock.csv", errors, 1);
    if (!key || !variantKey || parsedQuantity === null || parsedCost === null || !receiptDate || batchOrder === null) continue;
    if (branchCode !== "abshway" && branchCode !== "fayoum") {
      errors.push(err("opening-stock.csv", row.line, "branch_code", "UNKNOWN_BRANCH", "استخدم abshway أو fayoum."));
      continue;
    }
    const quantity = checked(row, "quantity", "opening-stock.csv", errors,
      () => assertQuantity(parsedQuantity, "كمية الدفعة غير صالحة."));
    const unitCostPiasters = checked(row, "unit_cost_egp", "opening-stock.csv", errors,
      () => assertPiasters(parsedCost, "تكلفة الوحدة غير صالحة."));
    if (quantity === undefined || quantity === null || unitCostPiasters === undefined || unitCostPiasters === null) continue;
    if (batchOrder > 86_399_999) {
      errors.push(err("opening-stock.csv", row.line, "batch_order", "INVALID_BATCH_ORDER", "ترتيب الدفعة أكبر من الحد المدعوم 86399999."));
      continue;
    }
    const variantId = variants.get(variantKey)?.id ?? explicitId(variantKey);
    if (!variantId) {
      errors.push(err("opening-stock.csv", row.line, "variant_key", "UNKNOWN_REFERENCE", "استخدم مفتاح متغير من الملف أو id:<UUID> لمتغير موجود."));
      continue;
    }
    if (batchKeys.has(key)) errors.push(err("opening-stock.csv", row.line, "batch_key", "DUPLICATE_KEY", `مفتاح الدفعة ${key} مكرر.`));
    batchKeys.add(key);
    const orderKey = `${branchCode}:${variantId}:${batchOrder}`;
    if (variantOrders.has(orderKey)) errors.push(err("opening-stock.csv", row.line, "batch_order", "DUPLICATE_BATCH_ORDER", "ترتيب الدفعة مكرر للمتغير نفسه."));
    variantOrders.add(orderKey);
    const recordedAt = new Date(Date.parse(`${receiptDate}T00:00:00.000Z`) + batchOrder);
    batches.push({
      id: randomUUID(), lineId: randomUUID(), movementId: randomUUID(), key, branchCode, variantKey, variantId,
      quantity, unitCostPiasters, receiptDate, batchOrder, recordedAt: recordedAt.toISOString(), line: row.line,
    });
  }
  return batches.sort((left, right) => left.receiptDate.localeCompare(right.receiptDate)
    || left.batchOrder - right.batchOrder || left.key.localeCompare(right.key));
}

function parseFile(file:"catalog.csv"|"opening-stock.csv"|"configuration.csv",source:string,headers:string[],errors:OpeningImportLineErrorDto[]):Row[]{if(Buffer.byteLength(source,"utf8")>MAX_BYTES){errors.push(err(file,1,null,"FILE_LIMIT","حجم الملف يتجاوز 1 ميجابايت."));return [];} let records:ParsedRecord[];try{records=parseCsv(normalizeText(source));}catch(e){errors.push(err(file,1,null,"CSV_SYNTAX",e instanceof Error?e.message:"صيغة CSV غير صالحة."));return [];} const head=records.shift()?.fields??[]; if(head.join("\u001f")!==headers.join("\u001f")){errors.push(err(file,1,null,"HEADER_MISMATCH",`عناوين ${file} لا تطابق القالب المعتمد.`));return [];} return records.flatMap((record)=>{if(record.fields.every(v=>v.trim()===""))return[];if(record.fields.length!==headers.length){errors.push(err(file,record.line,null,"COLUMN_COUNT","عدد الأعمدة لا يطابق القالب."));return[];} if(record.fields.some(v=>v.length>MAX_FIELD)){errors.push(err(file,record.line,null,"FIELD_LIMIT","إحدى الخانات تتجاوز 4000 حرف."));return[];} return[{line:record.line,values:Object.fromEntries(headers.map((h,i)=>[h,record.fields[i]?.trim()??""]))}];});}
function parseCsv(source:string):ParsedRecord[]{const rows:ParsedRecord[]=[];let row:string[]=[],field="",quoted=false,physicalLine=1,recordLine=1;for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else{field+=c;if(c==="\n")physicalLine++;}}else if(c==='"'){if(field)throw new Error(`علامة اقتباس في موضع غير صالح عند السطر ${physicalLine}.`);quoted=true;}else if(c===","){row.push(field);field="";}else if(c==="\n"){row.push(field);rows.push({line:recordLine,fields:row});row=[];field="";physicalLine++;recordLine=physicalLine;}else field+=c;}if(quoted)throw new Error(`علامة اقتباس غير مغلقة بدأت عند السطر ${recordLine}.`);if(field||row.length){row.push(field);rows.push({line:recordLine,fields:row});}return rows;}
function normalizeText(v:string){return v.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");} function sha(v:string){return createHash("sha256").update(v,"utf8").digest("hex");} function norm(v:string){return v.trim().toLocaleLowerCase("ar-EG");} function nullable(v:string){const x=v.trim();return x?x:null;} function splitRefs(v:string){return v.split("|").map(x=>x.trim()).filter(Boolean);} function splitIdentityRefs(v:string){return splitRefs(v).map(referenceKey);}
function referenceKey(value:string){const explicit=explicitId(value);return explicit?`id:${explicit}`:norm(value);}
function localKey(value:string,file:OpeningImportLineErrorDto["file"],line:number,errors:OpeningImportLineErrorDto[]):string|null{const key=norm(value);if(key.startsWith("id:")){errors.push(err(file,line,"key","RESERVED_KEY","البادئة id: محجوزة للمراجع الصريحة."));return null;}return key;}
function err(file:OpeningImportLineErrorDto["file"],line:number,column:string|null,code:string,messageAr:string):OpeningImportLineErrorDto{return{file,line,column,code,messageAr};}
function required(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[]){const v=r.values[c]??"";if(!v)e.push(err(f,r.line,c,"REQUIRED",`الخانة ${c} مطلوبة.`));return v;}
function integer(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[],min:number){const v=Number(r.values[c]);if(!Number.isSafeInteger(v)||v<min){e.push(err(f,r.line,c,"INVALID_INTEGER",`الخانة ${c} يجب أن تكون عدداً صحيحاً لا يقل عن ${min}.`));return null;}return v;}
function optionalInteger(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[],min:number){return r.values[c]?integer(r,c,f,e,min):undefined;}
function money(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[],optional:boolean):number|null|undefined{const raw=r.values[c]??"";if(!raw&&optional)return null;if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(raw)){e.push(err(f,r.line,c,"INVALID_MONEY",`الخانة ${c} يجب أن تكون مبلغ EGP موجباً بدقة قرشين.`));return optional?undefined:null;}const [whole,fraction=""]=raw.split(".");const value=Number(whole)*100+Number(fraction.padEnd(2,"0"));if(!Number.isSafeInteger(value)){e.push(err(f,r.line,c,"INVALID_MONEY","المبلغ أكبر من الحد المدعوم."));return optional?undefined:null;}return value;}
function percent(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[],optional:boolean):number|null|undefined{const raw=r.values[c]??"";if(!raw&&optional)return null;if(!/^(100(\.0{1,2})?|([1-9]?\d)(\.\d{1,2})?)$/.test(raw)){e.push(err(f,r.line,c,"INVALID_PERCENT","النسبة يجب أن تكون أكبر من صفر وحتى 100 بدقة منزلتين."));return optional?undefined:null;}return Math.round(Number(raw)*100);}
function boolean(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[]){const v=r.values[c];if(v==="true")return true;if(v==="false")return false;e.push(err(f,r.line,c,"INVALID_BOOLEAN",`الخانة ${c} يجب أن تكون true أو false.`));return null;}
function dateOnly(r:Row,c:string,f:OpeningImportLineErrorDto["file"],e:OpeningImportLineErrorDto[]){
  const v=r.values[c]??"";
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if(match){
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const parsed=new Date(Date.UTC(year,month-1,day));
    if(parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day)return v;
  }
  e.push(err(f,r.line,c,"INVALID_DATE",`الخانة ${c} يجب أن تكون بتاريخ YYYY-MM-DD صحيح.`));
  return null;
}
function duplicateNormalized<T extends {line:number}>(items:T[],column:string,file:OpeningImportLineErrorDto["file"],errors:OpeningImportLineErrorDto[],key:(v:T)=>string){const seen=new Set<string>();for(const item of items){const k=key(item);if(seen.has(k))errors.push(err(file,item.line,column,"DUPLICATE_VALUE","توجد قيمة مكررة في الملف."));seen.add(k);}}
function resolveRefs<T extends {id:string}>(refs:string[],map:Map<string,T>,column:string,row:Row,errors:OpeningImportLineErrorDto[]){const ids:string[]=[];for(const ref of refs){const id=map.get(ref)?.id??explicitId(ref);if(!id)errors.push(err("configuration.csv",row.line,column,"UNKNOWN_REFERENCE",`المرجع ${ref} غير صالح؛ استخدم مفتاحاً من الملف أو id:<UUID>.`));else ids.push(id);}return ids;}
function explicitId(value:string):string|null{const match=/^id:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value.trim());return match?.[1]?.toLowerCase()??null;}
function validateOffer(o:OfferPlan,errors:OpeningImportLineErrorDto[]){const bad=(message:string)=>errors.push(err("configuration.csv",o.line,"discount_type","INVALID_OFFER",message));if(o.endsOn<o.startsOn)bad("تاريخ نهاية العرض يسبق بدايته.");if(o.discountType==="percentage"&&(!o.percentageBasisPoints||o.fixedDiscountPiasters!==null))bad("العرض النسبي يحتاج percentage فقط.");if(o.discountType==="fixed"&&(!o.fixedDiscountPiasters||o.percentageBasisPoints!==null))bad("العرض الثابت يحتاج amount_egp فقط.");if(o.discountType==="fixed_bundle"&&o.bundlePricePiasters===null)bad("عرض الحزمة يحتاج bundle_total_egp وصفوف bundle_item.");if(o.discountType==="buy_x_get_y"&&(!o.buyQuantity||!o.rewardQuantity||!o.rewardPercentageBasisPoints))bad("عرض Buy-X-Get-Y يحتاج كميات الشراء والمكافأة ونسبة المكافأة.");}
function checked<T>(row:Row,column:string,file:OpeningImportLineErrorDto["file"],errors:OpeningImportLineErrorDto[],run:()=>T):T|null|undefined{try{return run();}catch(caught){errors.push(err(file,row.line,column,"INVALID_VALUE",caught instanceof Error?caught.message:"قيمة غير صالحة."));return undefined;}}
function offerWriteBody(offer:OfferPlan){return{nameAr:offer.nameAr,discountType:offer.discountType,percentageBasisPoints:offer.percentageBasisPoints,fixedDiscountPiasters:offer.fixedDiscountPiasters,bundlePricePiasters:offer.bundlePricePiasters,bundleItems:offer.bundleItems.map(({variantId,requiredQuantity})=>({variantId,requiredQuantity})),buyQuantity:offer.buyQuantity,rewardQuantity:offer.rewardQuantity,rewardPercentageBasisPoints:offer.rewardPercentageBasisPoints,buyProductIds:offer.buyProductIds,buyCategoryIds:offer.buyCategoryIds,rewardProductIds:offer.rewardProductIds,rewardCategoryIds:offer.rewardCategoryIds,startsOn:offer.startsOn,endsOn:offer.endsOn,active:offer.active,allowCoupon:offer.allowCoupon,productIds:offer.productIds,categoryIds:offer.categoryIds};}
function couponWriteBody(coupon:CouponPlan){return{code:coupon.code,discountType:coupon.discountType,percentageBasisPoints:coupon.percentageBasisPoints,fixedDiscountPiasters:coupon.fixedDiscountPiasters,startsOn:coupon.startsOn,endsOn:coupon.endsOn,active:coupon.active,allowAutomaticOffer:coupon.allowAutomaticOffer,usageLimit:coupon.usageLimit,productIds:coupon.productIds,categoryIds:coupon.categoryIds};}
function validateCategoryCycles(categories:OpeningImportPlan["categories"],errors:OpeningImportLineErrorDto[]){const byId=new Map(categories.map(v=>[v.id,v]));for(const category of categories){const seen=new Set<string>([category.id]);let parent=category.parentId?byId.get(category.parentId):undefined;while(parent){if(seen.has(parent.id)){errors.push(err("catalog.csv",category.line,"parent_key","CATEGORY_CYCLE","تسلسل التصنيفات يحتوي على حلقة."));break;}seen.add(parent.id);parent=parent.parentId?byId.get(parent.parentId):undefined;}}}
