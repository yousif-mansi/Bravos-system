import { createHash, randomUUID } from "node:crypto";
import type { OpeningImportConfigurationPreviewDto, OpeningImportPreviewDto } from "@bravos/contracts";
import { cairoDateAt } from "@bravos/pricing";
import { OpeningImportConflictError, OpeningImportStaleError, OpeningImportValidationError } from "../domain/errors.ts";
import type { OpeningImportPlan } from "../domain/model.ts";
import type { OpeningImportCatalogPlan, OpeningImportStore, OpeningImportTransaction } from "./ports.ts";

export async function coordinatePreview(store: OpeningImportStore, input: {
  operationId: string;
  inputFingerprint: string;
  plan: OpeningImportPlan;
  actorStaffId: string;
  at: Date;
}): Promise<{ value: OpeningImportPreviewDto; created: boolean }> {
  return store.run(async (transaction) => {
    const existing = await transaction.findByOperation(input.operationId);
    if (existing) {
      if (existing.inputFingerprint !== input.inputFingerprint) {
        throw new OpeningImportConflictError("أُعيد استخدام معرّف الاستيراد مع ملفات مختلفة.");
      }
      return { value: existing.response, created: false };
    }
    const inspected = await inspect(transaction, input.plan);
    const plan = { ...input.plan, errors: [...input.plan.errors, ...inspected.errors] };
    const previewFingerprint = hashJson({ inputFingerprint: input.inputFingerprint, plan, state: inspected.state });
    const id = randomUUID();
    const value = toDto({
      id,
      operationId: input.operationId,
      inputFingerprint: input.inputFingerprint,
      previewFingerprint,
      plan,
      state: inspected,
      createdAt: input.at,
      acceptedAt: null,
    });
    await transaction.insertPreview({
      id,
      operationId: input.operationId,
      inputFingerprint: input.inputFingerprint,
      previewFingerprint,
      status: value.status,
      plan,
      state: inspected.state,
      response: value,
      actorStaffId: input.actorStaffId,
      createdAt: input.at,
    });
    return { value, created: true };
  });
}

export async function coordinateAcceptance(store: OpeningImportStore, input: {
  previewId: string;
  operationId: string;
  previewFingerprint: string;
  actorStaffId: string;
  at: Date;
}): Promise<{ value: OpeningImportPreviewDto; created: boolean }> {
  return store.run(async (transaction) => {
    const row = await transaction.findById(input.previewId);
    if (!row) throw new OpeningImportValidationError("معاينة الاستيراد غير موجودة.");
    if (row.operationId !== input.operationId || row.previewFingerprint !== input.previewFingerprint) {
      throw new OpeningImportConflictError("بيانات قبول الاستيراد لا تطابق المعاينة.");
    }
    if (row.status === "accepted") return { value: row.response, created: false };
    if (row.status !== "ready" || row.plan.errors.length > 0) {
      throw new OpeningImportValidationError("لا يمكن قبول معاينة تحتوي على أخطاء.");
    }

    await transaction.inventory.lockStockClock("update");
    await transaction.inventory.assertStockMutationAllowed();
    const current = await inspect(transaction, row.plan);
    if (hashJson(current.state) !== hashJson(row.state)) {
      throw new OpeningImportStaleError("تغيرت بيانات الكتالوج أو المخزون أو الإعدادات بعد المعاينة. أنشئ معاينة جديدة.");
    }
    await applyPlan(transaction, row.plan, input);
    const accepted = { ...row.response, status: "accepted" as const, acceptedAt: input.at.toISOString() };
    await transaction.markAccepted({
      previewId: row.id,
      response: accepted,
      actorStaffId: input.actorStaffId,
      acceptedAt: input.at,
    });
    return { value: accepted, created: true };
  });
}

