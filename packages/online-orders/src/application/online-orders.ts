import type {
  DeliveryAreaDto,
  OnlineOrderAgreementQuoteDto,
  OnlineOrderDto,
  OnlineOrderSettingsDto,
} from "@bravos/contracts";
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
  OnlineOrderRevisionConflictError,
  OnlineOrderStateConflictError,
  OnlineOrderValidationError,
  QuoteStaleError,
  UnreachablePolicyError,
  UnsupportedDeliveryAreaError,
  VariantNotOrderableError,
} from "../domain/errors.ts";
import { fingerprint } from "../domain/fingerprint.ts";
import type {
  CheckoutDependencies,
  CheckoutPricingResult,
  DeliveryAreaWrite,
  OnlineOrderActorPort,
  OnlineOrderStore,
  OnlineOrderUnitOfWork,
  StoredOrderOperation,
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
        await dependencies.inventory.lockStockClock("share");
        const quoteId = crypto.randomUUID();
        const evaluated = await evaluateQuote(quoteId, request, store, dependencies, now(), false);
        await store.insertQuote({
          id: quoteId,
          requestFingerprint: fingerprint(request),
          request,
          quote: evaluated.quote,
          createdAt: now(),
        });
        return evaluated.quote;
      });
    },

    async submit(input: unknown): Promise<{ created: boolean; result: PublicOrderSubmissionDto }> {
      const request = parseSubmission(input);
      const payloadFingerprint = fingerprint(request);
      return ports.uow.run(async ({ store, ...dependencies }) => {
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
        if (canonicalCheckoutQuote(current.quote) !== canonicalCheckoutQuote(quoted.quote)) throw new QuoteStaleError();

        const result = await store.insertOrder({
          id: crypto.randomUUID(), operationId: request.operationId, payloadFingerprint, quoteId: request.quoteId,
          customerName: request.customerName, primaryPhone: request.primaryPhone,
          alternatePhone: request.alternatePhone, detailedAddress: request.detailedAddress,
          landmark: request.landmark, notes: request.notes, deliveryAreaId: request.deliveryAreaId,
          couponCode: request.couponCode, quote: quoted.quote, submittedAt,
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
      return requiredOrder(await ports.store.getOrder(uuid(id)));
    },

    async createAgreementQuote(auth: VerifiedAuth | null, id: string, input: unknown): Promise<OnlineOrderAgreementQuoteDto> {
      const actor = await requireOrderReader(auth);
      const orderId = uuid(id);
      const request = parseAgreementQuote(input);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        await dependencies.inventory.lockStockClock("share");
        const order = requiredOrder(await store.getOrder(orderId, true));
        assertPendingRevision(order, request.expectedRevision);
        const reviewedAt = now();
        const quoteId = crypto.randomUUID();
        const evaluated = await evaluateQuote(
          quoteId,
          { lines: request.lines, couponCode: request.couponCode, deliveryAreaId: order.deliveryArea.id },
          store,
          dependencies,
          reviewedAt,
          false,
        );
        const base = {
          quoteId, orderId, orderRevision: order.revision, couponCode: request.couponCode,
          lines: evaluated.quote.lines.map((line) => ({
            id: crypto.randomUUID(),
            ...line,
            availableQuantity: evaluated.quantities.get(line.variantId) ?? 0,
            units: evaluated.pricing.couponUnitRanges
              .filter((range) => range.variantId === line.variantId)
              .map((range) => ({
                unitIndex: range.unitIndex,
                quantity: range.quantity,
                listedPiasters: range.listedPiasters,
                automaticOfferDiscountPiasters: range.automaticOfferDiscountPiasters,
                couponDiscountPiasters: range.couponDiscountPiasters,
                paidPiasters: range.listedPiasters
                  - range.automaticOfferDiscountPiasters - range.couponDiscountPiasters,
              })),
          })),
          merchandiseOriginalPiasters: evaluated.quote.merchandiseOriginalPiasters,
          automaticOfferDiscountPiasters: evaluated.quote.automaticOfferDiscountPiasters,
          couponDiscountPiasters: evaluated.quote.couponDiscountPiasters,
          merchandiseTotalPiasters: evaluated.quote.merchandiseTotalPiasters,
          deliveryFeePiasters: evaluated.quote.deliveryFeePiasters,
          finalTotalPiasters: evaluated.quote.finalTotalPiasters,
          appliedAutomaticOffer: evaluated.pricing.appliedAutomaticOffer,
          appliedCoupon: evaluated.pricing.appliedCoupon,
          reviewedByStaffId: actor.id,
          reviewedAt: reviewedAt.toISOString(),
        };
        const reviewDigest = fingerprint(reviewComparable(base));
        const quote: OnlineOrderAgreementQuoteDto = { ...base, reviewDigest };
        await store.insertAgreementQuote({
          id: quoteId, orderId, orderRevision: order.revision,
          requestFingerprint: fingerprint(request), reviewDigest,
          request: { lines: request.lines, couponCode: request.couponCode },
          quote, pricingSnapshot: evaluated.pricing, actorStaffId: actor.id, reviewedAt,
        });
        return quote;
      });
    },

    async agreeRevision(auth: VerifiedAuth | null, id: string, input: unknown) {
      const actor = await requireOrderReader(auth);
      const orderId = uuid(id);
      const command = parseAgreedRevision(input);
      const payloadFingerprint = fingerprint(command);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        await dependencies.inventory.lockStockClock("share");
        const replay = await replayMutation(store, orderId, "agreed_revision", command.operationId, payloadFingerprint);
        if (replay) return { created: false, result: replay };
        const order = requiredOrder(await store.getOrder(orderId, true));
        assertPendingRevision(order, command.expectedRevision);
        const quote = await store.getAgreementQuote(command.quoteId, true);
        if (!quote || quote.orderId !== orderId || quote.orderRevision !== order.revision || quote.reviewDigest !== command.reviewDigest) {
          throw new QuoteStaleError("مراجعة الاتفاق لا تطابق النسخة الحالية للطلب.");
        }
        const result = await store.insertAgreedRevision({
          orderId, operationId: command.operationId, payloadFingerprint, actorStaffId: actor.id,
          quoteId: quote.id, reviewDigest: command.reviewDigest, agreedAt: now(), nextRevision: order.revision + 1,
        });
        return { created: true, result };
      }, command.operationId);
    },

    async recordContactAttempt(auth: VerifiedAuth | null, id: string, input: unknown) {
      const actor = await requireOrderReader(auth);
      const orderId = uuid(id);
      const command = parseContactAttempt(input);
      const payloadFingerprint = fingerprint(command);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        await dependencies.inventory.lockStockClock("share");
        const replay = await replayMutation(store, orderId, "contact_attempt", command.operationId, payloadFingerprint);
        if (replay) return { created: false, result: replay };
        const order = requiredOrder(await store.getOrder(orderId, true));
        assertPendingRevision(order, command.expectedRevision);
        const result = await store.insertContactAttempt({
          orderId, operationId: command.operationId, payloadFingerprint, actorStaffId: actor.id,
          outcome: command.outcome, note: command.note, occurredAt: now(), nextRevision: order.revision + 1,
        });
        return { created: true, result };
      }, command.operationId);
    },

    async confirm(auth: VerifiedAuth | null, id: string, input: unknown) {
      const actor = await requireOrderReader(auth);
      const orderId = uuid(id);
      const command = parseConfirmation(input);
      const payloadFingerprint = fingerprint(command);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        await dependencies.inventory.lockStockClock("update");
        const replay = await replayMutation(store, orderId, "confirmation", command.operationId, payloadFingerprint);
        if (replay) return { created: false, result: replay };
        const order = requiredOrder(await store.getOrder(orderId, true));
        assertPendingRevision(order, command.expectedRevision);
        const agreed = order.agreedRevision;
        if (!agreed || agreed.version !== command.agreedRevision) throw new QuoteStaleError("يلزم تأكيد نسخة الاتفاق الحالية.");
        const accepted = await store.getAgreementQuote(agreed.quote.quoteId, true);
        if (!accepted || accepted.reviewDigest !== agreed.quote.reviewDigest) throw new QuoteStaleError();
        const confirmedAt = now();
        const current = await evaluateQuote(
          accepted.id,
          { lines: accepted.request.lines, couponCode: accepted.request.couponCode, deliveryAreaId: order.deliveryArea.id },
          store,
          dependencies,
          confirmedAt,
          true,
        );
        if (canonicalAgreementPrice(current.quote, current.pricing) !== canonicalAgreementPrice(accepted.quote, accepted.pricingSnapshot)) {
          throw new QuoteStaleError("تغير السعر أو العرض. راجع الاتفاق مع العميل من جديد.");
        }
        const protection = await dependencies.inventory.protectOnlineOrder({
          orderId, operationId: command.operationId, payloadFingerprint, actorStaffId: actor.id,
          lines: accepted.request.lines,
        });
        if (accepted.pricingSnapshot.appliedCoupon) {
          await dependencies.couponUsage.claim({
            couponId: accepted.pricingSnapshot.appliedCoupon.id,
            sourceType: "online_order", sourceId: orderId, operationId: command.operationId,
            payloadFingerprint, claimedAt: confirmedAt,
          });
        }
        if (protection.kind === "created") await dependencies.inventory.bumpStockVersion();
        const result = await store.confirm({
          orderId, operationId: command.operationId, payloadFingerprint, actorStaffId: actor.id,
          agreedRevision: agreed.version, quoteId: accepted.id, reviewDigest: accepted.reviewDigest,
          confirmedAt, nextRevision: order.revision + 1,
        });
        return { created: true, result };
      }, command.operationId);
    },

    async cancelUnreachable(auth: VerifiedAuth | null, id: string, input: unknown) {
      const actor = await requireOrderReader(auth);
      const orderId = uuid(id);
      const command = parseUnreachableCancellation(input);
      const payloadFingerprint = fingerprint(command);
      return ports.uow.run(async ({ store, ...dependencies }) => {
        await dependencies.inventory.lockStockClock("share");
        const replay = await replayMutation(store, orderId, "unreachable_cancellation", command.operationId, payloadFingerprint);
        if (replay) return { created: false, result: replay };
        const order = requiredOrder(await store.getOrder(orderId, true));
        assertPendingRevision(order, command.expectedRevision);
        const settings = await store.getSettings();
        const elapsed = now().getTime() - new Date(order.submittedAt).getTime();
        const unanswered = order.contactAttempts.filter((attempt) => attempt.outcome === "no_answer").length;
        if (elapsed < settings.unreachableWaitHours * 60 * 60 * 1000 || unanswered < settings.minimumContactAttempts) {
          throw new UnreachablePolicyError();
        }
        const result = await store.cancelUnreachable({
          orderId, operationId: command.operationId, payloadFingerprint, actorStaffId: actor.id,
          reason: command.reason, cancelledAt: now(), nextRevision: order.revision + 1,
        });
        return { created: true, result };
      }, command.operationId);
    },

    async getSettings(auth: VerifiedAuth | null): Promise<OnlineOrderSettingsDto> {
      await requireOrderReader(auth);
      return ports.store.getSettings();
    },

    async updateSettings(auth: VerifiedAuth | null, input: unknown): Promise<OnlineOrderSettingsDto> {
      const actor = await requireManager(auth);
      const command = parseSettings(input);
      const result = await ports.store.updateSettings({ ...command, actorStaffId: actor.id, changedAt: now() });
      if (!result) throw new OnlineOrderRevisionConflictError("تغيرت إعدادات الطلبات. حدّث الصفحة ثم أعد المحاولة.");
      return result;
    },
  };
}

