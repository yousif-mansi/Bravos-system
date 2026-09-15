import type { AutomaticOfferDto } from "@bravos/contracts";
import { ForbiddenError, isManager, NotFoundError, UnauthenticatedError } from "@bravos/identity";
import { assertCairoDate } from "../domain/cairo-date.ts";
import { evaluateAutomaticOffers, type PricingBasketLine } from "../domain/automatic-offers.ts";
import { PricingValidationError } from "../domain/errors.ts";
import type { AutomaticOfferStore, AutomaticOfferWrite, PricingActorPort, VerifiedAuth } from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER_KEYS = new Set([
  "nameAr", "discountType", "percentageBasisPoints", "fixedDiscountPiasters",
  "startsOn", "endsOn", "active", "allowCoupon", "productIds", "categoryIds",
]);

export type PricingServices = ReturnType<typeof createPricingServices>;

export function createPricingServices(ports: {
  actors: PricingActorPort;
  offers: AutomaticOfferStore;
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
  };
}

function toWrite(id: string, actorStaffId: string, input: unknown, changedAt: Date): AutomaticOfferWrite {
  const body = expectObject(input);
  for (const key of Object.keys(body)) {
    if (!OFFER_KEYS.has(key)) throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  const nameAr = text(body.nameAr, 120, "اسم العرض غير صالح.");
  if (body.discountType !== "percentage" && body.discountType !== "fixed") {
    throw new PricingValidationError("نوع الخصم غير صالح.");
  }
  const percentageBasisPoints = body.discountType === "percentage"
    ? integer(body.percentageBasisPoints, 1, 10_000, "نسبة الخصم غير صالحة.")
    : null;
  const fixedDiscountPiasters = body.discountType === "fixed"
    ? integer(body.fixedDiscountPiasters, 1, Number.MAX_SAFE_INTEGER, "قيمة الخصم غير صالحة.")
    : null;
  if (body.discountType === "percentage" && body.fixedDiscountPiasters !== null && body.fixedDiscountPiasters !== undefined) {
    throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  if (body.discountType === "fixed" && body.percentageBasisPoints !== null && body.percentageBasisPoints !== undefined) {
    throw new PricingValidationError("بيانات العرض غير صالحة.");
  }
  const startsOn = assertCairoDate(body.startsOn, "تاريخ بداية العرض غير صالح.");
  const endsOn = assertCairoDate(body.endsOn, "تاريخ نهاية العرض غير صالح.");
  if (endsOn < startsOn) throw new PricingValidationError("تاريخ نهاية العرض يسبق تاريخ البداية.");
  if (typeof body.active !== "boolean" || typeof body.allowCoupon !== "boolean") {
    throw new PricingValidationError("إعدادات العرض غير صالحة.");
  }
  const productIds = uuidList(body.productIds);
  const categoryIds = uuidList(body.categoryIds);
  if (productIds.length + categoryIds.length === 0) {
    throw new PricingValidationError("اختر منتجاً أو تصنيفاً واحداً على الأقل.");
  }
  return {
    id, nameAr, discountType: body.discountType, percentageBasisPoints, fixedDiscountPiasters,
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
  if (!Array.isArray(value) || value.length > 500) throw new PricingValidationError("نطاق العرض غير صالح.");
  const ids = value.map((id) => assertUuid(id));
  return [...new Set(ids)].sort();
}

function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PricingValidationError("المعرّف غير صالح.");
  }
  return value;
}