async function applyPlan(transaction: OpeningImportTransaction, plan: OpeningImportPlan, input: {
  operationId: string;
  previewFingerprint: string;
  actorStaffId: string;
  at: Date;
}) {
  await transaction.catalog.insert(catalogPlan(plan), input.actorStaffId, input.at);
  if (plan.batches.length > 0) {
    const claimed = await transaction.inventory.claimOpeningImportOperation({
      operationId: input.operationId,
      payloadFingerprint: input.previewFingerprint,
      actorStaffId: input.actorStaffId,
    });
    if (claimed.kind !== "created") throw new OpeningImportConflictError("عملية المخزون مستخدمة بالفعل.");
    await transaction.inventory.importOpeningBatches({
      operationId: input.operationId,
      receiptId: plan.receiptId,
      lines: plan.batches.map((batch) => ({
        lineId: batch.lineId,
        batchId: batch.id,
        movementId: batch.movementId,
        variantId: batch.variantId,
        quantity: batch.quantity,
        unitCostPiasters: batch.unitCostPiasters,
        receiptDate: batch.receiptDate,
        recordedAt: new Date(batch.recordedAt),
      })),
    });
    await transaction.receiving.insertOpeningReceipt({
      receiptId: plan.receiptId,
      operationId: input.operationId,
      receiptDate: cairoDateAt(input.at),
      actorStaffId: input.actorStaffId,
      recordedAt: input.at,
      lines: plan.batches.map((batch, index) => ({
        id: batch.lineId,
        variantId: batch.variantId,
        quantity: batch.quantity,
        unitCostPiasters: batch.unitCostPiasters,
        batchId: batch.id,
        lineIndex: index,
      })),
    });
    await transaction.inventory.bumpStockVersion();
  }
  await transaction.inventory.applyOpeningSettings({
    actorStaffId: input.actorStaffId,
    at: input.at,
    defaultThreshold: plan.inventoryDefaultThreshold,
    variantThresholds: plan.variantThresholds.map((value) => ({ variantId: value.variantId, threshold: value.threshold })),
  });
  await transaction.expenses.insertOpeningCategories(plan.expenseCategories, input.actorStaffId, input.at);
  await transaction.pricing.insertOpeningPricing({
    offers: plan.offers.map((value) => ({ ...value, actorStaffId: input.actorStaffId, changedAt: input.at })),
    coupons: plan.coupons.map((value) => ({ ...value, actorStaffId: input.actorStaffId, changedAt: input.at })),
  });
  if (plan.contacts) {
    await transaction.storefront.upsertOpeningContacts({ ...plan.contacts, actorStaffId: input.actorStaffId, at: input.at });
  }
  await transaction.orders.insertOpeningConfiguration({
    areas: plan.deliveryAreas,
    settings: plan.onlineOrderSettings,
    actorStaffId: input.actorStaffId,
    at: input.at,
  });
}

async function inspect(transaction: OpeningImportTransaction, plan: OpeningImportPlan) {
  const cplan = catalogPlan(plan);
  const [catalog, inventory, expenses, pricing, contacts, orders] = await Promise.all([
    transaction.catalog.inspect(cplan),
    transaction.inventory.openingImportState([...new Set([
      ...cplan.referencedVariants.map((value) => value.id),
      ...plan.variants.map((value) => value.id),
    ])]),
    transaction.expenses.inspectOpeningCategories(plan.expenseCategories),
    transaction.pricing.inspectOpeningPricing({ offers: plan.offers, coupons: plan.coupons }),
    transaction.storefront.inspectOpeningContacts(),
    transaction.orders.inspectOpeningConfiguration(plan.deliveryAreas),
  ]);
  return {
    state: { catalog: catalog.state, inventory, expenses: expenses.state, pricing: pricing.state, contacts, orders: orders.state },
    errors: [...catalog.errors, ...expenses.errors, ...pricing.errors, ...orders.errors],
    inventory,
    contacts,
    orderSettings: orders.settings,
  };
}