type EvaluatedQuote = { quote: CheckoutQuoteDto; pricing: CheckoutPricingResult; quantities: Map<string, number> };

async function evaluateQuote(
  quoteId: string,
  request: CheckoutQuoteRequest & { couponCode: string | null },
  store: OnlineOrderStore,
  dependencies: CheckoutDependencies,
  at: Date,
  stalePricing: boolean,
): Promise<EvaluatedQuote> {
  const area = await store.getArea(request.deliveryAreaId);
  if (!area?.active) throw new UnsupportedDeliveryAreaError();
  const ids = request.lines.map((line) => line.variantId);
  const [catalogLines, quantities] = await Promise.all([
    dependencies.catalog.getLines(ids), dependencies.inventory.quantitiesFor(ids),
  ]);
  const catalogById = new Map(catalogLines.map((line) => [line.variantId, line]));
  for (const line of request.lines) {
    const catalog = catalogById.get(line.variantId);
    if (!catalog || catalog.publication !== "available") throw new VariantNotOrderableError();
    if ((quantities.get(line.variantId) ?? 0) < line.quantity) throw new InsufficientStockError();
  }
  const pricingLines = request.lines.map((line) => {
    const catalog = catalogById.get(line.variantId)!;
    return { variantId: line.variantId, productId: catalog.productId, categoryId: catalog.categoryId,
      quantity: line.quantity, listedUnitPricePiasters: catalog.listedUnitPricePiasters };
  });
  let pricing: CheckoutPricingResult;
  try { pricing = await dependencies.pricing.evaluate(pricingLines, at, request.couponCode); }
  catch (error) { if (stalePricing) throw new QuoteStaleError(); throw error; }
  const lines = request.lines.map((line) => {
    const catalog = catalogById.get(line.variantId)!;
    const matching = pricing.couponUnitRanges.filter((range) => range.variantId === line.variantId);
    const automatic = matching.reduce((sum, range) => safeAdd(sum, safeMultiply(range.automaticOfferDiscountPiasters, range.quantity)), 0);
    const coupon = matching.reduce((sum, range) => safeAdd(sum, safeMultiply(range.couponDiscountPiasters, range.quantity)), 0);
    const original = safeMultiply(catalog.listedUnitPricePiasters, line.quantity);
    return {
      variantId: line.variantId, productId: catalog.productId, productNameAr: catalog.productNameAr,
      sizeNameAr: catalog.sizeNameAr, colorNameAr: catalog.colorNameAr, quantity: line.quantity,
      listedUnitPricePiasters: catalog.listedUnitPricePiasters, originalPiasters: original,
      automaticOfferDiscountPiasters: automatic, couponDiscountPiasters: coupon,
      merchandiseTotalPiasters: original - automatic - coupon,
    };
  });
  const merchandiseOriginalPiasters = lines.reduce((sum, line) => safeAdd(sum, line.originalPiasters), 0);
  const merchandiseTotalPiasters = merchandiseOriginalPiasters
    - pricing.automaticOfferDiscountPiasters - pricing.couponDiscountPiasters;
  return {
    pricing, quantities,
    quote: {
      quoteId, area: { id: area.id, nameAr: area.nameAr, feePiasters: area.feePiasters }, lines,
      merchandiseOriginalPiasters, automaticOfferDiscountPiasters: pricing.automaticOfferDiscountPiasters,
      couponDiscountPiasters: pricing.couponDiscountPiasters, merchandiseTotalPiasters,
      deliveryFeePiasters: area.feePiasters, finalTotalPiasters: safeAdd(merchandiseTotalPiasters, area.feePiasters),
      appliedAutomaticOffer: pricing.appliedAutomaticOffer ? {
        id: pricing.appliedAutomaticOffer.id, nameAr: pricing.appliedAutomaticOffer.nameAr,
        discountPiasters: pricing.appliedAutomaticOffer.discountPiasters,
      } : null,
      appliedCoupon: pricing.appliedCoupon ? {
        code: pricing.appliedCoupon.code, discountPiasters: pricing.appliedCoupon.discountPiasters,
      } : null,
    },
  };
}

