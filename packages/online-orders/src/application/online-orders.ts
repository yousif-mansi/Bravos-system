import type { DeliveryAreaDto, OnlineOrderDto } from "@bravos/contracts";
import type {
  CheckoutQuoteDto,
  CheckoutQuoteRequest,
  PublicDeliveryAreaDto,
  PublicOrderSubmissionDto,
  PublicOrderSubmissionRequest,
} from "@bravos/contracts/public";
import { capabilitiesFor, ForbiddenError, isManager, NotFoundError, UnauthenticatedError } from "@bravos/identity";
import {
  InsufficientStockError,
  OnlineOrderOperationConflictError,
  OnlineOrderValidationError,
  QuoteStaleError,
  UnsupportedDeliveryAreaError,
  VariantNotOrderableError,
} from "../domain/errors.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type {
  CheckoutDependencies,
  DeliveryAreaWrite,
  OnlineOrderActorPort,
  OnlineOrderStore,
  OnlineOrderUnitOfWork,
  VerifiedAuth,
} from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA_KEYS = new Set(["nameAr", "feePiasters", "active"]);
const QUOTE_KEYS = new Set(["lines", "deliveryAreaId", "couponCode"]);
const SUBMIT_KEYS = new Set([
  "operationId", "quoteId", "lines", "deliveryAreaId", "couponCode", "customerName", "primaryPhone",
  "alternatePhone", "detailedAddress", "landmark", "notes",
]);

export type OnlineOrderServices = ReturnType<typeof createOnlineOrderServices>;

export function createOnlineOrderServices(ports: {
  actors: OnlineOrderActorPort;
  store: OnlineOrderStore;
  uow: OnlineOrderUnitOfWork;
  clock?: { now(): Date };
}) {
  const now = ports.clock?.now ?? (() => new Date());

  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }

  async function requireOrderReader(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (isManager(staff)) return staff;
    const branchId = await ports.actors.getSessionBranch(auth.sessionId);
    if (!capabilitiesFor(staff, branchId).orderRepresentative) throw new ForbiddenError();
    return staff;
  }

  return {
    async publicAreas(): Promise<PublicDeliveryAreaDto[]> {
      return ports.store.listPublicAreas();
    },

    async listAreas(auth: VerifiedAuth | null): Promise<DeliveryAreaDto[]> {
      await requireManager(auth);
      return ports.store.listAreas();
    },

    async createArea(auth: VerifiedAuth | null, input: unknown): Promise<DeliveryAreaDto> {
      const manager = await requireManager(auth);
      return ports.store.insertArea(parseArea(crypto.randomUUID(), manager.id, input, now()));
    },

    async updateArea(auth: VerifiedAuth | null, id: string, input: unknown): Promise<DeliveryAreaDto> {
      const manager = await requireManager(auth);
      const updated = await ports.store.updateArea(parseArea(uuid(id), manager.id, input, now()));
      if (!updated) throw new NotFoundError("منطقة التوصيل غير موجودة.");
      return updated;
    },

    async quote(input: unknown): Promise<CheckoutQuoteDto> {
      const request = parseQuote(input);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        const quoteId = crypto.randomUUID();
        const quote = await evaluateQuote(quoteId, request, store, dependencies, now(), false);
        await store.insertQuote({
          id: quoteId,
          requestFingerprint: fingerprint(request),
          request,
          quote,
          createdAt: now(),
        });
        return quote;
      });
    },

    async submit(input: unknown): Promise<{ created: boolean; result: PublicOrderSubmissionDto }> {
      const request = parseSubmission(input);
      const payloadFingerprint = fingerprint(request);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        // This must be the first transactional snapshot read. A stock-changing
        // transaction that was already in flight therefore finishes before a
        // new request is validated. Accepted replays still bypass every live
        // business revalidation below.
        await dependencies.inventory.lockStockClock("share");
        const accepted = await store.getSubmissionByOperation(request.operationId);
        if (accepted) {
          if (accepted.payloadFingerprint !== payloadFingerprint) throw new OnlineOrderOperationConflictError();
          return { created: false, result: accepted.result };
        }

        const quoted = await store.getQuote(request.quoteId, true);
        if (!quoted || quoted.requestFingerprint !== fingerprint(quotePart(request))) throw new QuoteStaleError();
        const submittedAt = now();
        const current = await evaluateQuote(quoted.id, quoted.request, store, dependencies, submittedAt, true);
        if (canonicalQuote(current) !== canonicalQuote(quoted.quote)) throw new QuoteStaleError();

        const result = await store.insertOrder({
          id: crypto.randomUUID(),
          operationId: request.operationId,
          payloadFingerprint,
          quoteId: request.quoteId,
          customerName: request.customerName,
          primaryPhone: request.primaryPhone,
          alternatePhone: request.alternatePhone ?? null,
          detailedAddress: request.detailedAddress,
          landmark: request.landmark ?? null,
          notes: request.notes ?? null,
          deliveryAreaId: request.deliveryAreaId,
          couponCode: request.couponCode ?? null,
          quote: quoted.quote,
          submittedAt,
        });
        return { created: true, result };
      }, request.operationId);
    },

    async listOrders(auth: VerifiedAuth | null): Promise<OnlineOrderDto[]> {
      await requireOrderReader(auth);
      return ports.store.listOrders();
    },

    async getOrder(auth: VerifiedAuth | null, id: string): Promise<OnlineOrderDto> {
      await requireOrderReader(auth);
      const order = await ports.store.getOrder(uuid(id));
      if (!order) throw new NotFoundError("طلب المتجر غير موجود.");
      return order;
    },
  };
}