function catalogPlan(plan: OpeningImportPlan): OpeningImportCatalogPlan {
  const newVariants = new Set(plan.variants.map((value) => value.id));
  const newProducts = new Set(plan.products.map((value) => value.id));
  const newCategories = new Set(plan.categories.map((value) => value.id));
  const newSizes = new Set(plan.sizes.map((value) => value.id));
  const newColors = new Set(plan.colors.map((value) => value.id));
  const reference = (id: string, file: "catalog.csv" | "opening-stock.csv" | "configuration.csv", line: number, column: string) => ({ id, file, line, column });
  return {
    categories: plan.categories,
    sizes: plan.sizes,
    colors: plan.colors,
    products: plan.products,
    variants: plan.variants,
    referencedVariants: [
      ...plan.batches.map((value) => reference(value.variantId, "opening-stock.csv", value.line, "variant_key")),
      ...plan.variantThresholds.map((value) => reference(value.variantId, "configuration.csv", value.line, "variant_key")),
      ...plan.offers.flatMap((value) => value.bundleItems.map((item) => reference(item.variantId, "configuration.csv", item.line, "variant_key"))),
    ].filter((value) => !newVariants.has(value.id)),
    referencedProducts: [
      ...plan.variants.map((value) => reference(value.productId, "catalog.csv", value.line, "product_key")),
      ...plan.offers.flatMap((value) => [
        ...value.productIds.map((id) => reference(id, "configuration.csv", value.line, "product_keys")),
        ...value.buyProductIds.map((id) => reference(id, "configuration.csv", value.line, "buy_product_keys")),
        ...value.rewardProductIds.map((id) => reference(id, "configuration.csv", value.line, "reward_product_keys")),
      ]),
      ...plan.coupons.flatMap((value) => value.productIds.map((id) => reference(id, "configuration.csv", value.line, "product_keys"))),
    ].filter((value) => !newProducts.has(value.id)),
    referencedCategories: [
      ...plan.categories.flatMap((value) => value.parentId ? [reference(value.parentId, "catalog.csv", value.line, "parent_key")] : []),
      ...plan.products.map((value) => reference(value.categoryId, "catalog.csv", value.line, "category_key")),
      ...plan.offers.flatMap((value) => [
        ...value.categoryIds.map((id) => reference(id, "configuration.csv", value.line, "category_keys")),
        ...value.buyCategoryIds.map((id) => reference(id, "configuration.csv", value.line, "buy_category_keys")),
        ...value.rewardCategoryIds.map((id) => reference(id, "configuration.csv", value.line, "reward_category_keys")),
      ]),
      ...plan.coupons.flatMap((value) => value.categoryIds.map((id) => reference(id, "configuration.csv", value.line, "category_keys"))),
    ].filter((value) => !newCategories.has(value.id)),
    referencedSizes: plan.variants.map((value) => reference(value.sizeId, "catalog.csv", value.line, "size_key")).filter((value) => !newSizes.has(value.id)),
    referencedColors: plan.variants.map((value) => reference(value.colorId, "catalog.csv", value.line, "color_key")).filter((value) => !newColors.has(value.id)),
  };
}

function toDto(input: { id: string; operationId: string; inputFingerprint: string; previewFingerprint: string; plan: OpeningImportPlan; state: Awaited<ReturnType<typeof inspect>>; createdAt: Date; acceptedAt: Date | null }): OpeningImportPreviewDto {
  return {
    id: input.id,
    operationId: input.operationId,
    status: input.plan.errors.length ? "invalid" : "ready",
    inputFingerprint: input.inputFingerprint,
    previewFingerprint: input.previewFingerprint,
    counts: input.plan.counts,
    catalog: {
      categories: input.plan.categories.map((v) => ({ key: v.key, nameAr: v.nameAr, parentKey: v.parentKey })),
      sizes: input.plan.sizes.map((v) => ({ key: v.key, nameAr: v.nameAr })),
      colors: input.plan.colors.map((v) => ({ key: v.key, nameAr: v.nameAr })),
      products: input.plan.products.map((v) => ({ key: v.key, code: v.code, nameAr: v.nameAr, descriptionAr: v.descriptionAr, categoryKey: v.categoryKey, defaultSellingPricePiasters: v.defaultSellingPricePiasters, publication: v.publication, imageRefs: v.imageRefs, sizeGuideAr: v.sizeGuideAr })),
      variants: input.plan.variants.map((v) => ({ key: v.key, productKey: v.productKey, sizeKey: v.sizeKey, colorKey: v.colorKey, sellingPricePiastersOverride: v.sellingPricePiastersOverride })),
    },
    batches: input.plan.batches.map((v) => ({ key: v.key, variantKey: v.variantKey, quantity: v.quantity, unitCostPiasters: v.unitCostPiasters, receiptDate: v.receiptDate, batchOrder: v.batchOrder })),
    configuration: configPreview(input.plan, input.state),
    configurationDetails: configurationDetails(input.plan),
    errors: input.plan.errors,
    createdAt: input.createdAt.toISOString(),
    acceptedAt: input.acceptedAt?.toISOString() ?? null,
  };
}

