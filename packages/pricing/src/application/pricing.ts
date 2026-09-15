import type { AutomaticOfferDto, CouponDto } from "@bravos/contracts";
import { ForbiddenError, isManager, NotFoundError, UnauthenticatedError } from "@bravos/identity";
import { assertCairoDate } from "../domain/cairo-date.ts";
import { evaluateAutomaticOffers, type PricingBasketLine } from "../domain/automatic-offers.ts";
import { PricingValidationError } from "../domain/errors.ts";
import { normalizeCouponCode } from "../domain/coupons.ts";
import type { AutomaticOfferStore, AutomaticOfferWrite, CouponStore, CouponWrite, PricingActorPort, VerifiedAuth } from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER_KEYS = new Set([
  "nameAr", "discountType", "percentageBasisPoints", "fixedDiscountPiasters",
  "bundlePricePiasters", "bundleItems", "buyQuantity", "rewardQuantity",
  "rewardPercentageBasisPoints", "buyProductIds", "buyCategoryIds",
  "rewardProductIds", "rewardCategoryIds",
  "startsOn", "endsOn", "active", "allowCoupon", "productIds", "categoryIds",
]);
const COUPON_KEYS = new Set([
  "code", "discountType", "percentageBasisPoints", "fixedDiscountPiasters",
  "startsOn", "endsOn", "active", "allowAutomaticOffer", "usageLimit", "productIds", "categoryIds",
]);

export type PricingServices = ReturnType<typeof createPricingServices>;

export function createPricingServices(ports: {
  actors: PricingActorPort;
  offers: AutomaticOfferStore;
  coupons: CouponStore;
  now?: () => Date;
}) {
  const now = ports.now ?? (() => new Date());

  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }

  return {
    async list(auth: VerifiedAuth | null): Promise<AutomaticOfferDto[]> {
      await requireManager(auth);
      return ports.offers.list();
    },

    async get(auth: VerifiedAuth | null, id: string): Promise<AutomaticOfferDto> {
      await requireManager(auth);
      const offer = await ports.offers.getById(assertUuid(id));
      if (!offer) throw new NotFoundError("العرض غير موجود.");
      return offer;
    },

    async create(auth: VerifiedAuth | null, input: unknown): Promise<AutomaticOfferDto> {
      const manager = await requireManager(auth);
      return ports.offers.insert(toWrite(crypto.randomUUID(), manager.id, input, now()));
    },

    async update(auth: VerifiedAuth | null, id: string, input: unknown): Promise<AutomaticOfferDto> {
      const manager = await requireManager(auth);
      const updated = await ports.offers.update(toWrite(assertUuid(id), manager.id, input, now()));
      if (!updated) throw new NotFoundError("العرض غير موجود.");
      return updated;
    },

    async evaluate(lines: PricingBasketLine[], at: Date = now()) {
      return evaluateAutomaticOffers({ offers: await ports.offers.list(), lines, at });
    },

    async listCoupons(auth: VerifiedAuth | null): Promise<CouponDto[]> {
      await requireManager(auth);
      return ports.coupons.list();
    },

    async getCoupon(auth: VerifiedAuth | null, id: string): Promise<CouponDto> {
      await requireManager(auth);
      const coupon = await ports.coupons.getById(assertUuid(id));
      if (!coupon) throw new NotFoundError("الكوبون غير موجود.");
      return coupon;
    },

    async createCoupon(auth: VerifiedAuth | null, input: unknown): Promise<CouponDto> {
      const manager = await requireManager(auth);
      return ports.coupons.insert(toCouponWrite(crypto.randomUUID(), manager.id, input, now()));
    },

    async updateCoupon(auth: VerifiedAuth | null, id: string, input: unknown): Promise<CouponDto> {
      const manager = await requireManager(auth);
      const updated = await ports.coupons.update(toCouponWrite(assertUuid(id), manager.id, input, now()));
      if (!updated) throw new NotFoundError("الكوبون غير موجود.");
      return updated;
    },
  };
}