async function evaluateQuote(
  quoteId: string,
  request: CheckoutQuoteRequest & { couponCode: string | null },
  store: OnlineOrderStore,
  dependencies: CheckoutDependencies,
  at: Date,
  stalePricing: boolean,
): Promise<CheckoutQuoteDto> {
  const area = await store.getArea(request.deliveryAreaId);
  if (!area?.active) throw new UnsupportedDeliveryAreaError();
  const ids = request.lines.map((line) => line.variantId);
  await dependencies.inventory.lockStockClock("share");
  const [catalogLines, quantities] = await Promise.all([
    dependencies.catalog.getLines(ids),
    dependencies.inventory.quantitiesFor(ids),
  ]);
  const catalogById = new Map(catalogLines.map((line) => [line.variantId, line]));
  for (const line of request.lines) {
    const catalog = catalogById.get(line.variantId);
    if (!catalog || catalog.publication !== "available") throw new VariantNotOrderableError();
    if ((quantities.get(line.variantId) ?? 0) < line.quantity) throw new InsufficientStockError();
  }
  const pricingLines = request.lines.map((line) => {
    const catalog = catalogById.get(line.variantId)!;
    return {
      variantId: line.variantId,
      productId: catalog.productId,
      categoryId: catalog.categoryId,
      quantity: line.quantity,
      listedUnitPricePiasters: catalog.listedUnitPricePiasters,
    };
  });
  let pricing;
  try {
    pricing = await dependencies.pricing.evaluate(pricingLines, at, request.couponCode);
  } catch (error) {
    if (stalePricing) throw new QuoteStaleError();
    throw error;
  }
  const ranges = pricing.couponUnitRanges;
  const lines = request.lines.map((line) => {
    const catalog = catalogById.get(line.variantId)!;
    const matching = ranges.filter((range) => range.variantId === line.variantId);
    const automatic = matching.reduce((sum, range) => safeAdd(sum, safeMultiply(range.automaticOfferDiscountPiasters, range.quantity)), 0);
    const coupon = matching.reduce((sum, range) => safeAdd(sum, safeMultiply(range.couponDiscountPiasters, range.quantity)), 0);
    const original = safeMultiply(catalog.listedUnitPricePiasters, line.quantity);
    return {
      variantId: line.variantId,
      productId: catalog.productId,
      productNameAr: catalog.productNameAr,
      sizeNameAr: catalog.sizeNameAr,
      colorNameAr: catalog.colorNameAr,
      quantity: line.quantity,
      listedUnitPricePiasters: catalog.listedUnitPricePiasters,
      originalPiasters: original,
      automaticOfferDiscountPiasters: automatic,
      couponDiscountPiasters: coupon,
      merchandiseTotalPiasters: original - automatic - coupon,
    };
  });
  const merchandiseOriginalPiasters = lines.reduce((sum, line) => safeAdd(sum, line.originalPiasters), 0);
  const merchandiseTotalPiasters = merchandiseOriginalPiasters
    - pricing.automaticOfferDiscountPiasters - pricing.couponDiscountPiasters;
  return {
    quoteId,
    area: { id: area.id, nameAr: area.nameAr, feePiasters: area.feePiasters },
    lines,
    merchandiseOriginalPiasters,
    automaticOfferDiscountPiasters: pricing.automaticOfferDiscountPiasters,
    couponDiscountPiasters: pricing.couponDiscountPiasters,
    merchandiseTotalPiasters,
    deliveryFeePiasters: area.feePiasters,
    finalTotalPiasters: safeAdd(merchandiseTotalPiasters, area.feePiasters),
    appliedAutomaticOffer: pricing.appliedAutomaticOffer ? {
      id: pricing.appliedAutomaticOffer.id,
      nameAr: pricing.appliedAutomaticOffer.nameAr,
      discountPiasters: pricing.appliedAutomaticOffer.discountPiasters,
    } : null,
    appliedCoupon: pricing.appliedCoupon ? {
      code: pricing.appliedCoupon.code,
      discountPiasters: pricing.appliedCoupon.discountPiasters,
    } : null,
  };
}