function configPreview(plan: OpeningImportPlan, state: Awaited<ReturnType<typeof inspect>>): OpeningImportConfigurationPreviewDto[] {
  const rows: OpeningImportConfigurationPreviewDto[] = [];
  const details = configurationDetails(plan);
  const add = (recordType: string, key: string, labelAr: string, proposed: unknown, current: unknown = null) => rows.push({ recordType, key, labelAr, proposedValue: display(proposed), currentValue: current === null ? null : display(current) });
  if (plan.inventoryDefaultThreshold !== null) add("inventory_default_threshold", "default", "حد المخزون المنخفض الافتراضي", plan.inventoryDefaultThreshold, state.inventory.defaultThreshold);
  for (const value of plan.variantThresholds) add("variant_low_stock_threshold", value.key, `حد مخزون ${value.variantKey}`, value.threshold, state.inventory.variantThresholds.find((item) => item.variantId === value.variantId)?.threshold ?? null);
  for (const value of plan.expenseCategories) add("expense_category", value.key, value.nameAr, { nameAr: value.nameAr, active: value.active });
  for (const value of plan.deliveryAreas) add("delivery_area", value.key, value.nameAr, { nameAr: value.nameAr, feePiasters: value.feePiasters, active: value.active });
  for (const value of details.offers) add("automatic_offer", value.key, value.nameAr, value);
  for (const value of details.coupons) add("coupon", value.key, value.code, value);
  if (plan.contacts) add("storefront_contacts", "default", "روابط التواصل", plan.contacts, state.contacts);
  if (plan.onlineOrderSettings) add("online_order_settings", "default", "سياسة الطلبات غير المجابة", plan.onlineOrderSettings, state.orderSettings);
  return rows;
}

function configurationDetails(plan: OpeningImportPlan): OpeningImportPreviewDto["configurationDetails"] {
  const refs = new Map<string, string>([...plan.categories, ...plan.sizes, ...plan.colors, ...plan.products, ...plan.variants].map((value) => [value.id, value.key]));
  const ref = (id: string) => refs.get(id) ?? `id:${id}`;
  return {
    inventoryDefaultThreshold: plan.inventoryDefaultThreshold,
    variantThresholds: plan.variantThresholds.map((v) => ({ key: v.key, variantKey: v.variantKey, threshold: v.threshold })),
    expenseCategories: plan.expenseCategories.map((v) => ({ key: v.key, nameAr: v.nameAr, active: v.active })),
    deliveryAreas: plan.deliveryAreas.map((v) => ({ key: v.key, nameAr: v.nameAr, feePiasters: v.feePiasters, active: v.active })),
    contacts: plan.contacts,
    onlineOrderSettings: plan.onlineOrderSettings,
    offers: plan.offers.map((v) => ({ key: v.key, nameAr: v.nameAr, discountType: v.discountType, percentageBasisPoints: v.percentageBasisPoints, fixedDiscountPiasters: v.fixedDiscountPiasters, bundlePricePiasters: v.bundlePricePiasters, bundleItems: v.bundleItems.map((i) => ({ variantKey: ref(i.variantId), requiredQuantity: i.requiredQuantity })), buyQuantity: v.buyQuantity, rewardQuantity: v.rewardQuantity, rewardPercentageBasisPoints: v.rewardPercentageBasisPoints, productKeys: v.productIds.map(ref), categoryKeys: v.categoryIds.map(ref), buyProductKeys: v.buyProductIds.map(ref), buyCategoryKeys: v.buyCategoryIds.map(ref), rewardProductKeys: v.rewardProductIds.map(ref), rewardCategoryKeys: v.rewardCategoryIds.map(ref), startsOn: v.startsOn, endsOn: v.endsOn, active: v.active, allowCoupon: v.allowCoupon })),
    coupons: plan.coupons.map((v) => ({ key: v.key, code: v.code, discountType: v.discountType, percentageBasisPoints: v.percentageBasisPoints, fixedDiscountPiasters: v.fixedDiscountPiasters, startsOn: v.startsOn, endsOn: v.endsOn, active: v.active, allowAutomaticOffer: v.allowAutomaticOffer, usageLimit: v.usageLimit, productKeys: v.productIds.map(ref), categoryKeys: v.categoryIds.map(ref) })),
  };
}

function display(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value); }
function hashJson(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