function toCouponWrite(id: string, actorStaffId: string, input: unknown, changedAt: Date): CouponWrite {
  const body = expectObject(input);
  for (const key of Object.keys(body)) if (!COUPON_KEYS.has(key)) throw new PricingValidationError("بيانات الكوبون غير صالحة.");
  const code = text(body.code, 64, "كود الكوبون غير صالح.");
  if (body.discountType !== "percentage" && body.discountType !== "fixed") throw new PricingValidationError("نوع الخصم غير صالح.");
  const percentageBasisPoints = body.discountType === "percentage"
    ? integer(body.percentageBasisPoints, 1, 10_000, "نسبة الخصم غير صالحة.") : null;
  const fixedDiscountPiasters = body.discountType === "fixed"
    ? integer(body.fixedDiscountPiasters, 1, Number.MAX_SAFE_INTEGER, "قيمة الخصم غير صالحة.") : null;
  if (body.discountType === "percentage" && body.fixedDiscountPiasters != null) throw new PricingValidationError("بيانات الكوبون غير صالحة.");
  if (body.discountType === "fixed" && body.percentageBasisPoints != null) throw new PricingValidationError("بيانات الكوبون غير صالحة.");
  const startsOn = assertCairoDate(body.startsOn, "تاريخ بداية الكوبون غير صالح.");
  const endsOn = assertCairoDate(body.endsOn, "تاريخ نهاية الكوبون غير صالح.");
  if (endsOn < startsOn) throw new PricingValidationError("تاريخ نهاية الكوبون يسبق تاريخ البداية.");
  if (typeof body.active !== "boolean" || typeof body.allowAutomaticOffer !== "boolean") throw new PricingValidationError("إعدادات الكوبون غير صالحة.");
  const productIds = uuidList(body.productIds);
  const categoryIds = uuidList(body.categoryIds);
  if (productIds.length + categoryIds.length === 0) throw new PricingValidationError("اختر منتجاً أو تصنيفاً واحداً على الأقل.");
  return {
    id, code, normalizedCode: normalizeCouponCode(code), discountType: body.discountType,
    percentageBasisPoints, fixedDiscountPiasters, startsOn, endsOn, active: body.active,
    allowAutomaticOffer: body.allowAutomaticOffer,
    usageLimit: integer(body.usageLimit, 1, 2_147_483_647, "حد استخدام الكوبون غير صالح."),
    productIds, categoryIds, actorStaffId, changedAt,
  };
}