function parseArea(id: string, actorStaffId: string, input: unknown, changedAt: Date): DeliveryAreaWrite {
  const body = object(input, "بيانات منطقة التوصيل غير صالحة.");
  exactKeys(body, AREA_KEYS, "بيانات منطقة التوصيل غير صالحة.");
  if (typeof body.active !== "boolean") throw new OnlineOrderValidationError("حالة منطقة التوصيل غير صالحة.");
  return {
    id,
    nameAr: requiredText(body.nameAr, 120, "اسم منطقة التوصيل غير صالح."),
    feePiasters: integer(body.feePiasters, 0, Number.MAX_SAFE_INTEGER, "رسوم التوصيل غير صالحة."),
    active: body.active,
    actorStaffId,
    changedAt,
  };
}

function parseQuote(input: unknown): CheckoutQuoteRequest & { couponCode: string | null } {
  const body = object(input, "بيانات مراجعة الطلب غير صالحة.");
  exactKeys(body, QUOTE_KEYS, "بيانات مراجعة الطلب غير صالحة.");
  return {
    lines: lines(body.lines),
    deliveryAreaId: uuid(body.deliveryAreaId),
    couponCode: optionalText(body.couponCode, 64, "كود الكوبون غير صالح."),
  };
}

function parseSubmission(input: unknown): PublicOrderSubmissionRequest & {
  couponCode: string | null;
  alternatePhone: string | null;
  landmark: string | null;
  notes: string | null;
} {
  const body = object(input, "بيانات الطلب غير صالحة.");
  exactKeys(body, SUBMIT_KEYS, "بيانات الطلب غير صالحة.");
  return {
    operationId: uuid(body.operationId),
    quoteId: uuid(body.quoteId),
    ...parseQuote({ lines: body.lines, deliveryAreaId: body.deliveryAreaId, ...(body.couponCode !== undefined ? { couponCode: body.couponCode } : {}) }),
    customerName: requiredText(body.customerName, 160, "اسم العميل مطلوب."),
    primaryPhone: phone(body.primaryPhone, "رقم الموبايل الأساسي غير صالح."),
    alternatePhone: optionalPhone(body.alternatePhone),
    detailedAddress: requiredText(body.detailedAddress, 500, "العنوان التفصيلي مطلوب."),
    landmark: optionalText(body.landmark, 300, "العلامة المميزة غير صالحة."),
    notes: optionalText(body.notes, 1000, "الملاحظات غير صالحة."),
  };
}

function quotePart(input: ReturnType<typeof parseSubmission>) {
  return { lines: input.lines, deliveryAreaId: input.deliveryAreaId, couponCode: input.couponCode };
}

function lines(value: unknown): Array<{ variantId: string; quantity: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new OnlineOrderValidationError("سلة الطلب غير صالحة.");
  const totals = new Map<string, number>();
  for (const item of value) {
    const body = object(item, "بيانات منتج في السلة غير صالحة.");
    exactKeys(body, new Set(["variantId", "quantity"]), "بيانات منتج في السلة غير صالحة.");
    const variantId = uuid(body.variantId);
    const quantity = integer(body.quantity, 1, 1_000_000, "كمية المنتج غير صالحة.");
    totals.set(variantId, safeAdd(totals.get(variantId) ?? 0, quantity));
  }
  return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([variantId, quantity]) => ({ variantId, quantity }));
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OnlineOrderValidationError(message);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, message: string) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new OnlineOrderValidationError(message);
}

function requiredText(value: unknown, max: number, message: string): string {
  if (typeof value !== "string") throw new OnlineOrderValidationError(message);
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > max) throw new OnlineOrderValidationError(message);
  return normalized;
}

function optionalText(value: unknown, max: number, message: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, max, message);
}

function phone(value: unknown, message: string): string {
  const normalized = requiredText(value, 32, message);
  if (normalized.length < 6 || !/^[+\d][\d\s()\-]{5,31}$/.test(normalized)) throw new OnlineOrderValidationError(message);
  return normalized;
}

function optionalPhone(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return phone(value, "رقم الموبايل البديل غير صالح.");
}

function integer(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new OnlineOrderValidationError(message);
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new OnlineOrderValidationError("المعرّف غير صالح.");
  return value.toLowerCase();
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new OnlineOrderValidationError("إجمالي الطلب غير صالح.");
  return value;
}

function safeMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new OnlineOrderValidationError("إجمالي الطلب غير صالح.");
  return value;
}

function canonicalQuote(quote: CheckoutQuoteDto): string {
  const { quoteId: _quoteId, ...value } = quote;
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}