async function replayMutation(
  store: OnlineOrderStore,
  orderId: string,
  operationType: StoredOrderOperation["operationType"],
  operationId: string,
  payloadFingerprint: string,
): Promise<OnlineOrderDto | null> {
  const accepted = await store.getOperation(operationId);
  if (!accepted) return null;
  if (accepted.orderId !== orderId || accepted.operationType !== operationType || accepted.payloadFingerprint !== payloadFingerprint) {
    throw new OnlineOrderOperationConflictError("معرّف المحاولة مستخدم لعملية طلب مختلفة.");
  }
  return accepted.response;
}

function assertPendingRevision(order: OnlineOrderDto, expectedRevision: number) {
  if (order.status !== "pending") throw new OnlineOrderStateConflictError();
  if (order.revision !== expectedRevision) throw new OnlineOrderRevisionConflictError();
}

function requiredOrder(order: OnlineOrderDto | null): OnlineOrderDto {
  if (!order) throw new NotFoundError("طلب المتجر غير موجود.");
  return order;
}

function parseArea(id: string, actorStaffId: string, input: unknown, changedAt: Date): DeliveryAreaWrite {
  const body = object(input, "بيانات منطقة التوصيل غير صالحة.");
  exactKeys(body, AREA_KEYS, "بيانات منطقة التوصيل غير صالحة.");
  if (typeof body.active !== "boolean") throw new OnlineOrderValidationError("حالة منطقة التوصيل غير صالحة.");
  return { id, nameAr: requiredText(body.nameAr, 120, "اسم منطقة التوصيل غير صالح."),
    feePiasters: integer(body.feePiasters, 0, Number.MAX_SAFE_INTEGER, "رسوم التوصيل غير صالحة."),
    active: body.active, actorStaffId, changedAt };
}