function toWrite(id: string, actorStaffId: string, input: unknown, changedAt: Date): AutomaticOfferWrite {
  const body = expectObject(input);
  for (const key of Object.keys(body)) {
    if (!OFFER_KEYS.has(key)) throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  const nameAr = text(body.nameAr, 120, "اسم العرض غير صالح.");
  if (body.discountType !== "percentage" && body.discountType !== "fixed"
    && body.discountType !== "fixed_bundle" && body.discountType !== "buy_x_get_y") {
    throw new PricingValidationError("نوع الخصم غير صالح.");
  }
  const percentageBasisPoints = body.discountType === "percentage"
    ? integer(body.percentageBasisPoints, 1, 10_000, "نسبة الخصم غير صالحة.")
    : null;
  const fixedDiscountPiasters = body.discountType === "fixed"
    ? integer(body.fixedDiscountPiasters, 1, Number.MAX_SAFE_INTEGER, "قيمة الخصم غير صالحة.")
    : null;
  const bundlePricePiasters = body.discountType === "fixed_bundle"
    ? integer(body.bundlePricePiasters, 0, Number.MAX_SAFE_INTEGER, "سعر الحزمة غير صالح.")
    : null;
  const bundleItems = body.discountType === "fixed_bundle" ? bundleItemList(body.bundleItems) : [];
  const buyQuantity = body.discountType === "buy_x_get_y"
    ? integer(body.buyQuantity, 1, Number.MAX_SAFE_INTEGER, "كمية الشراء غير صالحة.")
    : null;
  const rewardQuantity = body.discountType === "buy_x_get_y"
    ? integer(body.rewardQuantity, 1, Number.MAX_SAFE_INTEGER, "كمية المكافأة غير صالحة.")
    : null;
  const rewardPercentageBasisPoints = body.discountType === "buy_x_get_y"
    ? body.rewardPercentageBasisPoints === null || body.rewardPercentageBasisPoints === undefined
      ? 10_000
      : integer(body.rewardPercentageBasisPoints, 1, 10_000, "نسبة خصم المكافأة غير صالحة.")
    : null;
  const productIds = uuidList(body.productIds);
  const categoryIds = uuidList(body.categoryIds);
  const buyProductIds = uuidList(body.buyProductIds);
  const buyCategoryIds = uuidList(body.buyCategoryIds);
  const rewardProductIds = uuidList(body.rewardProductIds);
  const rewardCategoryIds = uuidList(body.rewardCategoryIds);
  if ((body.discountType !== "percentage" && body.percentageBasisPoints !== null && body.percentageBasisPoints !== undefined)
    || (body.discountType !== "fixed" && body.fixedDiscountPiasters !== null && body.fixedDiscountPiasters !== undefined)
    || (body.discountType !== "fixed_bundle" && (body.bundlePricePiasters !== null && body.bundlePricePiasters !== undefined
      || presentList(body.bundleItems)))
    || (body.discountType !== "buy_x_get_y" && (body.buyQuantity !== null && body.buyQuantity !== undefined
      || body.rewardQuantity !== null && body.rewardQuantity !== undefined
      || body.rewardPercentageBasisPoints !== null && body.rewardPercentageBasisPoints !== undefined
      || presentList(body.buyProductIds) || presentList(body.buyCategoryIds)
      || presentList(body.rewardProductIds) || presentList(body.rewardCategoryIds)))) {
    throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  const startsOn = assertCairoDate(body.startsOn, "تاريخ بداية العرض غير صالح.");
  const endsOn = assertCairoDate(body.endsOn, "تاريخ نهاية العرض غير صالح.");
  if (endsOn < startsOn) throw new PricingValidationError("تاريخ نهاية العرض يسبق تاريخ البداية.");
  if (typeof body.active !== "boolean" || typeof body.allowCoupon !== "boolean") {
    throw new PricingValidationError("إعدادات العرض غير صالحة.");
  }
  if ((body.discountType === "percentage" || body.discountType === "fixed")
    && productIds.length + categoryIds.length === 0) {
    throw new PricingValidationError("اختر منتجاً أو تصنيفاً واحداً على الأقل.");
  }
  if (body.discountType === "fixed_bundle" && (productIds.length + categoryIds.length > 0
    || buyProductIds.length + buyCategoryIds.length + rewardProductIds.length + rewardCategoryIds.length > 0)) {
    throw new PricingValidationError("بيانات الحزمة غير صالحة.");
  }
  if (body.discountType === "buy_x_get_y" && (productIds.length + categoryIds.length > 0
    || bundleItems.length > 0
    || buyProductIds.length + buyCategoryIds.length === 0
    || rewardProductIds.length + rewardCategoryIds.length === 0)) {
    throw new PricingValidationError("اختر نطاق الشراء ونطاق المكافأة.");
  }
  return {
    id, nameAr, discountType: body.discountType, percentageBasisPoints, fixedDiscountPiasters,
    bundlePricePiasters, bundleItems, buyQuantity, rewardQuantity, rewardPercentageBasisPoints,
    buyProductIds, buyCategoryIds, rewardProductIds, rewardCategoryIds,
    startsOn, endsOn, active: body.active, allowCoupon: body.allowCoupon,
    productIds, categoryIds, actorStaffId, changedAt,
  };
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, messageAr: string): string {
  if (typeof value !== "string") throw new PricingValidationError(messageAr);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length < 1 || normalized.length > max) throw new PricingValidationError(messageAr);
  return normalized;
}

function integer(value: unknown, min: number, max: number, messageAr: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new PricingValidationError(messageAr);
  }
  return value;
}

function uuidList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) throw new PricingValidationError("نطاق العرض غير صالح.");
  const ids = value.map((id) => assertUuid(id));
  return [...new Set(ids)].sort();
}

function bundleItemList(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new PricingValidationError("محتويات الحزمة غير صالحة.");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const body = expectObject(item);
    if (Object.keys(body).some((key) => key !== "variantId" && key !== "requiredQuantity")) {
      throw new PricingValidationError("محتويات الحزمة غير صالحة.");
    }
    const variantId = assertUuid(body.variantId);
    if (seen.has(variantId)) throw new PricingValidationError("لا يمكن تكرار متغير في الحزمة.");
    seen.add(variantId);
    return {
      variantId,
      requiredQuantity: integer(body.requiredQuantity, 1, Number.MAX_SAFE_INTEGER, "كمية الحزمة غير صالحة."),
    };
  }).sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function presentList(value: unknown): boolean {
  return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
}

function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PricingValidationError("المعرّف غير صالح.");
  }
  return value;
}