function parseQuote(input: unknown): CheckoutQuoteRequest & { couponCode: string | null } {
  const body = object(input, "بيانات مراجعة الطلب غير صالحة.");
  exactKeys(body, QUOTE_KEYS, "بيانات مراجعة الطلب غير صالحة.");
  return { lines: lines(body.lines), deliveryAreaId: uuid(body.deliveryAreaId),
    couponCode: optionalText(body.couponCode, 64, "كود الكوبون غير صالح.") };
}

function parseSubmission(input: unknown): PublicOrderSubmissionRequest & {
  couponCode: string | null; alternatePhone: string | null; landmark: string | null; notes: string | null;
} {
  const body = object(input, "بيانات الطلب غير صالحة.");
  exactKeys(body, SUBMIT_KEYS, "بيانات الطلب غير صالحة.");
  return {
    operationId: uuid(body.operationId), quoteId: uuid(body.quoteId),
    ...parseQuote({ lines: body.lines, deliveryAreaId: body.deliveryAreaId,
      ...(body.couponCode !== undefined ? { couponCode: body.couponCode } : {}) }),
    customerName: requiredText(body.customerName, 160, "اسم العميل مطلوب."),
    primaryPhone: phone(body.primaryPhone, "رقم الموبايل الأساسي غير صالح."),
    alternatePhone: optionalPhone(body.alternatePhone), detailedAddress: requiredText(body.detailedAddress, 500, "العنوان التفصيلي مطلوب."),
    landmark: optionalText(body.landmark, 300, "العلامة المميزة غير صالحة."),
    notes: optionalText(body.notes, 1000, "الملاحظات غير صالحة."),
  };
}

function parseAgreementQuote(input: unknown) {
  const body = object(input, "بيانات مراجعة الاتفاق غير صالحة.");
  exactKeys(body, new Set(["expectedRevision", "lines", "couponCode"]), "بيانات مراجعة الاتفاق غير صالحة.");
  return { expectedRevision: revision(body.expectedRevision), lines: lines(body.lines),
    couponCode: optionalText(body.couponCode, 64, "كود الكوبون غير صالح.") };
}

function parseAgreedRevision(input: unknown) {
  const body = object(input, "بيانات اتفاق العميل غير صالحة.");
  exactKeys(body, new Set(["operationId", "expectedRevision", "quoteId", "reviewDigest", "customerAgreed"]), "بيانات اتفاق العميل غير صالحة.");
  if (body.customerAgreed !== true) throw new OnlineOrderValidationError("يلزم إثبات موافقة العميل على السلة والسعر.");
  return { operationId: uuid(body.operationId), expectedRevision: revision(body.expectedRevision),
    quoteId: uuid(body.quoteId), reviewDigest: digest(body.reviewDigest), customerAgreed: true as const };
}

function parseContactAttempt(input: unknown): {
  operationId: string;
  expectedRevision: number;
  outcome: "no_answer" | "reached";
  note: string | null;
} {
  const body = object(input, "بيانات محاولة التواصل غير صالحة.");
  exactKeys(body, new Set(["operationId", "expectedRevision", "outcome", "note"]), "بيانات محاولة التواصل غير صالحة.");
  const outcome = body.outcome;
  if (outcome !== "no_answer" && outcome !== "reached") throw new OnlineOrderValidationError("نتيجة محاولة التواصل غير صالحة.");
  return { operationId: uuid(body.operationId), expectedRevision: revision(body.expectedRevision), outcome,
    note: optionalText(body.note, 500, "ملاحظة التواصل غير صالحة.") };
}

function parseConfirmation(input: unknown) {
  const body = object(input, "بيانات تأكيد الطلب غير صالحة.");
  exactKeys(body, new Set(["operationId", "expectedRevision", "agreedRevision", "itemsLocatedAndSetAside"]), "بيانات تأكيد الطلب غير صالحة.");
  if (body.itemsLocatedAndSetAside !== true) throw new OnlineOrderValidationError("يلزم إثبات العثور على المنتجات ووضعها جانباً فعلياً.");
  return { operationId: uuid(body.operationId), expectedRevision: revision(body.expectedRevision),
    agreedRevision: revision(body.agreedRevision), itemsLocatedAndSetAside: true as const };
}

function parseUnreachableCancellation(input: unknown) {
  const body = object(input, "بيانات إلغاء الطلب غير صالحة.");
  exactKeys(body, new Set(["operationId", "expectedRevision", "reason"]), "بيانات إلغاء الطلب غير صالحة.");
  return { operationId: uuid(body.operationId), expectedRevision: revision(body.expectedRevision),
    reason: requiredText(body.reason, 500, "سبب الإلغاء مطلوب.") };
}

function parseSettings(input: unknown) {
  const body = object(input, "إعدادات الطلبات غير صالحة.");
  exactKeys(body, new Set(["expectedRevision", "unreachableWaitHours", "minimumContactAttempts"]), "إعدادات الطلبات غير صالحة.");
  return { expectedRevision: revision(body.expectedRevision),
    unreachableWaitHours: integer(body.unreachableWaitHours, 1, 24 * 365, "مدة الانتظار غير صالحة."),
    minimumContactAttempts: integer(body.minimumContactAttempts, 2, 100, "الحد الأدنى لمحاولات التواصل لا يقل عن محاولتين.") };
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
function revision(value: unknown): number { return integer(value, 1, Number.MAX_SAFE_INTEGER, "نسخة الطلب غير صالحة."); }
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new OnlineOrderValidationError("المعرّف غير صالح.");
  return value.toLowerCase();
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new OnlineOrderValidationError("بصمة المراجعة غير صالحة.");
  return value;
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
function canonicalCheckoutQuote(quote: CheckoutQuoteDto): string {
  const { quoteId: _quoteId, ...value } = quote;
  return JSON.stringify(sortJson(value));
}
function canonicalAgreementPrice(quote: CheckoutQuoteDto | OnlineOrderAgreementQuoteDto, pricing: CheckoutPricingResult): string {
  const comparable = {
    lines: quote.lines.map(({ variantId, quantity, listedUnitPricePiasters, originalPiasters,
      automaticOfferDiscountPiasters, couponDiscountPiasters, merchandiseTotalPiasters }) => ({
      variantId, quantity, listedUnitPricePiasters, originalPiasters, automaticOfferDiscountPiasters,
      couponDiscountPiasters, merchandiseTotalPiasters,
    })),
    merchandiseOriginalPiasters: quote.merchandiseOriginalPiasters,
    automaticOfferDiscountPiasters: quote.automaticOfferDiscountPiasters,
    couponDiscountPiasters: quote.couponDiscountPiasters,
    merchandiseTotalPiasters: quote.merchandiseTotalPiasters,
    deliveryFeePiasters: quote.deliveryFeePiasters,
    finalTotalPiasters: quote.finalTotalPiasters,
  };
  return JSON.stringify(sortJson({ comparable, pricing }));
}
function reviewComparable(quote: Omit<OnlineOrderAgreementQuoteDto, "reviewDigest"> | OnlineOrderAgreementQuoteDto) {
  return {
    orderId: quote.orderId, orderRevision: quote.orderRevision, couponCode: quote.couponCode,
    lines: quote.lines.map(({ availableQuantity: _available, ...line }) => line),
    merchandiseOriginalPiasters: quote.merchandiseOriginalPiasters,
    automaticOfferDiscountPiasters: quote.automaticOfferDiscountPiasters,
    couponDiscountPiasters: quote.couponDiscountPiasters, merchandiseTotalPiasters: quote.merchandiseTotalPiasters,
    deliveryFeePiasters: quote.deliveryFeePiasters, finalTotalPiasters: quote.finalTotalPiasters,
    appliedAutomaticOffer: quote.appliedAutomaticOffer, appliedCoupon: quote.appliedCoupon,
  };
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}
